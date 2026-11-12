import { MAX_ATTACHMENT_TEXT_RATIO } from "@/lib/constants";
import { selectMemoriesForPrompt } from "@/lib/memory-recall";
import { getDefaultRuntimeProviderProfile, getRuntimeProviderProfile, getSettings, getSettingsForUser } from "@/lib/settings";
import {
  bumpConversation,
  getConversation,
  getConversationOwnerId,
  listMessages
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getPersona } from "@/lib/personas";
import { buildBotSystemPrompt, getBotByConversationId } from "@/lib/bots";
import {
  extractOpenTasks,
  selectCompactionMemoryNodes
} from "@/lib/compaction-summary";
import { groupCompletedTurns, renderCompletedTurns } from "@/lib/compaction-turns";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import { computeCompactionLimit, estimateMessageTokens, estimatePromptTokens, estimateTextTokens } from "@/lib/tokenization";
import { commitLeafCompaction, commitMergedCompaction, getActiveMemoryNodes, getRenderableMemoryNodes, insertCompactionEvent, insertMemoryNode, renderMemoryNode, supersedeNodes } from "./compaction-memory-nodes";
import { getVisibleConversationMessages, getLatestVisibleUserMessage, getFreshConversationMessages, getCompactionEligibleMessages } from "./compaction-message-slicing";
import { buildSummaryPrompt, summarizeBlocks } from "./compaction-prompt-building";
import { buildPromptMessages } from "@/lib/prompt-assembly";
import type {
  EnsureCompactedContextResult,
  MemoryNode,
  MemoryRigor,
  Message,
  PromptMessage,
  RuntimeProviderProfile,
  UserMemory
} from "@/lib/types";

export { commitLeafCompaction, commitMergedCompaction, getActiveMemoryNodes, getRenderableMemoryNodes, insertCompactionEvent, insertMemoryNode, supersedeNodes, renderMemoryNode } from "./compaction-memory-nodes";
export { getVisibleConversationMessages, getCompletedTurns, getLatestVisibleUserMessage, getFreshConversationMessages, getCompactionEligibleMessages } from "./compaction-message-slicing";
export { buildSummaryPrompt, summarizeBlocks, truncateTextToTokenLimit, buildTextAttachmentPart, buildUserPromptContent, getLatestUserMessageIndex, getMostRecentAssistantImageAttachments } from "./compaction-prompt-building";

type CompactionLifecycleHooks = {
  onCompactionStart?: () => void;
  onCompactionEnd?: () => void;
};

function throwIfCompactionStopped(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw new ChatTurnStoppedError();
  }
}

async function awaitCompactionOperation<T>(operation: Promise<T>, abortSignal?: AbortSignal) {
  try {
    const result = await operation;
    throwIfCompactionStopped(abortSignal);
    return result;
  } catch (error) {
    throwIfCompactionStopped(abortSignal);
    throw error;
  }
}

