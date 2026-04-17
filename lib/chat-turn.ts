import { resolveAssistantTurn } from "@/lib/assistant-runtime";
import {
  ChatTurnStoppedError,
  claimChatTurnStart,
  releaseChatTurnStart,
  type ChatTurnControl
} from "@/lib/chat-turn-control";
import {
  bindAttachmentsToMessage,
  createMessage,
  createMessageTextSegment,
  createMessageAction,
  generateConversationTitleFromFirstUserMessage,
  getConversation,
  getMessage,
  getConversationOwnerId,
  setConversationActive,
  updateMessage,
  updateMessageAction
} from "@/lib/conversations";
import { ensureCompactedContext } from "@/lib/compaction";
import { stripAttachmentStyleImageMarkdown } from "@/lib/assistant-image-markdown";
import { inferAssistantLocalAttachments, importAssistantLocalFileAttachment } from "@/lib/assistant-local-attachments";
import { estimateTextTokens } from "@/lib/tokenization";
import { listEnabledMcpServers, getMcpServer } from "@/lib/mcp-servers";
import { listEnabledSkills } from "@/lib/skills";
import {
  getSettings,
  getSettingsForUser,
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";
import { createEmitter } from "@/lib/emitter";
import { appendInjectedWebSearchMcpServer } from "@/lib/web-search";
import type { ChatStreamEvent, MessageAction } from "@/lib/types";
import type { ConversationManager } from "@/lib/conversation-manager";

export type ChatEmitter = ReturnType<typeof createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>>;

export type ChatTurnResult = {
  status: "completed" | "failed" | "stopped" | "skipped";
  errorMessage?: string;
};

export type StartChatTurn = (
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: {
    source?: "live" | "queue";
    onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  }
) => Promise<ChatTurnResult>;

const globalEmitter = createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>();

const ACTIVE_TURN_ERROR_MESSAGE = "Conversation already has an active assistant turn";

function appendFailureNotes(content: string, failureNotes: string[]) {
  if (failureNotes.length === 0) {
    return content;
  }

  const appendedNotes = failureNotes.join("\n\n");
  return content ? `${content}\n\n${appendedNotes}` : appendedNotes;
}

function sanitizeAssistantContent(
  conversationId: string,
  messageId: string,
  content: string
) {
  const inferred = inferAssistantLocalAttachments({
    conversationId,
    content,
    workspaceRoot: process.cwd(),
    existingAttachments: getMessage(messageId)?.attachments ?? []
  });

  if (inferred.attachments.length > 0) {
    bindAttachmentsToMessage(
      conversationId,
      messageId,
      inferred.attachments.map((attachment) => attachment.id)
    );
  }

  const sanitizedContent = stripAttachmentStyleImageMarkdown(
    inferred.content,
    getMessage(messageId)?.attachments ?? []
  );

  return {
    content: sanitizedContent,
    failureNote: inferred.failureNote
  };
}

function tokenizeShellCommand(command: string) {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }

      if (character === "\\" && quote === '"') {
        escaped = true;
        continue;
      }

      current += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }

    if (character === ";" || character === "|" || character === "&") {
      pushCurrent();
      const nextCharacter = command[index + 1];
      if ((character === "|" || character === "&") && nextCharacter === character) {
        tokens.push(character + nextCharacter);
        index += 1;
      } else {
        tokens.push(character);
      }
      continue;
    }

    current += character;
  }

  pushCurrent();
  return tokens;
}

function isAgentBrowserToken(token: string) {
  const normalized = token.trim().replace(/\\/g, "/");
  const basename = normalized.split("/").at(-1)?.toLowerCase();
  return basename === "agent-browser";
}

function extractAgentBrowserScreenshotPaths(command: string) {
  const tokens = tokenizeShellCommand(command);
  const screenshotPaths = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    if (!isAgentBrowserToken(tokens[index] ?? "")) {
      continue;
    }

    if ((tokens[index + 1] ?? "").toLowerCase() !== "screenshot") {
      continue;
    }

    for (let candidateIndex = index + 2; candidateIndex < tokens.length; candidateIndex += 1) {
      const candidate = tokens[candidateIndex] ?? "";
      if (
        !candidate ||
        candidate === ";" ||
        candidate === "|" ||
        candidate === "||" ||
        candidate === "&" ||
        candidate === "&&"
      ) {
        break;
      }

      if (candidate.startsWith("-")) {
        continue;
      }

      screenshotPaths.add(candidate);
      break;
    }
  }

  return [...screenshotPaths];
}

