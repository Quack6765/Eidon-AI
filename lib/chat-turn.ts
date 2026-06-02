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
  getConversationSnapshot,
  getMessage,
  getConversationOwnerId,
  setConversationActive,
  updateMessage,
  updateMessageAction
} from "@/lib/conversations";
import { badRequest } from "@/lib/http";
import { NextResponse } from "next/server";
import { getConversationManager } from "@/lib/ws-singleton";
import { ensureCompactedContext, getConversationContextUsage } from "@/lib/compaction";
import { estimateTextTokens } from "@/lib/tokenization";
import { listEnabledMcpServers } from "@/lib/mcp-servers";
import { listEnabledSkills } from "@/lib/skills";
import {
  getSettings,
  getSettingsForUser,
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";
import { createEmitter } from "@/lib/emitter";
import { appendInjectedWebSearchMcpServer } from "@/lib/web-search";
import { createAssistantContentPersistenceTracker as createAssistantContentPersistenceTrackerImpl, attachAssistantFilesFromCompletedAction as attachAssistantFilesFromCompletedActionImpl } from "./content-persistence";
import type { ChatStreamEvent } from "@/lib/types";
import type { ConversationManager } from "@/lib/conversation-manager";

export { tokenizeShellCommand, isAgentBrowserToken, extractAgentBrowserScreenshotPaths } from "./shell-tokenizer";
export { attachAssistantFilesFromCompletedAction, createAssistantContentPersistenceTracker } from "./content-persistence";

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

const createAssistantContentPersistenceTracker = createAssistantContentPersistenceTrackerImpl;
const attachAssistantFilesFromCompletedAction = attachAssistantFilesFromCompletedActionImpl;

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

    const visionMcpServers = mcpServers.filter((server) => server.enabled && server.isVisionMcp);

    const providerResult = await resolveAssistantTurn({
      settings,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      visionMcpServers,
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
    const contextUsage = getConversationContextUsage(conversationId);
    if (contextUsage) {
      manager.broadcast(conversationId, {
        type: "delta",
        conversationId,
        event: {
          type: "context_usage",
          contextTokens: contextUsage.contextTokens ?? 0,
          compactionLimit: contextUsage.compactionLimit
        }
      });
    }
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
        const errorMessage = error instanceof Error ? error.message : "Chat stream failed";
        updateMessage(assistantMessageId, {
          content: errorMessage,
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

export type ClaimedTurnContext = {
  snapshot: import("@/lib/types").ConversationSnapshot;
  preflight: AssistantTurnStartReady;
  control: ChatTurnControl;
};

export function prepareMessageManipulationTurn(params: {
  conversationId: string;
  userId: string;
  busyErrorMessage: string;
}): ClaimedTurnContext | NextResponse {
  const { conversationId, userId, busyErrorMessage } = params;

  const snapshot = getConversationSnapshot(conversationId, userId);
  if (!snapshot) return badRequest("Conversation not found", 404);
  if (snapshot.conversation.isActive) return badRequest(busyErrorMessage, 409);

  const preflight = getAssistantTurnStartPreflight(conversationId);
  if (!preflight.ok) return badRequest(preflight.errorMessage, preflight.statusCode);

  const claimed = claimChatTurnStart(conversationId);
  if (!claimed.ok) return badRequest(busyErrorMessage, 409);

  return { snapshot, preflight, control: claimed.control };
}

export function startManipulationTurn(params: {
  conversationId: string;
  userMessageId: string;
  preflight: AssistantTurnStartReady;
  control: ChatTurnControl;
  logTag: string;
}) {
  const { conversationId, userMessageId, preflight, control, logTag } = params;
  void startAssistantTurnFromExistingUserMessage(
    getConversationManager(),
    conversationId,
    userMessageId,
    undefined,
    { control, preflight }
  ).catch((error) => {
    releaseChatTurnStart(conversationId, control);
    console.error(`[${logTag}] continuation failed:`, error);
  });
}