async function compactLeafMessages(
  conversationId: string,
  messages: Message[],
  settings: RuntimeProviderProfile,
  hooks: Pick<CompactionLifecycleHooks, "onCompactionStart">,
  abortSignal?: AbortSignal
) {
  throwIfCompactionStopped(abortSignal);
  hooks.onCompactionStart?.();

  if (messages.length < settings.leafMinMessageCount) {
    return null;
  }

  let sourceTokenCount = 0;
  const selected: Message[] = [];

  for (const message of messages) {
    const messageTokenCount = Math.max(message.estimatedTokens, estimateMessageTokens(message));

    if (
      selected.length >= settings.leafMinMessageCount &&
      sourceTokenCount + messageTokenCount > settings.leafSourceTokenLimit
    ) {
      break;
    }

    selected.push(message);
    sourceTokenCount += messageTokenCount;
  }

  if (selected.length < settings.leafMinMessageCount) {
    return null;
  }

  const completedTurns = groupCompletedTurns(selected);
  if (!completedTurns.length) {
    return null;
  }

  const completedTurnMessages = completedTurns.flatMap((turn) => [turn.user, turn.assistant]);
  if (completedTurnMessages.length < settings.leafMinMessageCount) {
    return null;
  }

  const blocks = renderCompletedTurns(selected);

  const activeNodes = getActiveMemoryNodes(conversationId);
  const existingSummary = activeNodes.length
    ? activeNodes[activeNodes.length - 1].content
    : undefined;

  const payload = await awaitCompactionOperation(summarizeBlocks(
    conversationId,
    buildSummaryPrompt("completed chat turns", blocks, {
      startMessageId: completedTurns[0].user.id,
      endMessageId: completedTurns[completedTurns.length - 1].assistant.id,
      messageCount: completedTurnMessages.length
    }, existingSummary),
    settings,
    abortSignal
  ), abortSignal);

  const content = payload;
  const node = commitLeafCompaction({
    node: {
      conversationId,
      type: "leaf_summary",
      depth: 0,
      content,
      sourceStartMessageId: completedTurns[0].user.id,
      sourceEndMessageId: completedTurns[completedTurns.length - 1].assistant.id,
      sourceTokenCount: completedTurnMessages.reduce(
        (total, message) => total + Math.max(message.estimatedTokens, estimateMessageTokens(message)),
        0
      ),
      summaryTokenCount: estimateTextTokens(content),
      childNodeIds: []
    },
    messageIds: completedTurnMessages.map((message) => message.id)
  });

  return {
    node,
    sourceMessages: selected
  };
}

async function condenseMemoryNodes(
  conversationId: string,
  settings: RuntimeProviderProfile,
  abortSignal?: AbortSignal
) {
  let created = false;

  while (true) {
    throwIfCompactionStopped(abortSignal);
    const activeNodes = getActiveMemoryNodes(conversationId);
    const grouped = new Map<number, MemoryNode[]>();

    activeNodes.forEach((node) => {
      const list = grouped.get(node.depth) ?? [];
      list.push(node);
      grouped.set(node.depth, list);
    });

    const entry = [...grouped.entries()].find(([, nodes]) => nodes.length >= settings.mergedMinNodeCount);

    if (!entry) {
      return created;
    }

    const [depth, nodes] = entry;
    const selected = nodes.slice(0, settings.mergedMinNodeCount);
    const blocks = selected
      .map((node) => `[memory_node] ${node.id}\n${node.content}`)
      .join("\n\n");
    const existingContext = selected.map(n => `[node] ${n.id}\n${renderMemoryNode(n.content)}`).join("\n\n");
    const payload = await awaitCompactionOperation(summarizeBlocks(
      conversationId,
      buildSummaryPrompt("compacted memory nodes", blocks, {
        startMessageId: selected[0].sourceStartMessageId,
        endMessageId: selected[selected.length - 1].sourceEndMessageId,
        messageCount: selected.length
      }, existingContext),
      settings,
      abortSignal
    ), abortSignal);
    const content = payload;
    commitMergedCompaction({
      node: {
        conversationId,
        type: "merged_summary",
        depth: depth + 1,
        content,
        sourceStartMessageId: selected[0].sourceStartMessageId,
        sourceEndMessageId: selected[selected.length - 1].sourceEndMessageId,
        sourceTokenCount: selected.reduce((total, node) => total + node.sourceTokenCount, 0),
        summaryTokenCount: estimateTextTokens(content) || settings.mergedTargetTokens,
        childNodeIds: selected.map((node) => node.id)
      },
      childNodeIds: selected.map((node) => node.id)
    });
    created = true;
  }
}