export function attachAssistantFilesFromCompletedAction(conversationId: string, messageId: string, action: MessageAction) {
  if (action.kind !== "shell_command") {
    return;
  }

  const command =
    typeof action.arguments?.command === "string"
      ? action.arguments.command.trim()
      : action.detail.trim();

  if (!command) {
    return;
  }

  const screenshotPaths = extractAgentBrowserScreenshotPaths(command);
  if (!screenshotPaths.length) {
    return;
  }

  const attachmentIds: string[] = [];
  const existingAttachments = [...(getMessage(messageId)?.attachments ?? [])];

  for (const screenshotPath of screenshotPaths) {
    const outcome = importAssistantLocalFileAttachment({
      conversationId,
      sourcePath: screenshotPath,
      workspaceRoot: process.cwd(),
      existingAttachments
    });

    if (outcome.type !== "attach") {
      continue;
    }

    attachmentIds.push(outcome.attachment.id);
    existingAttachments.push(outcome.attachment);
  }

  if (attachmentIds.length > 0) {
    bindAttachmentsToMessage(conversationId, messageId, attachmentIds);
  }
}

export function createAssistantContentPersistenceTracker(
  conversationId: string,
  messageId: string
) {
  let persistedRawContent = "";
  let persistedSanitizedContent = "";
  const failureNotes: string[] = [];
  const failureNoteSet = new Set<string>();

  const recordFailureNote = (failureNote: string) => {
    if (!failureNote || failureNoteSet.has(failureNote)) {
      return;
    }

    failureNoteSet.add(failureNote);
    failureNotes.push(failureNote);
  };

  return {
    appendSegment(content: string) {
      if (!content) {
        return "";
      }

      const sanitized = sanitizeAssistantContent(conversationId, messageId, content);
      persistedRawContent += content;
      persistedSanitizedContent += sanitized.content;
      recordFailureNote(sanitized.failureNote);
      return sanitized.content;
    },
    finalize(content: string) {
      if (!content) {
        return appendFailureNotes(persistedSanitizedContent, failureNotes);
      }

      if (content.startsWith(persistedRawContent)) {
        const remainder = content.slice(persistedRawContent.length);
        if (remainder) {
          const sanitized = sanitizeAssistantContent(conversationId, messageId, remainder);
          persistedRawContent += remainder;
          persistedSanitizedContent += sanitized.content;
          recordFailureNote(sanitized.failureNote);
        }

        return appendFailureNotes(persistedSanitizedContent, failureNotes);
      }

      if (!persistedRawContent) {
        const sanitized = sanitizeAssistantContent(conversationId, messageId, content);
        persistedRawContent = content;
        persistedSanitizedContent = sanitized.content;
        recordFailureNote(sanitized.failureNote);
      }

      return appendFailureNotes(persistedSanitizedContent, failureNotes);
    }
  };
}

export function getChatEmitter(): ChatEmitter {
  return globalEmitter;
}

export function getAssistantTurnStartPreflight(conversationId: string) {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return {
      ok: false as const,
      status: "skipped" as const,
      statusCode: 404,
      errorMessage: "Conversation not found"
    };
  }

  const settings =
    (conversation.providerProfileId
      ? getProviderProfileWithApiKey(conversation.providerProfileId)
      : null) ?? getDefaultProviderProfileWithApiKey();
  const conversationOwnerId = getConversationOwnerId(conversationId);
  const appSettings = conversationOwnerId ? getSettingsForUser(conversationOwnerId) : getSettings();

  if (!settings) {
    return {
      ok: false as const,
      status: "failed" as const,
      statusCode: 400,
      errorMessage: "No provider profile configured"
    };
  }

  if (settings.providerKind !== "github_copilot" && !settings.apiKey) {
    return {
      ok: false as const,
      status: "failed" as const,
      statusCode: 400,
      errorMessage: "Set an API key in settings before starting a chat"
    };
  }

  if (settings.providerKind === "github_copilot" && !settings.githubUserAccessTokenEncrypted) {
    return {
      ok: false as const,
      status: "failed" as const,
      statusCode: 400,
      errorMessage: "Connect a GitHub account in settings before starting a chat"
    };
  }

  return {
    ok: true as const,
    conversation,
    conversationOwnerId,
    settings,
    appSettings
  };
}

