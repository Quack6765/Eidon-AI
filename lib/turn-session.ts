import { resolveAssistantTurn } from "@/lib/assistant-runtime";
import { getProviderReadinessError } from "@/lib/provider-adapters";
import {
  ChatTurnStoppedError,
  claimChatTurnStart,
  releaseChatTurnStart,
  requestStop,
  type ChatTurnControl
} from "@/lib/chat-turn-control";
import {
  claimQueuedRedirectMessage,
  createMessage,
  createMessageTextSegment,
  createMessageAction,
  deleteFailedAssistantMessages,
  generateConversationTitleFromFirstUserMessage,
  getConversation,
  getConversationSnapshot,
  getMessage,
  getConversationOwnerId,
  publishQueueUpdated,
  publishUserMessagePersisted,
  setConversationActive,
  updateMessage,
  updateMessageAction
} from "@/lib/conversations";
import { bindAttachmentsToMessage } from "@/lib/attachments";
import { badRequest } from "@/lib/http";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConversationManager } from "@/lib/ws-singleton";
import { canUseProviderProfile, resolveConversationReasoningEffort } from "@/lib/provider-profile";
import { ensureCompactedContext, getConversationContextUsage, startBackgroundCompaction } from "@/lib/compaction";
import { queueConversationIndex } from "@/lib/semantic-index";
import { computeCompactionLimit, estimateTextTokens } from "@/lib/tokenization";
import { listEnabledMcpServers } from "@/lib/mcp-servers";
import { listConversationSkills } from "@/lib/skill-library";
import { scheduleSkillReview } from "@/lib/skill-review";
import {
  getSettings,
  getSettingsForUser,
  getDefaultRuntimeProviderProfile,
  getRuntimeProviderProfile
} from "@/lib/settings";
import { publishConversationEvent } from "@/lib/conversation-event-bus";
import {
  buildBotSystemPrompt,
  buildBotRoster,
  getBot,
  getBotByConversationId,
  recordBotResult,
  toBotSummary
} from "@/lib/bots";
import { getBotTeamWorkspacesDir } from "@/lib/bot-sandbox";
import { openBotRun, settleBotRun } from "@/lib/bot-run-lifecycle";
import { setBotRunWaitingForUser } from "@/lib/bot-runs";
import { UNATTENDED_TOOL_APPROVAL_TIMEOUT_MS } from "@/lib/tool-approvals";
import { createAssistantContentPersistenceTracker } from "@/lib/content-persistence";
import { DEFAULT_RESEARCH_DEADLINE_MS } from "@/lib/constants";
import {
  beginTurnActivity,
  endTurnActivity,
  finishTurnAction,
  setTurnWaitingForUser,
  startTurnAction,
  touchTurnActivity
} from "@/lib/turn-activity";
import type {
  ChatResearchOptions,
  ChatStreamEvent,
  ConversationSnapshot,
  DelegationChain,
  ToolApprovalContext
} from "@/lib/types";
import type { ConversationManager } from "@/lib/conversation-manager";

export type { ChatEmitter } from "@/lib/conversation-event-bus";
export { getChatEmitter } from "@/lib/conversation-event-bus";

export type ChatTurnResult = {
  status: "completed" | "failed" | "stopped" | "skipped";
  errorMessage?: string;
};

export type ChatTurnMessagesPayload = { userMessageId: string; assistantMessageId: string };

export type ChatTurnOptions = {
  source?: "live" | "queue";
  onMessagesCreated?: (payload: ChatTurnMessagesPayload) => void;
  botRun?: { record?: false; trigger?: "dm" | "delegated" | "routine"; runId?: string };
  research?: ChatResearchOptions;
  quietWhenBusy?: boolean;
  unattended?: boolean;
  toolAllowlist?: string[];
  skillOwnerUserId?: string | null;
  providerProfileId?: string;
  delegationChain?: DelegationChain;
  onUserWait?: (waiting: boolean) => Promise<void> | void;
};

export type StartChatTurn = (
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: ChatTurnOptions
) => Promise<ChatTurnResult>;