function computeFirstPassContext(
  conversationId: string,
  messages: Message[],
  settings: RuntimeProviderProfile,
  personaContent: string | undefined,
  freshTailCount: number,
  activeMemoryNodes: MemoryNode[],
  memoriesEnabled: boolean,
  memoriesRigor: MemoryRigor = "balanced",
  memoryBotId?: string | null,
  selectedMemories?: UserMemory[]
): { promptMessages: PromptMessage[]; contextTokens: number; compactionLimit: number } {
  const conversationOwnerId = getConversationOwnerId(conversationId);
  const compactionLimit = computeCompactionLimit(settings);

  const visibleMessages = getVisibleConversationMessages(messages);
  const visibleSystemMessages = visibleMessages.filter((message) => message.role === "system");
  const freshMessages = getFreshConversationMessages(messages, freshTailCount);
  const promptHistoryMessages = [...visibleSystemMessages, ...freshMessages];

  const promptMessages = buildPromptMessages({
    systemPrompt: settings.systemPrompt,
    personaContent,
    conversationId,
    messages: promptHistoryMessages,
    conversationMessages: messages,
    activeMemoryNodes,
    maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
    memoriesEnabled,
    memoriesRigor,
    memoryUserId: conversationOwnerId,
    memoryBotId,
    selectedMemories
  });

  return { promptMessages, contextTokens: estimatePromptTokens(promptMessages), compactionLimit };
}

const backgroundCompactions = new Map<string, Promise<EnsureCompactedContextResult>>();

export async function ensureCompactedContext(
  ...args: Parameters<typeof compactContext>
): Promise<EnsureCompactedContextResult> {
  await backgroundCompactions.get(args[0])?.catch(() => undefined);
  return compactContext(...args);
}

export function startBackgroundCompaction(
  ...args: Parameters<typeof compactContext>
): Promise<EnsureCompactedContextResult> {
  const conversationId = args[0];
  const running = backgroundCompactions.get(conversationId);
  if (running) return running;

  const compaction = compactContext(...args).finally(() => {
    backgroundCompactions.delete(conversationId);
  });
  backgroundCompactions.set(conversationId, compaction);
  return compaction;
}