type AssistantTurnStartReady = Extract<
  ReturnType<typeof getAssistantTurnStartPreflight>,
  { ok: true }
>;

async function startAssistantTurn(
  manager: ConversationManager,
  conversationId: string,
  preflight: AssistantTurnStartReady,
  control: ChatTurnControl,
  personaId?: string,
  options?: {
    userMessageId?: string;
    onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  }
) : Promise<ChatTurnResult> {
  const { conversation, conversationOwnerId, settings, appSettings } = preflight;
  let assistantMessageId: string | null = null;
  let contentPersistence: ReturnType<typeof createAssistantContentPersistenceTracker> | null = null;
  let started = false;
  let timelineSortOrder = 0;
  let answerBuffer = "";
  let latestAnswer = "";
  let latestThinking = "";
  let sawStreamedAnswerSinceLastSegment = false;
  let lastFlush = Date.now();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const runningActionHandles = new Set<string>();

  try {
    const assistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "streaming",
      estimatedTokens: 0
    });
    assistantMessageId = assistantMessage.id;
    contentPersistence = createAssistantContentPersistenceTracker(conversationId, assistantMessageId);

    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: { type: "message_start", messageId: assistantMessage.id }
    });

    manager.setActive(conversationId, true);
    globalEmitter.emit("status", conversationId, "streaming");
    setConversationActive(conversation.id, true);
    manager.broadcastAll(
      { type: "conversation_activity", conversationId, isActive: true },
      conversationOwnerId ?? undefined
    );
    started = true;

    function flushAnswerBuffer() {
      if (!assistantMessageId || !answerBuffer || !contentPersistence) return;
      const sanitizedBuffer = contentPersistence.appendSegment(answerBuffer);
      if (!sanitizedBuffer) {
        answerBuffer = "";
        lastFlush = Date.now();
        return;
      }
      createMessageTextSegment({
        messageId: assistantMessageId,
        content: sanitizedBuffer,
        sortOrder: timelineSortOrder++
      });
      answerBuffer = "";
      lastFlush = Date.now();
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushAnswerBuffer();
      }, 100);
    }
    if (options?.userMessageId && options.onMessagesCreated) {
      options.onMessagesCreated({
        userMessageId: options.userMessageId,
        assistantMessageId: assistantMessage.id
      });
    }

    const compacted = await ensureCompactedContext(conversation.id, settings, {
      onCompactionStart() {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "compaction_start" }
        });
      },
      onCompactionEnd() {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "compaction_end" }
        });
      }
    }, personaId, appSettings.memoriesEnabled);
    let promptMessages = compacted.promptMessages;
    const skills = appSettings.skillsEnabled ? listEnabledSkills() : [];
    const mcpServers = appendInjectedWebSearchMcpServer(listEnabledMcpServers(), appSettings);

    let mcpToolSets: Array<{
      server: (typeof mcpServers)[number];
      tools: Awaited<ReturnType<typeof import("@/lib/mcp-client")["discoverMcpTools"]>>;
    }> = [];
    if (mcpServers.length) {
      const { gatherAllMcpTools } = await import("@/lib/mcp-client");
      mcpToolSets = await gatherAllMcpTools(mcpServers);
    }

    // Resolve vision MCP server if configured so runtime can use MCP mode directly
    // or downgrade unsupported native-vision profiles automatically.
    let visionMcpServer: (typeof mcpServers)[number] | null = null;
    if (settings.visionMcpServerId) {
      const server = getMcpServer(settings.visionMcpServerId);
      if (server && server.enabled) {
        visionMcpServer = server;
      }
    }

    const providerResult = await resolveAssistantTurn({
      settings,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      visionMcpServer,
      memoriesEnabled: appSettings.memoriesEnabled,
      searxngBaseUrl:
        appSettings.webSearchEngine === "searxng" ? appSettings.searxngBaseUrl : null,
      memoryUserId: conversationOwnerId ?? undefined,
      mcpTimeout: appSettings.mcpTimeout,
      abortSignal: control.abortController.signal,
      throwIfStopped: control.throwIfStopped,
      appSettings,
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
      onEvent(event: ChatStreamEvent) {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event
        });
        globalEmitter.emit("delta", conversationId, event);

        if (event.type === "answer_delta") {
          sawStreamedAnswerSinceLastSegment = true;
          answerBuffer += event.text;
          latestAnswer += event.text;
          if (answerBuffer.length >= 500 || Date.now() - lastFlush >= 100) {
            flushAnswerBuffer();
          } else {
            scheduleFlush();
          }
        }
      },
      onAnswerSegment(segment) {
        flushAnswerBuffer();
        if (!sawStreamedAnswerSinceLastSegment && segment && assistantMessageId && contentPersistence) {
          latestAnswer += segment;
          const sanitizedSegment = contentPersistence.appendSegment(segment);
          if (!sanitizedSegment) {
            sawStreamedAnswerSinceLastSegment = false;
            return;
          }
          createMessageTextSegment({
            messageId: assistantMessageId,
            content: sanitizedSegment,
            sortOrder: timelineSortOrder++
          });
        }
        sawStreamedAnswerSinceLastSegment = false;
      },
      onActionStart(action) {
        if (!assistantMessageId) {
          return "";
        }
        const persisted = createMessageAction({
          messageId: assistantMessageId,
          kind: action.kind,
          status: action.status,
          label: action.label,
          detail: action.detail,
          serverId: action.serverId,
          skillId: action.skillId,
          toolName: action.toolName,
          arguments: action.arguments,
          proposalState: action.proposalState,
          proposalPayload: action.proposalPayload,
          sortOrder: timelineSortOrder++
        });
        runningActionHandles.add(persisted.id);
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "action_start", action: persisted }
        });
        globalEmitter.emit("delta", conversationId, { type: "action_start", action: persisted });
        return persisted.id;
      },
      onActionComplete(handle, patch) {
        if (!handle) return;
        runningActionHandles.delete(handle);
        const updated = updateMessageAction(handle, {
          status: "completed",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          attachAssistantFilesFromCompletedAction(conversationId, assistantMessage.id, updated);
          manager.broadcast(conversationId, {
            type: "delta",
            conversationId,
            event: { type: "action_complete", action: updated }
          });
          globalEmitter.emit("delta", conversationId, { type: "action_complete", action: updated });
        }
      },
      onActionError(handle, patch) {
        if (!handle) return;
        runningActionHandles.delete(handle);
        const updated = updateMessageAction(handle, {
          status: "error",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          manager.broadcast(conversationId, {
            type: "delta",
            conversationId,
            event: { type: "action_error", action: updated }
          });
          globalEmitter.emit("delta", conversationId, { type: "action_error", action: updated });
        }
      }
    });

    if (flushTimer) clearTimeout(flushTimer);
    flushAnswerBuffer();

    updateMessage(assistantMessageId, {
      content: contentPersistence?.finalize(providerResult.answer) ?? "",
      thinkingContent: providerResult.thinking,
      status: "completed",
      estimatedTokens:
        (providerResult.usage.inputTokens ?? 0) +
        (providerResult.usage.outputTokens ?? 0) +
        (providerResult.usage.reasoningTokens ?? 0)
    });

    const completedMessage = getMessage(assistantMessageId);
    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: { type: "done", messageId: assistantMessageId, message: completedMessage ?? undefined }
    });
    return { status: "completed" };
  } catch (error) {
    if (error instanceof ChatTurnStoppedError && assistantMessageId) {
      if (flushTimer) clearTimeout(flushTimer);
      if (answerBuffer && contentPersistence) {
        const sanitizedBuffer = contentPersistence.appendSegment(answerBuffer);
        answerBuffer = "";
        if (sanitizedBuffer) {
          createMessageTextSegment({
            messageId: assistantMessageId,
            content: sanitizedBuffer,
            sortOrder: timelineSortOrder++
          });
        }
      } else if (answerBuffer) {
        createMessageTextSegment({
          messageId: assistantMessageId,
          content: answerBuffer,
          sortOrder: timelineSortOrder++
        });
        answerBuffer = "";
      }

      updateMessage(assistantMessageId, {
        content: contentPersistence?.finalize(latestAnswer) ?? "",
        thinkingContent: latestThinking,
        status: "stopped",
        estimatedTokens: estimateTextTokens(latestAnswer)
      });

      for (const handle of runningActionHandles) {
        updateMessageAction(handle, {
          status: "stopped",
          completedAt: new Date().toISOString()
        });
      }

      manager.broadcast(conversationId, {
        type: "delta",
        conversationId,
        event: { type: "done", messageId: assistantMessageId, message: getMessage(assistantMessageId) ?? undefined }
      });
      return { status: "stopped" };
    } else {
      for (const handle of runningActionHandles) {
        updateMessageAction(handle, {
          status: "error",
          resultSummary: error instanceof Error ? error.message : "Chat stream failed",
          completedAt: new Date().toISOString()
        });
      }

      if (assistantMessageId) {
        updateMessage(assistantMessageId, {
          content: "",
          thinkingContent: "",
          status: "error"
        });
      }
      manager.broadcast(conversationId, {
        type: "delta",
        conversationId,
        event: {
          type: "error",
          message: error instanceof Error ? error.message : "Chat stream failed"
        }
      });
      return {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Chat stream failed"
      };
    }
  } finally {
    releaseChatTurnStart(conversationId, control);
    if (started) {
      setConversationActive(conversation.id, false);
      manager.setActive(conversationId, false);
      manager.broadcastAll(
        { type: "conversation_activity", conversationId, isActive: false },
        conversationOwnerId ?? undefined
      );
      globalEmitter.emit("status", conversationId, "completed");
    }
    void import("@/lib/queued-chat-dispatcher")
      .then(({ ensureQueuedDispatch }) =>
        ensureQueuedDispatch({
          manager,
          conversationId,
          startChatTurn
        })
      )
      .catch((error) => {
        console.error("Queued chat dispatch failed", error);
      });
  }
}

