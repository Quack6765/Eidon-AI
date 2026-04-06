import { MAX_ATTACHMENT_TEXT_RATIO } from "@/lib/constants";
import {
  bumpConversation,
  createMessage,
  getConversation,
  isVisibleMessage,
  listMessages,
  markMessagesCompacted
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { callProviderText } from "@/lib/provider";
import { estimateMessageTokens, estimatePromptTokens, estimateTextTokens } from "@/lib/tokenization";
import type {
  ChatStreamEvent,
  MemoryNode,
  Message,
  MessageAttachment,
  PromptContentPart,
  PromptMessage,
  ProviderProfileWithApiKey
} from "@/lib/types";

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
}) {
  return [
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
  ].join("\n");
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

function renderAttachmentSummary(attachments: MessageAttachment[]) {
  if (!attachments.length) {
    return "";
  }

  return attachments
    .map((attachment) => {
      if (attachment.kind === "image") {
        return `attachment image: ${attachment.filename} (${attachment.mimeType})`;
      }

      const parts = [`attachment file: ${attachment.filename}`];

      if (attachment.extractedText) {
        parts.push(attachment.extractedText);
      }

      return parts.join("\n");
    })
    .join("\n\n");
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
  settings: ProviderProfileWithApiKey
) {
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

  const blocks = selected
    .map((message) => {
      const attachmentSummary = renderAttachmentSummary(message.attachments ?? []);

      if (message.role === "assistant" && message.thinkingContent) {
        return [
          `[${message.role}] ${message.id}`,
          `thinking: ${message.thinkingContent}`,
          `answer: ${message.content}`,
          attachmentSummary
        ]
          .filter(Boolean)
          .join("\n");
      }

      return [[`[${message.role}] ${message.id}`, message.content, attachmentSummary]
        .filter(Boolean)
        .join("\n")];
    })
    .flat()
    .join("\n\n");

  const payload = await summarizeBlocks(
    conversationId,
    buildSummaryPrompt("raw chat messages", blocks, {
      startMessageId: selected[0].id,
      endMessageId: selected[selected.length - 1].id,
      messageCount: selected.length
    }),
    settings
  );

  const content = payload;
  const node = insertMemoryNode({
    conversationId,
    type: "leaf_summary",
    depth: 0,
    content,
    sourceStartMessageId: selected[0].id,
    sourceEndMessageId: selected[selected.length - 1].id,
    sourceTokenCount,
    summaryTokenCount: estimateTextTokens(content),
    childNodeIds: []
  });

  markMessagesCompacted(selected.map((message) => message.id));

  const notice = createMessage({
    conversationId,
    role: "system",
    content: "Older context compacted to stay within model limits.",
    systemKind: "compaction_notice",
    status: "completed"
  });

  getDb()
    .prepare(
      `INSERT INTO compaction_events (
        id,
        conversation_id,
        node_id,
        source_start_message_id,
        source_end_message_id,
        notice_message_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      createId("compact"),
      conversationId,
      node.id,
      node.sourceStartMessageId,
      node.sourceEndMessageId,
      notice.id,
      new Date().toISOString()
    );

  return {
    node,
    notice,
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
    const payload = await summarizeBlocks(
      conversationId,
      buildSummaryPrompt("compacted memory nodes", blocks, {
        startMessageId: selected[0].sourceStartMessageId,
        endMessageId: selected[selected.length - 1].sourceEndMessageId,
        messageCount: selected.length
      }),
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

export function buildPromptMessages(input: {
  systemPrompt: string;
  messages: Message[];
  activeMemoryNodes: MemoryNode[];
  userInput?: string;
  maxAttachmentTextTokens?: number;
}): PromptMessage[] {
  const remainingAttachmentTextTokens = {
    value: input.maxAttachmentTextTokens ?? Number.POSITIVE_INFINITY
  };

  // Build single merged system message
  const systemParts: string[] = [input.systemPrompt];

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
      const parts = [
        message.thinkingContent ? `Thinking:\n${message.thinkingContent}` : "",
        message.content ? `Answer:\n${message.content}` : ""
      ].filter(Boolean);

      promptMessages.push({
        role: "assistant",
        content: parts.join("\n\n")
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
  settings: ProviderProfileWithApiKey
): Promise<{
  promptMessages: PromptMessage[];
  promptTokens: number;
  compactionNoticeEvent: ChatStreamEvent | null;
}> {
  const conversation = getConversation(conversationId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const allowedPromptTokens =
    settings.modelContextLimit - settings.maxOutputTokens - settings.safetyMarginTokens;
  const compactionLimit = Math.floor(allowedPromptTokens * settings.compactionThreshold);

  let noticeEvent: ChatStreamEvent | null = null;

  while (true) {
    const messages = listMessages(conversationId);
    const activeMemoryNodes = getActiveMemoryNodes(conversationId);
    const visibleMessages = messages.filter((message) => !message.compactedAt);
    const promptMessages = buildPromptMessages({
      systemPrompt: settings.systemPrompt,
      messages: visibleMessages,
      activeMemoryNodes,
      maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO)
    });
    const promptTokens = estimatePromptTokens(promptMessages);

    if (promptTokens <= compactionLimit) {
      return {
        promptMessages,
        promptTokens,
        compactionNoticeEvent: noticeEvent
      };
    }

    const eligible = getCompactionEligibleMessages(messages, settings.freshTailCount);
    const compacted = await compactLeafMessages(conversationId, eligible, settings);

    if (!compacted) {
      throw new Error(
        "Conversation exceeds the configured context limit even after compaction. Increase the context limit or lower max output tokens."
      );
    }

    noticeEvent = {
      type: "system_notice",
      text: compacted.notice.content,
      kind: "compaction_notice"
    };

    await condenseMemoryNodes(conversationId, settings);
    bumpConversation(conversationId);
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
