import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { estimateTextTokens } from "@/lib/tokenization";
import type { MemoryNode } from "@/lib/types";

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

export function getActiveMemoryNodes(conversationId: string): MemoryNode[] {
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
       ORDER BY created_at ASC, rowid ASC`
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

export function estimateRenderedMemoryNodeTokens(node: MemoryNode): number {
  return Math.max(0, estimateTextTokens(renderMemoryNode(node.content)));
}

export function getRenderableMemoryNodes(activeNodes: MemoryNode[]): MemoryNode[] {
  return activeNodes.map((node) => ({
    ...node,
    summaryTokenCount: estimateRenderedMemoryNodeTokens(node)
  }));
}

export function insertCompactionEvent(input: {
  conversationId: string;
  nodeId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  noticeMessageId?: string | null;
}) {
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
      createId("cmp"),
      input.conversationId,
      input.nodeId,
      input.sourceStartMessageId,
      input.sourceEndMessageId,
      input.noticeMessageId ?? null,
      new Date().toISOString()
    );
}

export function insertMemoryNode(input: {
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

export function supersedeNodes(nodeIds: string[], parentNodeId: string) {
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

export { renderMemoryNode };