export async function startAssistantTurnFromExistingUserMessage(
  manager: ConversationManager,
  conversationId: string,
  messageId: string,
  personaId?: string,
  options?: {
    control?: ChatTurnControl;
    preflight?: AssistantTurnStartReady;
  }
): Promise<ChatTurnResult> {
  const message = getMessage(messageId);
  if (!message || message.role !== "user" || message.conversationId !== conversationId) {
    if (options?.control) {
      releaseChatTurnStart(conversationId, options.control);
    }
    return { status: "skipped", errorMessage: "User message not found" };
  }

  const preflight = options?.preflight ?? getAssistantTurnStartPreflight(conversationId);
  if (!preflight.ok) {
    if (options?.control) {
      releaseChatTurnStart(conversationId, options.control);
    }
    if (preflight.status === "failed") {
      manager.broadcast(conversationId, {
        type: "error",
        message: preflight.errorMessage
      });
    }

    return { status: preflight.status, errorMessage: preflight.errorMessage };
  }

  const claimed = options?.control
    ? { ok: true as const, control: options.control }
    : claimChatTurnStart(conversationId);
  if (!claimed.ok) {
    manager.broadcast(conversationId, {
      type: "error",
      message: ACTIVE_TURN_ERROR_MESSAGE
    });
    return { status: "failed", errorMessage: ACTIVE_TURN_ERROR_MESSAGE };
  }

  return startAssistantTurn(manager, conversationId, preflight, claimed.control, personaId);
}

