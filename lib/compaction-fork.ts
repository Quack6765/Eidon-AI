import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";

type MemoryNodeRow = {
  id: string;
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
};

type CompactionEventRow = {
  id: string;
  node_id: string;
  source_start_message_id: string;
  source_end_message_id: string;
  notice_message_id: string | null;
  created_at: string;
};

export function copyCompactionStateForConversationFork(input: {
  sourceConversationId: string;
  targetConversationId: string;
  retainedMessageIds: Set<string>;
  targetMessageIdBySourceId: Map<string, string>;
}) {
  const db = getDb();
  const sourceMemoryNodes = db
    .prepare(
      `SELECT
        id,
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
       WHERE conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(input.sourceConversationId) as MemoryNodeRow[];

  const retainedMemoryNodes = sourceMemoryNodes.filter(
    (node) =>
      input.retainedMessageIds.has(node.source_start_message_id) &&
      input.retainedMessageIds.has(node.source_end_message_id)
  );
  const cloneableMemoryNodeIds = new Set(retainedMemoryNodes.map((node) => node.id));
  let hasChanges = true;

  while (hasChanges) {
    hasChanges = false;
    for (const node of retainedMemoryNodes) {
      if (!cloneableMemoryNodeIds.has(node.id)) continue;
      const childNodeIds = JSON.parse(node.child_node_ids) as string[];
      if (childNodeIds.some((childNodeId) => !cloneableMemoryNodeIds.has(childNodeId))) {
        cloneableMemoryNodeIds.delete(node.id);
        hasChanges = true;
      }
    }
  }

  const clonedNodeIdBySourceId = new Map<string, string>();
  retainedMemoryNodes.forEach((node) => {
    if (cloneableMemoryNodeIds.has(node.id)) {
      clonedNodeIdBySourceId.set(node.id, createId("mem"));
    }
  });

  retainedMemoryNodes.forEach((node) => {
    const clonedNodeId = clonedNodeIdBySourceId.get(node.id);
    if (!clonedNodeId) return;
    const clonedStartMessageId = input.targetMessageIdBySourceId.get(node.source_start_message_id);
    const clonedEndMessageId = input.targetMessageIdBySourceId.get(node.source_end_message_id);
    if (!clonedStartMessageId || !clonedEndMessageId) return;
    const childNodeIds = JSON.parse(node.child_node_ids) as string[];
    const clonedChildNodeIds = childNodeIds
      .map((childNodeId) => clonedNodeIdBySourceId.get(childNodeId))
      .filter((childNodeId): childNodeId is string => Boolean(childNodeId));
    if (clonedChildNodeIds.length !== childNodeIds.length) return;
    const clonedSupersededByNodeId = node.superseded_by_node_id
      ? clonedNodeIdBySourceId.get(node.superseded_by_node_id) ?? null
      : null;

    db.prepare(
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      clonedNodeId,
      input.targetConversationId,
      node.type,
      node.depth,
      node.content,
      clonedStartMessageId,
      clonedEndMessageId,
      node.source_token_count,
      node.summary_token_count,
      JSON.stringify(clonedChildNodeIds),
      clonedSupersededByNodeId,
      node.created_at
    );
  });

  const sourceEvents = db
    .prepare(
      `SELECT
        id,
        node_id,
        source_start_message_id,
        source_end_message_id,
        notice_message_id,
        created_at
       FROM compaction_events
       WHERE conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(input.sourceConversationId) as CompactionEventRow[];

  sourceEvents.forEach((event) => {
    const clonedNodeId = clonedNodeIdBySourceId.get(event.node_id);
    const clonedStartMessageId = input.targetMessageIdBySourceId.get(event.source_start_message_id);
    const clonedEndMessageId = input.targetMessageIdBySourceId.get(event.source_end_message_id);
    if (!clonedNodeId || !clonedStartMessageId || !clonedEndMessageId) return;
    const clonedNoticeMessageId = event.notice_message_id
      ? input.targetMessageIdBySourceId.get(event.notice_message_id) ?? null
      : null;
    if (event.notice_message_id && !clonedNoticeMessageId) return;

    db.prepare(
      `INSERT INTO compaction_events (
        id,
        conversation_id,
        node_id,
        source_start_message_id,
        source_end_message_id,
        notice_message_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("cmp"),
      input.targetConversationId,
      clonedNodeId,
      clonedStartMessageId,
      clonedEndMessageId,
      clonedNoticeMessageId,
      event.created_at
    );
  });
}
