import { z } from "zod";

import {
  LEAF_MIN_MESSAGE_COUNT,
  LEAF_SOURCE_TOKEN_LIMIT,
  LEAF_TARGET_TOKENS,
  MERGED_MIN_NODE_COUNT,
  MERGED_TARGET_TOKENS,
  SAFETY_MARGIN_TOKENS
} from "@/lib/constants";
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
import { estimatePromptTokens, estimateTextTokens } from "@/lib/tokenization";
import type {
  ChatStreamEvent,
  MemoryNode,
  Message,
  PromptMessage,
  ProviderProfileWithApiKey,
  SummaryPayload
} from "@/lib/types";

const summarySchema = z.object({
  factualCommitments: z.array(z.string()),
  userPreferences: z.array(z.string()),
  unresolvedItems: z.array(z.string()),
  importantReferences: z.array(z.string()),
  chronology: z.array(z.string()),
  sourceSpan: z.object({
    startMessageId: z.string(),
    endMessageId: z.string(),
    messageCount: z.number().int().positive()
  })
});

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
    "Return valid JSON only.",
    "Preserve facts exactly. Do not invent details.",
    "Fill every array, using empty arrays when needed.",
    `sourceSpan.startMessageId must be "${sourceSpan.startMessageId}".`,
    `sourceSpan.endMessageId must be "${sourceSpan.endMessageId}".`,
    `sourceSpan.messageCount must be ${sourceSpan.messageCount}.`,
    `Schema: {"factualCommitments": string[], "userPreferences": string[], "unresolvedItems": string[], "importantReferences": string[], "chronology": string[], "sourceSpan": {"startMessageId": string, "endMessageId": string, "messageCount": number}}`,
    "",
    blocks
  ].join("\n");
}

async function summarizeBlocks(
  conversationId: string,
  prompt: string,
  settings: ProviderProfileWithApiKey
): Promise<SummaryPayload> {
  const summaryText = await callProviderText({
    settings,
    prompt,
    purpose: "compaction",
    conversationId
  });

  return summarySchema.parse(JSON.parse(summaryText));
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

async function compactLeafMessages(
  conversationId: string,
  messages: Message[],
  settings: ProviderProfileWithApiKey
) {
  if (messages.length < LEAF_MIN_MESSAGE_COUNT) {
    return null;
  }

  let sourceTokenCount = 0;
  const selected: Message[] = [];

  for (const message of messages) {
    const messageTokenCount = Math.max(
      message.estimatedTokens,
      estimateTextTokens(`${message.content}\n${message.thinkingContent}`)
    );

    if (
      selected.length >= LEAF_MIN_MESSAGE_COUNT &&
      sourceTokenCount + messageTokenCount > LEAF_SOURCE_TOKEN_LIMIT
    ) {
      break;
    }

    selected.push(message);
    sourceTokenCount += messageTokenCount;
  }

  if (selected.length < LEAF_MIN_MESSAGE_COUNT) {
    return null;
  }

  const blocks = selected
    .map((message) => {
      if (message.role === "assistant" && message.thinkingContent) {
        return [
          `[${message.role}] ${message.id}`,
          `thinking: ${message.thinkingContent}`,
          `answer: ${message.content}`
        ].join("\n");
      }

      return `[${message.role}] ${message.id}\n${message.content}`;
    })
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

  const content = JSON.stringify(payload);
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

    const entry = [...grouped.entries()].find(([, nodes]) => nodes.length >= MERGED_MIN_NODE_COUNT);

    if (!entry) {
      return created;
    }

    const [depth, nodes] = entry;
    const selected = nodes.slice(0, MERGED_MIN_NODE_COUNT);
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
    const content = JSON.stringify(payload);
    const merged = insertMemoryNode({
      conversationId,
      type: "merged_summary",
      depth: depth + 1,
      content,
      sourceStartMessageId: selected[0].sourceStartMessageId,
      sourceEndMessageId: selected[selected.length - 1].sourceEndMessageId,
      sourceTokenCount: selected.reduce((total, node) => total + node.sourceTokenCount, 0),
      summaryTokenCount: estimateTextTokens(content) || MERGED_TARGET_TOKENS,
      childNodeIds: selected.map((node) => node.id)
    });

    supersedeNodes(selected.map((node) => node.id), merged.id);
    created = true;
  }
}

export function buildPromptMessages(input: {
  systemPrompt: string;
  messages: Message[];
  activeMemoryNodes: MemoryNode[];
  userInput?: string;
}): PromptMessage[] {
  const promptMessages: PromptMessage[] = [
    {
      role: "system",
      content: input.systemPrompt
    }
  ];

  if (input.activeMemoryNodes.length) {
    promptMessages.push({
      role: "system",
      content: `Compacted conversation memory:\n${input.activeMemoryNodes
        .map((node) => node.content)
        .join("\n\n")}`
    });
  }

  input.messages.forEach((message) => {
    if (message.role === "system" && isVisibleMessage(message)) {
      promptMessages.push({
        role: "system",
        content: message.content
      });
      return;
    }

    if (message.role === "system") {
      return;
    }

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
      content: message.content
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
    settings.modelContextLimit - settings.maxOutputTokens - SAFETY_MARGIN_TOKENS;
  const compactionLimit = Math.floor(allowedPromptTokens * settings.compactionThreshold);

  let noticeEvent: ChatStreamEvent | null = null;

  while (true) {
    const messages = listMessages(conversationId);
    const activeMemoryNodes = getActiveMemoryNodes(conversationId);
    const visibleMessages = messages.filter((message) => !message.compactedAt);
    const promptMessages = buildPromptMessages({
      systemPrompt: settings.systemPrompt,
      messages: visibleMessages,
      activeMemoryNodes
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