async function compactContext(
  conversationId: string,
  settings: RuntimeProviderProfile,
  hooks: CompactionLifecycleHooks = {},
  personaId?: string,
  memoriesEnabled: boolean = false,
  memoriesRigor: MemoryRigor = "balanced",
  abortSignal?: AbortSignal,
  personaContentOverride?: string | null,
  memoryBotId?: string | null
): Promise<EnsureCompactedContextResult> {
  throwIfCompactionStopped(abortSignal);
  const conversation = getConversation(conversationId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const conversationOwnerId = getConversationOwnerId(conversationId);
  const persona = personaId ? getPersona(personaId, conversationOwnerId ?? undefined) : null;
  const personaContent =
    personaContentOverride !== undefined && personaContentOverride !== null
      ? personaContentOverride
      : persona?.content;

  const compactionLimit = computeCompactionLimit(settings);

  let effectiveFreshTail = settings.freshTailCount;
  const MIN_FRESH_TAIL = 2;
  let didCompact = false;
  let compactionLifecycleOpen = false;

  const beginCompaction = () => {
    if (compactionLifecycleOpen) return;
    compactionLifecycleOpen = true;
    hooks.onCompactionStart?.();
  };

  const endCompaction = () => {
    if (!compactionLifecycleOpen) return;
    compactionLifecycleOpen = false;
    hooks.onCompactionEnd?.();
  };

  try {
    let messages = listMessages(conversationId);
    const memorySelection = memoriesEnabled && conversationOwnerId
      ? await selectMemoriesForPrompt(
          conversationOwnerId,
          memoryBotId ? { botId: memoryBotId } : undefined,
          getLatestVisibleUserMessage(getVisibleConversationMessages(messages))?.content ?? ""
        ).catch(() => null)
      : null;
    const selectedMemories = memorySelection?.selected;
    const finish = (promptMessages: PromptMessage[], promptTokens: number): EnsureCompactedContextResult => ({
      promptMessages,
      promptTokens,
      didCompact,
      ...(memorySelection
        ? { memoriesUsed: memorySelection.selected.length, memoriesTotal: memorySelection.total }
        : {})
    });

    const buildPrompt = (historyMessages: Message[], activeMemoryNodes: MemoryNode[], includeMemories = true) =>
      buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        personaContent,
        conversationId,
        messages: historyMessages,
        conversationMessages: messages,
        activeMemoryNodes,
        maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
        memoriesEnabled: memoriesEnabled && includeMemories,
        memoriesRigor,
        memoryUserId: conversationOwnerId,
        memoryBotId,
        selectedMemories
      });

    while (true) {
      throwIfCompactionStopped(abortSignal);
      const activeMemoryNodes = getActiveMemoryNodes(conversationId);
      const visibleMessages = getVisibleConversationMessages(messages);
      const visibleSystemMessages = visibleMessages.filter((message) => message.role === "system");
      const freshMessages = getFreshConversationMessages(messages, effectiveFreshTail);
      const promptHistoryMessages = [...visibleSystemMessages, ...freshMessages];
      const { promptMessages, contextTokens: promptTokens } = computeFirstPassContext(
        conversationId,
        messages,
        settings,
        personaContent,
        effectiveFreshTail,
        activeMemoryNodes,
        memoriesEnabled,
        memoriesRigor,
        memoryBotId,
        selectedMemories
      );

      if (promptTokens <= compactionLimit) {
        return finish(promptMessages, promptTokens);
      }

      const latestUserMessage = getLatestVisibleUserMessage(visibleMessages);
      const renderedMemoryNodes = getRenderableMemoryNodes(activeMemoryNodes);
      const basePromptMessages = buildPrompt(promptHistoryMessages, []);
      const remainingBudget = Math.max(compactionLimit - estimatePromptTokens(basePromptMessages), 0);
      const selectedMemoryNodes = selectCompactionMemoryNodes({
        activeNodes: renderedMemoryNodes,
        latestUserMessage: latestUserMessage?.content ?? "",
        summaryTokenBudget: remainingBudget
      });

      if (selectedMemoryNodes.length) {
        const selectedPromptMessages = buildPrompt(promptHistoryMessages, selectedMemoryNodes);
        const selectedPromptTokens = estimatePromptTokens(selectedPromptMessages);

        if (selectedPromptTokens <= compactionLimit) {
          return finish(selectedPromptMessages, selectedPromptTokens);
        }
      }

      const eligible = getCompactionEligibleMessages(messages, effectiveFreshTail);
      const compacted = await compactLeafMessages(conversationId, eligible, settings, {
        onCompactionStart: beginCompaction
      }, abortSignal);

      if (compacted) {
        didCompact = true;
        effectiveFreshTail = settings.freshTailCount;

        await condenseMemoryNodes(conversationId, settings, abortSignal);
        bumpConversation(conversationId);
        messages = listMessages(conversationId);
        continue;
      }

      if (effectiveFreshTail > MIN_FRESH_TAIL) {
        effectiveFreshTail = Math.max(
          MIN_FRESH_TAIL,
          effectiveFreshTail - Math.ceil(effectiveFreshTail / 3)
        );
        continue;
      }

      const openTaskNodes = renderedMemoryNodes.filter((node) => extractOpenTasks(node.content).length > 0);
      const latestUserOnlyMessages = latestUserMessage ? [latestUserMessage] : [];
      const latestUserOnlyHistoryMessages = [...visibleSystemMessages, ...latestUserOnlyMessages];
      const latestUserOnlyPrompt = buildPrompt(latestUserOnlyHistoryMessages, []);
      const fallbackBudget = Math.max(compactionLimit - estimatePromptTokens(latestUserOnlyPrompt), 0);
      const fallbackMemoryNodes = selectCompactionMemoryNodes({
        activeNodes: openTaskNodes,
        latestUserMessage: latestUserMessage?.content ?? "",
        summaryTokenBudget: fallbackBudget
      });

      if (latestUserMessage) {
        const fallbackPromptMessages = buildPrompt(latestUserOnlyHistoryMessages, fallbackMemoryNodes);
        const fallbackPromptTokens = estimatePromptTokens(fallbackPromptMessages);

        if (fallbackPromptTokens <= compactionLimit) {
          return finish(fallbackPromptMessages, fallbackPromptTokens);
        }

        const latestUserOnlyTokens = estimatePromptTokens(latestUserOnlyPrompt);
        if (latestUserOnlyTokens <= compactionLimit) {
          return finish(latestUserOnlyPrompt, latestUserOnlyTokens);
        }

        if (memoriesEnabled) {
          const memorylessPrompt = buildPrompt(latestUserOnlyHistoryMessages, [], false);
          const memorylessTokens = estimatePromptTokens(memorylessPrompt);
          if (memorylessTokens <= compactionLimit) {
            return finish(memorylessPrompt, memorylessTokens);
          }
        }
      }

      throw new Error(
        "Conversation exceeds the configured context limit. No fallback available."
      );
    }
  } finally {
    endCompaction();
  }
}

