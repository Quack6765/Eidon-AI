import { MAX_ATTACHMENT_TEXT_RATIO } from "@/lib/constants";
import { listMemories } from "@/lib/memories";
import { getDefaultProviderProfileWithApiKey, getProviderProfileWithApiKey, getSettings, getSettingsForUser } from "@/lib/settings";
import {
  bumpConversation,
  getConversation,
  getConversationOwnerId,
  isVisibleMessage,
  listMessages,
  markMessagesCompacted
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getPersona } from "@/lib/personas";
import {
  buildCompactionSummaryPromptBody,
  extractOpenTasks,
  selectCompactionMemoryNodes
} from "@/lib/compaction-summary";
import {
  groupCompletedTurns,
  isEmptyStreamingAssistantPlaceholder,
  renderCompletedTurns
} from "@/lib/compaction-turns";
import { referencesEarlierImageInChat } from "@/lib/image-generation/follow-up-context";
import { estimateMessageTokens, estimatePromptTokens, estimateTextTokens } from "@/lib/tokenization";
import { getActiveMemoryNodes, getRenderableMemoryNodes, insertCompactionEvent, insertMemoryNode, renderMemoryNode, supersedeNodes } from "./compaction-memory-nodes";
import { getVisibleConversationMessages, getCompletedTurns, getLatestVisibleUserMessage, getFreshConversationMessages, getCompactionEligibleMessages } from "./compaction-message-slicing";
import { buildSummaryPrompt, summarizeBlocks, buildUserPromptContent, getLatestUserMessageIndex, getMostRecentAssistantImageAttachments } from "./compaction-prompt-building";
import type {
  EnsureCompactedContextResult,
  MemoryNode,
  Message,
  ProviderProfileWithApiKey
} from "@/lib/types";

export { getActiveMemoryNodes, getRenderableMemoryNodes, insertCompactionEvent, insertMemoryNode, supersedeNodes, renderMemoryNode } from "./compaction-memory-nodes";
export { getVisibleConversationMessages, getCompletedTurns, getLatestVisibleUserMessage, getFreshConversationMessages, getCompactionEligibleMessages } from "./compaction-message-slicing";
export { buildSummaryPrompt, summarizeBlocks, truncateTextToTokenLimit, buildTextAttachmentPart, buildUserPromptContent, getLatestUserMessageIndex, getMostRecentAssistantImageAttachments } from "./compaction-prompt-building";

type CompactionLifecycleHooks = {
  onCompactionStart?: () => void;
  onCompactionEnd?: () => void;
};

async function compactLeafMessages(
  conversationId: string,
  messages: Message[],
  settings: ProviderProfileWithApiKey,
  hooks: Pick<CompactionLifecycleHooks, "onCompactionStart">
) {
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

  const payload = await summarizeBlocks(
    conversationId,
    buildSummaryPrompt("completed chat turns", blocks, {
      startMessageId: completedTurns[0].user.id,
      endMessageId: completedTurns[completedTurns.length - 1].assistant.id,
      messageCount: completedTurnMessages.length
    }, existingSummary),
    settings
  );

  const content = payload;
  const node = insertMemoryNode({
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
  });

  insertCompactionEvent({
    conversationId,
    nodeId: node.id,
    sourceStartMessageId: completedTurns[0].user.id,
    sourceEndMessageId: completedTurns[completedTurns.length - 1].assistant.id
  });
  markMessagesCompacted(completedTurnMessages.map((message) => message.id));
  bumpConversation(conversationId);

  return {
    node,
    sourceMessages: selected
  };
}

async function condenseMemoryNodes(
  conversationId: string,
  settings: ProviderProfileWithApiKey
) {
  let created = false;

  while (true) {
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
    const payload = await summarizeBlocks(
      conversationId,
      buildSummaryPrompt("compacted memory nodes", blocks, {
        startMessageId: selected[0].sourceStartMessageId,
        endMessageId: selected[selected.length - 1].sourceEndMessageId,
        messageCount: selected.length
      }, existingContext),
      settings
    );
    const content = payload;
    const merged = insertMemoryNode({
      conversationId,
      type: "merged_summary",
      depth: depth + 1,
      content,
      sourceStartMessageId: selected[0].sourceStartMessageId,
      sourceEndMessageId: selected[selected.length - 1].sourceEndMessageId,
      sourceTokenCount: selected.reduce((total, node) => total + node.sourceTokenCount, 0),
      summaryTokenCount: estimateTextTokens(content) || settings.mergedTargetTokens,
      childNodeIds: selected.map((node) => node.id)
    });

    supersedeNodes(selected.map((node) => node.id), merged.id);
    created = true;
  }
}