export async function startChatTurn(
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: {
    source?: "live" | "queue";
    onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  }
): Promise<ChatTurnResult> {
  const preflight = getAssistantTurnStartPreflight(conversationId);
  if (!preflight.ok) {
    if (preflight.status === "failed") {
      manager.broadcast(conversationId, {
        type: "error",
        message: preflight.errorMessage
      });
    }

    return { status: preflight.status, errorMessage: preflight.errorMessage };
  }

  const claimed = claimChatTurnStart(conversationId);
  if (!claimed.ok) {
    manager.broadcast(conversationId, {
      type: "error",
      message: ACTIVE_TURN_ERROR_MESSAGE
    });
    return { status: "failed", errorMessage: ACTIVE_TURN_ERROR_MESSAGE };
  }

  try {
    const userMessage = createMessage({
      conversationId,
      role: "user",
      content,
      estimatedTokens: estimateTextTokens(content)
    });

    bindAttachmentsToMessage(conversationId, userMessage.id, attachmentIds);
    void generateConversationTitleFromFirstUserMessage(conversationId, userMessage.id);

    return startAssistantTurn(manager, conversationId, preflight, claimed.control, personaId, {
      userMessageId: userMessage.id,
      onMessagesCreated: options?.onMessagesCreated
    });
  } catch (error) {
    releaseChatTurnStart(conversationId, claimed.control);
    throw error;
  }
}
