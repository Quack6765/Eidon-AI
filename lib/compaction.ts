import { MAX_ATTACHMENT_TEXT_RATIO } from "@/lib/constants";
import { listMemories } from "@/lib/memories";
import { getSettings } from "@/lib/settings";
import {
  bumpConversation,
  getConversation,
  isVisibleMessage,
  listMessages,
  markMessagesCompacted
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { getPersona } from "@/lib/personas";
import { callProviderText } from "@/lib/provider";
import {
  groupCompletedTurns,
  isEmptyStreamingAssistantPlaceholder,
  renderCompletedTurns
} from "@/lib/compaction-turns";
import { estimateMessageTokens, estimatePromptTokens, estimateTextTokens, estimatePromptContentTokens } from "@/lib/tokenization";
import type {
  EnsureCompactedContextResult,
  MemoryNode,
  Message,
  MessageAttachment,
  PromptContentPart,
  PromptMessage,
  ProviderProfileWithApiKey
} from "@/lib/types";

type CompactionLifecycleHooks = {
  onCompactionStart?: () => void;
  onCompactionEnd?: () => void;
};

function dropOldestMemoryNode(conversationId: string): boolean {
  const db = getDb();
  const node = db.prepare(
    `SELECT id FROM memory_nodes
     WHERE conversation_id = ? AND superseded_by_node_id IS NULL
     ORDER BY depth DESC, created_at ASC
     LIMIT 1`
  ).get(conversationId) as { id: string } | undefined;

  if (!node) return false;

  db.prepare(
    `UPDATE memory_nodes SET superseded_by_node_id = '_dropped'
     WHERE id = ?`
  ).run(node.id);

  return true;
}

function getActiveMemoryNodes(conversationId: string): MemoryNode[] {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
       FROM memory_nodes
       WHERE conversation_id = ? AND superseded_by_node_id IS NULL
       ORDER BY created_at ASC`
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    type: "leaf_summary" | "merged_summary";
    depth: number;
    content: string;
    source_start_message_id: string;
    source_end_message_id: string;
    source_token_count: number;
    summary_token_count: number;
    child_node_ids: string;
    superseded_by_node_id: string | null;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type,
    depth: row.depth,
    content: row.content,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    sourceTokenCount: row.source_token_count,
    summaryTokenCount: row.summary_token_count,
    childNodeIds: JSON.parse(row.child_node_ids) as string[],
    supersededByNodeId: row.superseded_by_node_id,
    createdAt: row.created_at
  }));
}

function insertMemoryNode(input: {
  conversationId: string;
  type: "leaf_summary" | "merged_summary";
  depth: number;
  content: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceTokenCount: number;
  summaryTokenCount: number;
  childNodeIds?: string[];
}) {
  const node = {
    id: createId("mem"),
    conversationId: input.conversationId,
    type: input.type,
    depth: input.depth,
    content: input.content,
    sourceStartMessageId: input.sourceStartMessageId,
    sourceEndMessageId: input.sourceEndMessageId,
    sourceTokenCount: input.sourceTokenCount,
    summaryTokenCount: input.summaryTokenCount,
    childNodeIds: input.childNodeIds ?? [],
    createdAt: new Date().toISOString()
  };

  getDb()
    .prepare(
      `INSERT INTO memory_nodes (
        id,
        conversation_id,
        type,
        depth,
        content,
        source_start_message_id,
        source_end_message_id,
        source_token_count,
        summary_token_count,
        child_node_ids,
        superseded_by_node_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    )
    .run(
      node.id,
      node.conversationId,
      node.type,
      node.depth,
      node.content,
      node.sourceStartMessageId,
      node.sourceEndMessageId,
      node.sourceTokenCount,
      node.summaryTokenCount,
      JSON.stringify(node.childNodeIds),
      node.createdAt
    );

  return node;
}

function supersedeNodes(nodeIds: string[], parentNodeId: string) {
  const statement = getDb().prepare(
    `UPDATE memory_nodes
     SET superseded_by_node_id = ?
     WHERE id = ?`
  );

  const transaction = getDb().transaction((ids: string[]) => {
    ids.forEach((id) => statement.run(parentNodeId, id));
  });

  transaction(nodeIds);
}

function buildSummaryPrompt(label: string, blocks: string, sourceSpan: {
  startMessageId: string;
  endMessageId: string;
  messageCount: number;
}, existingSummary?: string) {
  const parts: string[] = [];

  if (existingSummary) {
    parts.push(
      "You are updating this existing conversation summary.",
      "",
      "EXISTING SUMMARY (for context):",
      existingSummary,
      "",
      "NEW MESSAGES:",
      blocks,
      "",
      "Produce an updated summary that incorporates the new messages into the existing context.",
      "Write your response as a bullet-point list grouped by these categories:",
      "- Facts & commitments the assistant needs to remember",
      "- User preferences and constraints",
      "- Unresolved questions or open tasks",
      "- Important technical references or files",
      "- Chronology of key events",
      "",
      "Be specific and concise. Use short sentences. Do not invent details.",
      `sourceSpan: startMessageId="${sourceSpan.startMessageId}", endMessageId="${sourceSpan.endMessageId}", messageCount=${sourceSpan.messageCount}`
    );
  } else {
    parts.push(
      `You are compacting ${label} for a chat memory engine.`,
      "",
      "Write your response as a bullet-point list grouped by these categories:",
      "- Facts & commitments the assistant needs to remember",
      "- User preferences and constraints",
      "- Unresolved questions or open tasks",
      "- Important technical references or files",
      "- Chronology of key events",
      "",
      "Be specific and concise. Use short sentences. Do not invent details.",
      blocks,
      "",
      `sourceSpan: startMessageId="${sourceSpan.startMessageId}", endMessageId="${sourceSpan.endMessageId}", messageCount=${sourceSpan.messageCount}`
    );
  }

  return parts.join("\n");
}

async function summarizeBlocks(
  conversationId: string,
  prompt: string,
  settings: ProviderProfileWithApiKey
): Promise<string> {
  return await callProviderText({
    settings,
    prompt,
    purpose: "compaction",
    conversationId
  });
}

function getCompactionEligibleMessages(messages: Message[], freshTailCount: number) {
  const rawMessages = messages.filter(
    (message) => message.role !== "system" && !message.compactedAt
  );

  if (rawMessages.length <= freshTailCount) {
    return [];
  }

  return rawMessages.slice(0, rawMessages.length - freshTailCount);
}

function truncateTextToTokenLimit(text: string, maxTokens: number) {
  if (!text.trim() || maxTokens <= 0) {
    return "";
  }

  if (estimateTextTokens(text) <= maxTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid).trimEnd();

    if (estimateTextTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function buildTextAttachmentPart(
  attachment: MessageAttachment,
  remainingAttachmentTextTokens: { value: number }
): PromptContentPart {
  const header = `Attached file: ${attachment.filename}\n`;
  const truncationMarker = "\n[truncated]";
  const availableTokens = Math.max(
    remainingAttachmentTextTokens.value -
      estimateTextTokens(header) -
      estimateTextTokens(truncationMarker),
    0
  );
  const excerpt = truncateTextToTokenLimit(attachment.extractedText, availableTokens);
  const needsTruncation = excerpt !== attachment.extractedText;
  const text = `${header}${excerpt || (attachment.extractedText ? "" : "[empty file]")}${
    needsTruncation ? truncationMarker : ""
  }`.trimEnd();

  remainingAttachmentTextTokens.value = Math.max(
    remainingAttachmentTextTokens.value - estimateTextTokens(excerpt),
    0
  );

  return {
    type: "text",
    text
  };
}

function buildUserPromptContent(
  message: Pick<Message, "content" | "attachments">,
  remainingAttachmentTextTokens: { value: number }
): PromptMessage["content"] {
  const parts: PromptContentPart[] = [];

  if (message.content) {
    parts.push({
      type: "text",
      text: message.content
    });
  }

  (message.attachments ?? []).forEach((attachment) => {
    if (attachment.kind === "image") {
      parts.push({
        type: "text",
        text: `Attached image: ${attachment.filename}`
      });
      parts.push({
        type: "image",
        attachmentId: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        relativePath: attachment.relativePath
      });
      return;
    }

    parts.push(buildTextAttachmentPart(attachment, remainingAttachmentTextTokens));
  });

  if (!parts.length) {
    return "";
  }

  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text;
  }

  return parts;
}

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

  const blocks = renderCompletedTurns(selected);
  const completedTurnMessages = completedTurns.flatMap((turn) => [turn.user, turn.assistant]);

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

function renderMemoryNode(content: string): string {
  if (content.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(content);
      const parts: string[] = [];
      if (parsed.factualCommitments?.length) parts.push("Facts: " + parsed.factualCommitments.join(", "));
      if (parsed.userPreferences?.length) parts.push("Preferences: " + parsed.userPreferences.join(", "));
      if (parsed.unresolvedItems?.length) parts.push("Unresolved: " + parsed.unresolvedItems.join(", "));
      if (parsed.importantReferences?.length) parts.push("References: " + parsed.importantReferences.join(", "));
      if (parsed.chronology?.length) parts.push("Chronology: " + parsed.chronology.join(", "));
      return parts.join("\n");
    } catch {
      return content;
    }
  }
  return content;
}

async function scoreMemoryNodes(input: {
  userInput: string;
  activeNodes: MemoryNode[];
  settings: ProviderProfileWithApiKey;
  conversationId: string;
}): Promise<string[]> {
  const { userInput, activeNodes, settings, conversationId } = input;

  const nodeBlocks = activeNodes
    .map((node) => `[node: ${node.id}] ${renderMemoryNode(node.content)}`)
    .join("\n\n");

  const prompt = [
    "The user just asked:",
    `"${userInput}"`,
    "",
    "Which of these context summaries are relevant?",
    'Return only a valid JSON object: {"relevantNodes": ["nodeId1", "nodeId2"]}',
    "",
    "Context summaries:",
    nodeBlocks
  ].join("\n");

  try {
    const result = await callProviderText({ settings, prompt, purpose: "compaction", conversationId });
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed.relevantNodes)) {
      return parsed.relevantNodes.filter((id: string): id is string => typeof id === "string" && id.length > 0);
    }
    return [];
  } catch {
    return [];
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
}): PromptMessage[] {
  const remainingAttachmentTextTokens = {
    value: input.maxAttachmentTextTokens ?? Number.POSITIVE_INFINITY
  };

  // Build single merged system message
  const systemParts: string[] = [input.systemPrompt];

  // Append persona content if provided
  if (input.personaContent?.trim()) {
    systemParts.push(input.personaContent.trim());
  }

  if (input.memoriesEnabled) {
    const memories = listMemories();
    if (memories.length > 0) {
      systemParts.push(
        "<memory>\n" +
        memories.map((m) => `${m.id}: [${m.category}] ${m.content}`).join("\n") +
        "\n</memory>"
      );
      systemParts.push(
        "You have access to memory tools (create_memory, update_memory, delete_memory) to persist facts about the user across conversations. Use these conservatively — only save durable, recurring facts (name, location, preferences, work details). Do not save transient details about the current task. Before creating a new memory, check if a similar one already exists and update it instead. The user can see and manage all memories in their settings."
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

  // Include visible non-hidden system messages
  const visibleSystemMessages = input.messages.filter(
    (m) => m.role === "system" && m.systemKind !== "compaction_notice" && isVisibleMessage(m)
  );
  for (const msg of visibleSystemMessages) {
    systemParts.push(msg.content);
  }

  const promptMessages: PromptMessage[] = [
    { role: "system", content: systemParts.join("\n\n") }
  ];

  // Non-system messages
  input.messages.forEach((message) => {
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
      content: buildUserPromptContent(message, remainingAttachmentTextTokens)
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

  const persona = personaId ? getPersona(personaId) : null;
  const personaContent = persona?.content;

  const allowedPromptTokens =
    settings.modelContextLimit - settings.maxOutputTokens - settings.safetyMarginTokens;
  const compactionLimit = Math.floor(allowedPromptTokens * settings.compactionThreshold);

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
    while (true) {
      const messages = listMessages(conversationId);
      const activeMemoryNodes = getActiveMemoryNodes(conversationId);
      const visibleMessages = messages.filter((message) => !message.compactedAt);
      const promptMessages = buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        personaContent,
        messages: visibleMessages,
        activeMemoryNodes,
        maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
        memoriesEnabled
      });
      const promptTokens = estimatePromptTokens(promptMessages);

      if (promptTokens <= compactionLimit) {
        const lastUserMessage = visibleMessages.filter(m => m.role === "user").at(-1);
        let selectedNodes = activeMemoryNodes;

        if (activeMemoryNodes.length > 2) {
          const scoredNodeIds = await scoreMemoryNodes({
            userInput: lastUserMessage?.content ?? "",
            activeNodes: activeMemoryNodes,
            settings,
            conversationId
          });

          if (scoredNodeIds.length > 0 && scoredNodeIds.length < activeMemoryNodes.length) {
            const scored = activeMemoryNodes.filter(n => scoredNodeIds.includes(n.id));
            const unscored = activeMemoryNodes.filter(n => !scoredNodeIds.includes(n.id));

            const sortedUnscored = [...unscored].sort((a, b) => {
              if (b.depth !== a.depth) return b.depth - a.depth;
              return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            });

            selectedNodes = [...scored];
            const scoredTokens = buildPromptMessages({
              systemPrompt: settings.systemPrompt,
              personaContent,
              messages: visibleMessages,
              activeMemoryNodes: scored,
              maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
              memoriesEnabled
            }).reduce((t, m) => {
              if (typeof m.content === "string") return t + estimateTextTokens(m.content) + 12;
              return t + estimatePromptContentTokens(m.content) + 12;
            }, 0);

            const remaining = compactionLimit - scoredTokens;
            for (const node of sortedUnscored) {
              const nodeTokens = node.summaryTokenCount;
              if (nodeTokens <= remaining) {
                selectedNodes.push(node);
              }
            }
          }
        }

        const finalPromptMessages = buildPromptMessages({
          systemPrompt: settings.systemPrompt,
          personaContent,
          messages: visibleMessages,
          activeMemoryNodes: selectedNodes,
          maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
          memoriesEnabled
        });

        return {
          promptMessages: finalPromptMessages,
          promptTokens: estimatePromptTokens(finalPromptMessages),
          didCompact
        };
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
        effectiveFreshTail = Math.max(MIN_FRESH_TAIL, effectiveFreshTail - Math.ceil(effectiveFreshTail / 3));
        continue;
      }

      const dropped = dropOldestMemoryNode(conversationId);

      if (dropped) {
        continue;
      }

      const lastUserMessage = [...messages].reverse().find(m => m.role === "user" && !m.compactedAt);
      const remainingNodes = getActiveMemoryNodes(conversationId);

      if (lastUserMessage) {
        const promptMessages = buildPromptMessages({
          systemPrompt: settings.systemPrompt,
          personaContent,
          messages: [lastUserMessage],
          activeMemoryNodes: remainingNodes,
          memoriesEnabled
        });
        return { promptMessages, promptTokens: estimatePromptTokens(promptMessages), didCompact };
      }

      throw new Error(
        "Conversation exceeds the configured context limit. No fallback available."
      );
    }
  } finally {
    endCompaction();
  }
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