export function buildPromptMessages(input: {
  systemPrompt: string;
  personaContent?: string;
  messages: Message[];
  activeMemoryNodes: MemoryNode[];
  userInput?: string;
  maxAttachmentTextTokens?: number;
  memoriesEnabled?: boolean;
  memoryUserId?: string;
}): PromptMessage[] {
  const remainingAttachmentTextTokens = {
    value: input.maxAttachmentTextTokens ?? Number.POSITIVE_INFINITY
  };

  const systemParts: string[] = [input.systemPrompt];

  if (input.personaContent?.trim()) {
    systemParts.push(input.personaContent.trim());
  }

  if (input.memoriesEnabled) {
    const memories = listMemories(input.memoryUserId);
    if (memories.length > 0) {
      systemParts.push(
        "<memory>\n" +
        memories.map((m) => `${m.id}: [${m.category}] ${m.content}`).join("\n") +
        "\n</memory>"
      );
      systemParts.push(
        "You have access to memory tools (create_memory, update_memory, delete_memory) to propose memory changes for inline review. These tools do not apply changes immediately: each call creates a pending proposal the user can approve or dismiss. Use them conservatively — only for durable, recurring facts (name, location, preferences, work details). Do not save transient details about the current task. Before proposing a new memory, check if a similar one already exists and update it instead. The user can review and manage all memory proposals and memories in their settings."
      );
    }
  }

  if (input.activeMemoryNodes.length) {
    systemParts.push(
      "## Compacted Memory\n" + input.activeMemoryNodes
        .map((node) => renderMemoryNode(node.content))
        .join("\n\n")
    );
  }

  const visibleSystemMessages = input.messages.filter(
    (m) => m.role === "system" && m.systemKind !== "compaction_notice" && isVisibleMessage(m)
  );
  for (const msg of visibleSystemMessages) {
    systemParts.push(msg.content);
  }

  const promptMessages: PromptMessage[] = [
    { role: "system", content: systemParts.join("\n\n") }
  ];
  const latestUserMessageIndex = getLatestUserMessageIndex(input.messages);
  const latestUserMessage = latestUserMessageIndex >= 0 ? input.messages[latestUserMessageIndex] : null;
  const referencedAssistantImages = latestUserMessage &&
    latestUserMessage.role === "user" &&
    referencesEarlierImageInChat(latestUserMessage.content)
    ? getMostRecentAssistantImageAttachments(input.messages, latestUserMessageIndex)
    : [];

  input.messages.forEach((message, index) => {
    if (message.role === "system") return;

    if (message.role === "assistant") {
      if (isEmptyStreamingAssistantPlaceholder(message) || !message.content.trim()) {
        return;
      }

      promptMessages.push({
        role: "assistant",
        content: message.content
      });
      return;
    }

    promptMessages.push({
      role: "user",
      content: buildUserPromptContent(
        message,
        remainingAttachmentTextTokens,
        index === latestUserMessageIndex ? referencedAssistantImages : []
      )
    });
  });

  if (input.userInput) {
    promptMessages.push({
      role: "user",
      content: input.userInput
    });
  }

  return promptMessages;
}

function computeCompactionLimit(settings: ProviderProfileWithApiKey): number {
  const allowedPromptTokens =
    settings.modelContextLimit - settings.maxOutputTokens - settings.safetyMarginTokens;
  return Math.floor(allowedPromptTokens * settings.compactionThreshold);
}

function computeFirstPassContext(
  conversationId: string,
  settings: ProviderProfileWithApiKey,
  personaContent: string | undefined,
  freshTailCount: number,
  activeMemoryNodes: MemoryNode[],
  memoriesEnabled: boolean
): { promptMessages: PromptMessage[]; contextTokens: number; compactionLimit: number } {
  const conversationOwnerId = getConversationOwnerId(conversationId);
  const compactionLimit = computeCompactionLimit(settings);

  const messages = listMessages(conversationId);
  const visibleMessages = getVisibleConversationMessages(messages);
  const visibleSystemMessages = visibleMessages.filter((message) => message.role === "system");
  const freshMessages = getFreshConversationMessages(messages, freshTailCount);
  const promptHistoryMessages = [...visibleSystemMessages, ...freshMessages];

  const promptMessages = buildPromptMessages({
    systemPrompt: settings.systemPrompt,
    personaContent,
    messages: promptHistoryMessages,
    activeMemoryNodes,
    maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
    memoriesEnabled,
    memoryUserId: conversationOwnerId ?? undefined
  });

  return { promptMessages, contextTokens: estimatePromptTokens(promptMessages), compactionLimit };
}