export const ACTIVE_TURN_ERROR_MESSAGE = "Conversation already has an active assistant turn";

export function getAssistantTurnStartPreflight(conversationId: string, providerProfileId?: string) {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return {
      ok: false as const,
      status: "skipped" as const,
      statusCode: 404,
      errorMessage: "Conversation not found"
    };
  }

  const conversationOwnerId = getConversationOwnerId(conversationId);
  const resolvedProviderProfileId = providerProfileId ?? conversation.providerProfileId;
  const profileSettings =
    (resolvedProviderProfileId
      ? getRuntimeProviderProfile(resolvedProviderProfileId)
      : null) ?? getDefaultRuntimeProviderProfile(conversationOwnerId);
  const settings = profileSettings
    ? {
        ...profileSettings,
        reasoningEffort: resolveConversationReasoningEffort(
          conversation.reasoningEffort,
          profileSettings
        )
      }
    : null;
  const appSettings = conversationOwnerId ? getSettingsForUser(conversationOwnerId) : getSettings();

  if (!settings) {
    return {
      ok: false as const,
      status: "failed" as const,
      statusCode: 400,
      errorMessage: "No provider profile configured"
    };
  }

  const readinessError = getProviderReadinessError(settings, conversationOwnerId);
  if (readinessError) {
    return {
      ok: false as const,
      status: "failed" as const,
      statusCode: 400,
      errorMessage: readinessError
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

function createUserMessage(input: { conversationId: string; content: string; attachmentIds: string[] }) {
  const userMessage = createMessage({
    conversationId: input.conversationId,
    role: "user",
    content: input.content,
    estimatedTokens: estimateTextTokens(input.content)
  });

  bindAttachmentsToMessage(input.conversationId, userMessage.id, input.attachmentIds);
  return userMessage;
}

export function createPendingUserMessage(input: {
  conversationId: string;
  content: string;
  attachmentIds: string[];
}) {
  const userMessage = getDb().transaction(() => createUserMessage(input))();
  void generateConversationTitleFromFirstUserMessage(input.conversationId, userMessage.id);
  return userMessage;
}

function createChatTurnMessages(input: {
  conversationId: string;
  content: string;
  attachmentIds: string[];
}) {
  const createMessages = getDb().transaction(() => {
    const userMessage = createUserMessage(input);

    const assistantMessage = createMessage({
      conversationId: input.conversationId,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "streaming",
      estimatedTokens: 0
    });

    return { userMessage, assistantMessage };
  });

  return createMessages();
}

async function runClaimedTurn(
  manager: ConversationManager,
  conversationId: string,
  preflight: AssistantTurnStartReady,
  control: ChatTurnControl,
  personaId?: string,
  options?: {
    userMessageId?: string;
    assistantMessage?: ReturnType<typeof createMessage>;
    onMessagesCreated?: (payload: ChatTurnMessagesPayload) => void;
    research?: ChatResearchOptions;
    unattended?: boolean;
    toolAllowlist?: string[];
    skillOwnerUserId?: string | null;
    delegationChain?: DelegationChain;
    onUserWait?: (waiting: boolean) => Promise<void> | void;
  }
) : Promise<ChatTurnResult> {
  const { conversation, conversationOwnerId, settings, appSettings } = preflight;
  const bot = getBotByConversationId(conversation.id);
  const botSystemPrompt = bot ? buildBotSystemPrompt(bot, appSettings.botSystemPrompt) : undefined;
  const botTeam = bot
    ? {
        isChief: bot.isChief,
        roster: buildBotRoster(bot.userId ?? undefined, bot.id)
      }
    : undefined;
  const broadcastBotStatus = () => {
    if (!bot) return;
    const botOwnerUserId = bot.userId ?? conversationOwnerId ?? null;
    if (!botOwnerUserId) return;
    publishConversationEvent(
      { kind: "user", userId: botOwnerUserId, message: { type: "bot_updated", bot: toBotSummary(getBot(bot.id) ?? bot) } },
      manager
    );
  };
  const emitDelta = (event: ChatStreamEvent) => {
    publishConversationEvent({ kind: "delta", conversationId, event }, manager);
  };
  let memoryCounts: { memoriesUsed?: number; memoriesTotal?: number } = {};
  const broadcastContextUsage = (usage = getConversationContextUsage(conversationId)) => {
    if (!usage) return null;
    const event = {
      type: "context_usage",
      contextTokens: usage.contextTokens ?? 0,
      compactionLimit: usage.compactionLimit,
      ...memoryCounts
    } satisfies ChatStreamEvent;
    emitDelta(event);
    return event;
  };
  let pendingUserWaits = 0;
  const toolApproval: ToolApprovalContext = {
    userId: conversationOwnerId ?? null,
    unattended: !bot && Boolean(options?.unattended),
    timeoutMs: bot && options?.unattended ? UNATTENDED_TOOL_APPROVAL_TIMEOUT_MS : undefined,
    async onWaitChange(waiting) {
      pendingUserWaits += waiting ? 1 : -1;
      if (pendingUserWaits !== (waiting ? 1 : 0)) return;
      if (waiting) setTurnWaitingForUser(conversationId, true);
      await options?.onUserWait?.(waiting);
      if (!waiting) setTurnWaitingForUser(conversationId, false);
      broadcastBotStatus();
    }
  };
  let assistantMessageId: string | null = null;
  let contentPersistence: ReturnType<typeof createAssistantContentPersistenceTracker> | null = null;
  let started = false;
  let afterTurnEnded: (() => void) | null = null;
  let timelineSortOrder = 0;
  let answerBuffer = "";
  let latestAnswer = "";
  let latestThinking = "";
  let sawStreamedAnswerSinceLastSegment = false;
  const runningActionHandles = new Set<string>();
  const researchDeadline = options?.research
    ? setTimeout(() => requestStop(conversationId), options.research.deadlineMs ?? DEFAULT_RESEARCH_DEADLINE_MS)
    : null;

  try {
    const assistantMessage =
      options?.assistantMessage ??
      createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        thinkingContent: "",
        status: "streaming",
        estimatedTokens: 0
      });
    assistantMessageId = assistantMessage.id;
    contentPersistence = createAssistantContentPersistenceTracker(
      conversationId,
      assistantMessageId,
      bot ? [getBotTeamWorkspacesDir(bot)] : []
    );

    if (options?.userMessageId && options.onMessagesCreated) {
      options.onMessagesCreated({
        userMessageId: options.userMessageId,
        assistantMessageId: assistantMessage.id
      });
    }

    emitDelta({ type: "message_start", messageId: assistantMessage.id });

    manager.setActive(conversationId, true);
    publishConversationEvent({ kind: "status", conversationId, status: "streaming" }, manager);
    setConversationActive(conversation.id, true);
    publishConversationEvent(
      { kind: "user", userId: conversationOwnerId ?? null, message: { type: "conversation_activity", conversationId, isActive: true } },
      manager
    );
    broadcastBotStatus();
    started = true;
    const activityOwnerId = bot ? bot.userId ?? conversationOwnerId ?? null : null;
    beginTurnActivity(conversationId, {
      onChange: activityOwnerId
        ? (activity) => publishConversationEvent(
            { kind: "user", userId: activityOwnerId, message: { type: "bot_activity", conversationId, activity } },
            manager
          )
        : undefined
    });

    async function flushAnswerBuffer() {
      if (!assistantMessageId || !answerBuffer || !contentPersistence) return;
      const pendingAnswer = answerBuffer;
      const pendingSortOrder = timelineSortOrder++;
      answerBuffer = "";
      const sanitizedBuffer = await contentPersistence.appendSegment(pendingAnswer);
      if (!sanitizedBuffer) {
        return;
      }
      createMessageTextSegment({
        messageId: assistantMessageId,
        content: sanitizedBuffer,
        sortOrder: pendingSortOrder
      });
    }

    async function takeRedirect() {
      if (!assistantMessageId || !contentPersistence) return null;
      const queued = claimQueuedRedirectMessage(conversationId, control.redirectIds);
      if (!queued) return null;
      control.redirectIds.delete(queued.id);
      publishQueueUpdated(conversationId, manager);

      await flushAnswerBuffer();
      const content = await contentPersistence.finalize("");
      updateMessage(assistantMessageId, {
        content,
        thinkingContent: latestThinking,
        status: "completed",
        estimatedTokens: estimateTextTokens(content)
      });
      emitDelta({ type: "done", messageId: assistantMessageId, message: getMessage(assistantMessageId) ?? undefined });

      const next = createChatTurnMessages({ conversationId, content: queued.content, attachmentIds: [] });
      const userMessage = getMessage(next.userMessage.id);
      if (userMessage) {
        publishUserMessagePersisted(conversationId, userMessage, manager);
      }
      options?.onMessagesCreated?.({ userMessageId: next.userMessage.id, assistantMessageId: next.assistantMessage.id });

      assistantMessageId = next.assistantMessage.id;
      contentPersistence = createAssistantContentPersistenceTracker(conversationId, assistantMessageId);
      timelineSortOrder = 0;
      answerBuffer = "";
      latestAnswer = "";
      latestThinking = "";
      sawStreamedAnswerSinceLastSegment = false;
      emitDelta({ type: "message_start", messageId: assistantMessageId });
      touchTurnActivity(conversationId);
      return { content: queued.content, assistantMessageId };
    }

    const mcpServers = listEnabledMcpServers();
    const mcpToolSetsPromise = mcpServers.length
      ? import("@/lib/mcp-client").then(({ gatherAllMcpTools }) =>
          gatherAllMcpTools(mcpServers, control.abortController.signal)
        )
      : Promise.resolve([]);

    const [compacted, mcpToolSets] = await Promise.all([
      ensureCompactedContext(conversation.id, settings, {
        onCompactionStart() {
          touchTurnActivity(conversationId);
          publishConversationEvent(
            { kind: "room", conversationId, message: { type: "delta", conversationId, event: { type: "compaction_start" } } },
            manager
          );
        },
        onCompactionEnd() {
          touchTurnActivity(conversationId);
          publishConversationEvent(
            { kind: "room", conversationId, message: { type: "delta", conversationId, event: { type: "compaction_end" } } },
            manager
          );
        }
      }, personaId, appSettings.memoriesEnabled, appSettings.memoriesRigor, control.abortController.signal, botSystemPrompt, bot?.id),
      mcpToolSetsPromise
    ]);
    control.throwIfStopped();
    if (compacted.memoriesUsed !== undefined) {
      memoryCounts = { memoriesUsed: compacted.memoriesUsed, memoriesTotal: compacted.memoriesTotal };
    }
    broadcastContextUsage({ contextTokens: compacted.promptTokens, compactionLimit: computeCompactionLimit(settings) });
    let promptMessages = compacted.promptMessages;
    const skillOwner = bot ?? (options?.skillOwnerUserId ? { userId: options.skillOwnerUserId } : null);
    const skills = appSettings.skillsEnabled ? listConversationSkills(skillOwner) : [];

    const visionMcpServers = mcpServers.filter((server) => server.enabled && server.isVisionMcp);

    const storedVisionProfile = settings.visionProviderProfileId
      ? getRuntimeProviderProfile(settings.visionProviderProfileId)
      : null;
    const visionProfile = storedVisionProfile && canUseProviderProfile(storedVisionProfile, conversationOwnerId)
      ? storedVisionProfile
      : null;

    const providerResult = await resolveAssistantTurn({
      settings,
      visionProfile: visionProfile ?? undefined,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      visionMcpServers,
      memoriesEnabled: appSettings.memoriesEnabled,
      memoriesRigor: appSettings.memoriesRigor,
      memoryUserId: conversationOwnerId,
      toolApproval,
      mcpTimeout: appSettings.mcpTimeout,
      abortSignal: control.abortController.signal,
      enableStreamRetry: true,
      throwIfStopped: control.throwIfStopped,
      appSettings,
      conversationId: conversation.id,
      assistantMessageId: assistantMessage.id,
      botTeam,
      botWorkspaceSkillsEnabled: appSettings.skillsEnabled && Boolean(skillOwner),
      skillManageEnabled: appSettings.skillsEnabled && Boolean(skillOwner),
      toolAllowlist: options?.toolAllowlist,
      research: options?.research,
      takeRedirect,
      delegationChain: options?.delegationChain ?? { messagesSent: 0 },
      async onEvent(event: ChatStreamEvent) {
        touchTurnActivity(conversationId);
        emitDelta(event);

        if (event.type === "answer_delta") {
          sawStreamedAnswerSinceLastSegment = true;
          answerBuffer += event.text;
          latestAnswer += event.text;
        } else if (event.type === "stream_retry") {
          const flushed = flushAnswerBuffer();
          latestAnswer = "";
          latestThinking = "";
          sawStreamedAnswerSinceLastSegment = false;
          await flushed;
        } else if (event.type === "answer_reset") {
          answerBuffer = "";
          latestAnswer = "";
          sawStreamedAnswerSinceLastSegment = false;
        }
      },
      async onAnswerSegment(segment) {
        await flushAnswerBuffer();
        if (!sawStreamedAnswerSinceLastSegment && segment && assistantMessageId && contentPersistence) {
          latestAnswer += segment;
          const sanitizedSegment = await contentPersistence.appendSegment(segment);
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
        if (persisted.status === "running") {
          runningActionHandles.add(persisted.id);
          startTurnAction(conversationId, persisted.id, persisted.label);
        }
        emitDelta({ type: "action_start", action: persisted });
        return persisted.id;
      },
      async onActionComplete(handle, patch) {
        if (!handle) return;
        runningActionHandles.delete(handle);
        finishTurnAction(conversationId, handle);
        const updated = updateMessageAction(handle, {
          status: "completed",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          emitDelta({ type: "action_complete", action: updated });
        }
      },
      onActionError(handle, patch) {
        if (!handle) return;
        runningActionHandles.delete(handle);
        finishTurnAction(conversationId, handle);
        const updated = updateMessageAction(handle, {
          status: "error",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          emitDelta({ type: "action_error", action: updated });
        }
      }
    });

    await flushAnswerBuffer();

    for (const handle of runningActionHandles) {
      updateMessageAction(handle, {
        status: "stopped",
        completedAt: new Date().toISOString()
      });
    }

    updateMessage(assistantMessageId, {
      content: await contentPersistence?.finalize(providerResult.answer) ?? "",
      thinkingContent: providerResult.thinking,
      status: "completed",
      estimatedTokens: estimateTextTokens(`${providerResult.answer}\n${providerResult.thinking ?? ""}`)
    });

    deleteFailedAssistantMessages(conversation.id);
    queueConversationIndex(conversation.id);
    if (bot) {
      recordBotResult(bot.id);
      void scheduleSkillReview({
        bot,
        conversationId: conversation.id,
        assistantMessageId
      });
    }

    const completedMessage = getMessage(assistantMessageId);
    emitDelta({ type: "done", messageId: assistantMessageId, message: completedMessage ?? undefined });
    afterTurnEnded = () => {
      const usage = broadcastContextUsage();
      if (!usage || usage.contextTokens <= usage.compactionLimit) return;
      const broadcastCompaction = (type: "compaction_start" | "compaction_end") =>
        publishConversationEvent(
          { kind: "room", conversationId, message: { type: "delta", conversationId, event: { type } } },
          manager
        );
      startBackgroundCompaction(
        conversation.id,
        settings,
        {
          onCompactionStart: () => broadcastCompaction("compaction_start"),
          onCompactionEnd: () => broadcastCompaction("compaction_end")
        },
        personaId,
        appSettings.memoriesEnabled,
        appSettings.memoriesRigor,
        undefined,
        botSystemPrompt,
        bot?.id
      ).then(
        (result) => {
          if (result.didCompact) broadcastContextUsage();
        },
        (error) => console.error("Background compaction failed", error)
      );
    };
    return { status: "completed" };
  } catch (error) {
    const stopped =
      error instanceof ChatTurnStoppedError ||
      control.stopped ||
      control.abortController.signal.aborted;

    if (stopped && assistantMessageId) {
      if (answerBuffer && contentPersistence) {
        const sanitizedBuffer = await contentPersistence.appendSegment(answerBuffer);
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
        content: await contentPersistence?.finalize(latestAnswer) ?? "",
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

      emitDelta({ type: "done", messageId: assistantMessageId, message: getMessage(assistantMessageId) ?? undefined });
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
          thinkingContent: latestThinking,
          status: "error"
        });
      }
      if (bot) recordBotResult(bot.id);
      emitDelta({
        type: "error",
        message: error instanceof Error ? error.message : "Chat stream failed"
      });
      return {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Chat stream failed"
      };
    }
  } finally {
    if (researchDeadline) clearTimeout(researchDeadline);
    releaseChatTurnStart(conversationId, control);
    if (started) {
      endTurnActivity(conversationId);
      setConversationActive(conversation.id, false);
      manager.setActive(conversationId, false);
      publishConversationEvent(
        { kind: "user", userId: conversationOwnerId ?? null, message: { type: "conversation_activity", conversationId, isActive: false } },
        manager
      );
      broadcastBotStatus();
      publishConversationEvent({ kind: "status", conversationId, status: "completed" }, manager);
    }
    try {
      const [{ ensureQueuedDispatch }, { startChatTurn }] = await Promise.all([
        import("@/lib/queued-chat-dispatcher"),
        import("@/lib/chat-turn")
      ]);
      void ensureQueuedDispatch({
        manager,
        conversationId,
        startChatTurn
      }).catch((error) => {
        console.error("Queued chat dispatch failed", error);
      });
    } catch (error) {
      console.error("Queued chat dispatch failed", error);
    }
    try {
      if (afterTurnEnded) afterTurnEnded();
      else if (started) broadcastContextUsage();
    } catch (error) {
      console.error("Post-turn context usage failed", error);
    }
  }
}

async function runExistingMessageTurn(
  manager: ConversationManager,
  conversationId: string,
  messageId: string,
  control: ChatTurnControl,
  personaId?: string,
  options?: {
    preflight?: AssistantTurnStartReady;
    research?: ChatResearchOptions;
  }
): Promise<ChatTurnResult> {
  const message = getMessage(messageId);
  if (!message || message.role !== "user" || message.conversationId !== conversationId) {
    releaseChatTurnStart(conversationId, control);
    return { status: "skipped", errorMessage: "User message not found" };
  }

  const preflight = options?.preflight ?? getAssistantTurnStartPreflight(conversationId);
  if (!preflight.ok) {
    releaseChatTurnStart(conversationId, control);
    if (preflight.status === "failed") {
      publishConversationEvent(
        { kind: "room", conversationId, message: { type: "error", message: preflight.errorMessage } },
        manager
      );
    }

    return { status: preflight.status, errorMessage: preflight.errorMessage };
  }

  return runClaimedTurn(manager, conversationId, preflight, control, personaId, {
    research: options?.research
  });
}

export async function runTurnFromContent(
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: ChatTurnOptions
): Promise<ChatTurnResult> {
  const preflight = getAssistantTurnStartPreflight(conversationId, options?.providerProfileId);
  if (!preflight.ok) {
    if (preflight.status === "failed") {
      publishConversationEvent(
        { kind: "room", conversationId, message: { type: "error", message: preflight.errorMessage } },
        manager
      );
    }

    return { status: preflight.status, errorMessage: preflight.errorMessage };
  }

  const claimed = claimChatTurnStart(conversationId);
  if (!claimed.ok) {
    if (!options?.quietWhenBusy) {
      publishConversationEvent(
        { kind: "room", conversationId, message: { type: "error", message: ACTIVE_TURN_ERROR_MESSAGE } },
        manager
      );
    }
    return { status: "failed", errorMessage: ACTIVE_TURN_ERROR_MESSAGE };
  }

  const bot = getBotByConversationId(conversationId);
  const botRun =
    bot && options?.botRun?.record !== false
      ? openBotRun({
          botId: bot.id,
          conversationId,
          triggerSource: options?.botRun?.trigger ?? "dm"
        })
      : null;
  claimed.control.botRunId = botRun?.id ?? options?.botRun?.runId ?? null;

  try {
    const { userMessage, assistantMessage } = createChatTurnMessages({
      conversationId,
      content,
      attachmentIds
    });

    void generateConversationTitleFromFirstUserMessage(conversationId, userMessage.id);

    const result = await runClaimedTurn(manager, conversationId, preflight, claimed.control, personaId, {
      userMessageId: userMessage.id,
      assistantMessage,
      onMessagesCreated: options?.onMessagesCreated,
      research: options?.research,
      unattended: options?.unattended,
      toolAllowlist: options?.toolAllowlist,
      skillOwnerUserId: options?.skillOwnerUserId,
      delegationChain: options?.delegationChain,
      async onUserWait(waiting) {
        if (botRun) setBotRunWaitingForUser(botRun.id, waiting);
        await options?.onUserWait?.(waiting);
      }
    });
    if (botRun) settleBotRun({ runId: botRun.id, result, bot });
    return result;
  } catch (error) {
    releaseChatTurnStart(conversationId, claimed.control);
    if (botRun) {
      settleBotRun({
        runId: botRun.id,
        bot: null,
        result: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Bot run failed"
        }
      });
    }
    throw error;
  }
}