export function estimateContextUsage(
  conversationId: string,
  settings: RuntimeProviderProfile,
  personaId?: string,
  memoriesEnabled: boolean = false,
  memoriesRigor: MemoryRigor = "balanced",
  conversationMessages: Message[] = listMessages(conversationId),
  personaContentOverride?: string | null,
  memoryBotId?: string | null
): { contextTokens: number; compactionLimit: number } {
  const conversationOwnerId = getConversationOwnerId(conversationId);
  const persona = personaId ? getPersona(personaId, conversationOwnerId ?? undefined) : null;
  const personaContent = personaContentOverride ?? persona?.content;
  const activeMemoryNodes = getActiveMemoryNodes(conversationId);

  const { contextTokens, compactionLimit } = computeFirstPassContext(
    conversationId,
    conversationMessages,
    settings,
    personaContent,
    settings.freshTailCount,
    activeMemoryNodes,
    memoriesEnabled,
    memoriesRigor,
    memoryBotId
  );

  return { contextTokens, compactionLimit };
}

export function getConversationContextUsage(
  conversationId: string,
  userId?: string
): { contextTokens: number | null; compactionLimit: number } | null {
  const conversation = getConversation(conversationId, userId);
  if (!conversation) return null;

  const conversationOwnerId = getConversationOwnerId(conversationId);
  const settings =
    (conversation.providerProfileId
      ? getRuntimeProviderProfile(conversation.providerProfileId)
      : null) ?? getDefaultRuntimeProviderProfile(conversationOwnerId);
  if (!settings) return null;

  const appSettings = conversationOwnerId ? getSettingsForUser(conversationOwnerId) : getSettings();

  const messages = listMessages(conversationId);
  const hasContentMessages = messages.some((message) => message.role !== "system");
  const bot = getBotByConversationId(conversationId);

  const { contextTokens, compactionLimit } = estimateContextUsage(
    conversationId,
    settings,
    undefined,
    appSettings.memoriesEnabled,
    appSettings.memoriesRigor,
    messages,
    bot ? buildBotSystemPrompt(bot, appSettings.botSystemPrompt) : undefined,
    bot?.id
  );

  return { contextTokens: hasContentMessages ? contextTokens : null, compactionLimit };
}

export function getConversationDebugStats(conversationId: string) {
  const db = getDb();
  const rawTurnCount = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM messages
       WHERE conversation_id = ? AND role != 'system'`
    )
    .get(conversationId) as { count: number };
  const memoryNodeCount = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM memory_nodes
       WHERE conversation_id = ?`
    )
    .get(conversationId) as { count: number };
  const latestCompaction = db
    .prepare(
      `SELECT created_at
       FROM compaction_events
       WHERE conversation_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(conversationId) as { created_at: string } | undefined;

  return {
    rawTurnCount: rawTurnCount.count,
    memoryNodeCount: memoryNodeCount.count,
    latestCompactionAt: latestCompaction?.created_at ?? null
  };
}