export async function ensureCompactedContext(
  conversationId: string,
  settings: ProviderProfileWithApiKey,
  hooks: CompactionLifecycleHooks = {},
  personaId?: string,
  memoriesEnabled: boolean = false
): Promise<EnsureCompactedContextResult> {
  const conversation = getConversation(conversationId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const conversationOwnerId = getConversationOwnerId(conversationId);
  const persona = personaId ? getPersona(personaId, conversationOwnerId ?? undefined) : null;
  const personaContent = persona?.content;

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
    const buildPrompt = (messages: Message[], activeMemoryNodes: MemoryNode[]) =>
      buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        personaContent,
        messages,
        activeMemoryNodes,
        maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
        memoriesEnabled,
        memoryUserId: conversationOwnerId ?? undefined
      });

    while (true) {
      const messages = listMessages(conversationId);
      const activeMemoryNodes = getActiveMemoryNodes(conversationId);
      const visibleMessages = getVisibleConversationMessages(messages);
      const visibleSystemMessages = visibleMessages.filter((message) => message.role === "system");
      const freshMessages = getFreshConversationMessages(messages, effectiveFreshTail);
      const promptHistoryMessages = [...visibleSystemMessages, ...freshMessages];
      const { promptMessages, contextTokens: promptTokens } = computeFirstPassContext(
        conversationId,
        settings,
        personaContent,
        effectiveFreshTail,
        activeMemoryNodes,
        memoriesEnabled
      );

      if (promptTokens <= compactionLimit) {
        return {
          promptMessages,
          promptTokens,
          didCompact
        };
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
          return {
            promptMessages: selectedPromptMessages,
            promptTokens: selectedPromptTokens,
            didCompact
          };
        }
      }

      const eligible = getCompactionEligibleMessages(messages, effectiveFreshTail);
      const compacted = await compactLeafMessages(conversationId, eligible, settings, {
        onCompactionStart: beginCompaction
      });

      if (compacted) {
        didCompact = true;
        effectiveFreshTail = settings.freshTailCount;

        await condenseMemoryNodes(conversationId, settings);
        bumpConversation(conversationId);
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
          return {
            promptMessages: fallbackPromptMessages,
            promptTokens: fallbackPromptTokens,
            didCompact
          };
        }

        const latestUserOnlyTokens = estimatePromptTokens(latestUserOnlyPrompt);
        if (latestUserOnlyTokens <= compactionLimit) {
          return {
            promptMessages: latestUserOnlyPrompt,
            promptTokens: latestUserOnlyTokens,
            didCompact
          };
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
  settings: ProviderProfileWithApiKey,
  personaId?: string,
  memoriesEnabled: boolean = false
): { contextTokens: number; compactionLimit: number } {
  const conversationOwnerId = getConversationOwnerId(conversationId);
  const persona = personaId ? getPersona(personaId, conversationOwnerId ?? undefined) : null;
  const personaContent = persona?.content;
  const activeMemoryNodes = getActiveMemoryNodes(conversationId);

  const { contextTokens, compactionLimit } = computeFirstPassContext(
    conversationId,
    settings,
    personaContent,
    settings.freshTailCount,
    activeMemoryNodes,
    memoriesEnabled
  );

  return { contextTokens, compactionLimit };
}

export function getConversationContextUsage(
  conversationId: string,
  userId?: string
): { contextTokens: number | null; compactionLimit: number } | null {
  const conversation = getConversation(conversationId, userId);
  if (!conversation) return null;

  const settings =
    (conversation.providerProfileId
      ? getProviderProfileWithApiKey(conversation.providerProfileId)
      : null) ?? getDefaultProviderProfileWithApiKey();
  if (!settings) return null;

  const conversationOwnerId = getConversationOwnerId(conversationId);
  const appSettings = conversationOwnerId ? getSettingsForUser(conversationOwnerId) : getSettings();

  const messages = listMessages(conversationId);
  const hasContentMessages = messages.some((message) => message.role !== "system");

  const { contextTokens, compactionLimit } = estimateContextUsage(
    conversationId,
    settings,
    undefined,
    appSettings.memoriesEnabled
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