export function claimExistingMessageTurn(input: {
  manager: ConversationManager;
  conversationId: string;
  messageId: string;
  personaId?: string;
  research?: ChatResearchOptions;
}):
  | { ok: true; run: () => Promise<ChatTurnResult> }
  | { ok: false; statusCode: number; errorMessage: string } {
  const message = getMessage(input.messageId);
  if (!message || message.role !== "user" || message.conversationId !== input.conversationId) {
    return { ok: false, statusCode: 404, errorMessage: "User message not found" };
  }

  const claimed = claimChatTurnStart(input.conversationId);
  if (!claimed.ok) {
    return { ok: false, statusCode: 409, errorMessage: ACTIVE_TURN_ERROR_MESSAGE };
  }

  const { manager, conversationId, messageId, personaId, research } = input;
  return {
    ok: true,
    run: () => runExistingMessageTurn(manager, conversationId, messageId, claimed.control, personaId, {
      research
    })
  };
}

export function restartTurnAfterMutation<T>(input: {
  conversationId: string;
  userId: string;
  userMessageId: string;
  busyErrorMessage: string;
  logTag: string;
  mutate: (turn: { snapshot: ConversationSnapshot }) => T;
}): T | NextResponse {
  const snapshot = getConversationSnapshot(input.conversationId, input.userId);
  if (!snapshot) return badRequest("Conversation not found", 404);
  if (snapshot.conversation.isActive) return badRequest(input.busyErrorMessage, 409);

  const preflight = getAssistantTurnStartPreflight(input.conversationId);
  if (!preflight.ok) return badRequest(preflight.errorMessage, preflight.statusCode);

  const claimed = claimChatTurnStart(input.conversationId);
  if (!claimed.ok) return badRequest(input.busyErrorMessage, 409);

  try {
    const result = input.mutate({ snapshot });
    void runExistingMessageTurn(
      getConversationManager(),
      input.conversationId,
      input.userMessageId,
      claimed.control,
      undefined,
      { preflight }
    ).catch((error) => {
      releaseChatTurnStart(input.conversationId, claimed.control);
      console.error(`[${input.logTag}] continuation failed:`, error);
    });
    return result;
  } catch (error) {
    releaseChatTurnStart(input.conversationId, claimed.control);
    throw error;
  }
}
