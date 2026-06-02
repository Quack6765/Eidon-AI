import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type {
  ChatInputMode,
  QueuedMessage,
  QueuedMessageStatus
} from "@/lib/types";
import { nowIso } from "@/lib/utils";

function rowToQueuedMessage(row: {
  id: string;
  conversation_id: string;
  content: string;
  status: QueuedMessageStatus;
  sort_order: number;
  failure_message: string | null;
  mode: ChatInputMode;
  created_at: string;
  updated_at: string;
  processing_started_at: string | null;
}): QueuedMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    content: row.content,
    status: row.status,
    sortOrder: row.sort_order,
    failureMessage: row.failure_message,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processingStartedAt: row.processing_started_at
  };
}

export function listQueuedMessages(conversationId: string) {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        content,
        status,
        sort_order,
        failure_message,
        mode,
        created_at,
        updated_at,
        processing_started_at
       FROM queued_messages
       WHERE conversation_id = ?
       ORDER BY sort_order ASC, created_at ASC, rowid ASC`
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    content: string;
    status: QueuedMessageStatus;
    sort_order: number;
    failure_message: string | null;
    mode: ChatInputMode;
    created_at: string;
    updated_at: string;
    processing_started_at: string | null;
  }>;

  return rows.map(rowToQueuedMessage);
}

export function createQueuedMessage({
  conversationId,
  content,
  mode = "chat"
}: {
  conversationId: string;
  content: string;
  mode?: ChatInputMode;
}) {
  const db = getDb();
  const selectMaxSortOrder = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM queued_messages WHERE conversation_id = ?"
  );
  const insertQueuedMessage = db.prepare(
    `INSERT INTO queued_messages (
      id,
      conversation_id,
      content,
      status,
      sort_order,
      failure_message,
      mode,
      processing_started_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const transaction = db.transaction((targetConversationId: string, queuedContent: string, queuedMode: ChatInputMode) => {
    const timestamp = nowIso();
    const nextSortOrder =
      ((selectMaxSortOrder.get(targetConversationId) as { max_sort_order: number | null }).max_sort_order ?? -1) + 1;

    const queuedMessage: QueuedMessage = {
      id: createId("queue"),
      conversationId: targetConversationId,
      content: queuedContent,
      status: "pending",
      sortOrder: nextSortOrder,
      failureMessage: null,
      mode: queuedMode,
      createdAt: timestamp,
      updatedAt: timestamp,
      processingStartedAt: null
    };

    insertQueuedMessage.run(
      queuedMessage.id,
      queuedMessage.conversationId,
      queuedMessage.content,
      queuedMessage.status,
      queuedMessage.sortOrder,
      queuedMessage.failureMessage,
      queuedMessage.mode,
      queuedMessage.processingStartedAt,
      queuedMessage.createdAt,
      queuedMessage.updatedAt
    );

    return queuedMessage;
  });

  return transaction(conversationId, content, mode);
}

export function updateQueuedMessage({
  conversationId,
  queuedMessageId,
  content
}: {
  conversationId: string;
  queuedMessageId: string;
  content: string;
}) {
  const db = getDb();
  const updateQueuedMessageRow = db.prepare(
    `UPDATE queued_messages
     SET content = ?,
         updated_at = ?
     WHERE id = ?
       AND conversation_id = ?`
  );
  const selectQueuedMessageRow = db.prepare(
    `SELECT
      id,
      conversation_id,
      content,
      status,
      sort_order,
      failure_message,
      mode,
      created_at,
      updated_at,
      processing_started_at
     FROM queued_messages
     WHERE id = ?
       AND conversation_id = ?`
  );

  const transaction = db.transaction((targetConversationId: string, targetQueuedMessageId: string, nextContent: string) => {
    const timestamp = nowIso();
    const result = updateQueuedMessageRow.run(nextContent, timestamp, targetQueuedMessageId, targetConversationId);

    if (result.changes === 0) {
      return null;
    }

    const row = selectQueuedMessageRow.get(targetQueuedMessageId, targetConversationId) as
      | {
          id: string;
          conversation_id: string;
          content: string;
          status: QueuedMessageStatus;
          sort_order: number;
          failure_message: string | null;
          mode: ChatInputMode;
          created_at: string;
          updated_at: string;
          processing_started_at: string | null;
        }
      | undefined;

    return row ? rowToQueuedMessage(row) : null;
  });

  return transaction(conversationId, queuedMessageId, content);
}

export function deleteQueuedMessage({
  conversationId,
  queuedMessageId
}: {
  conversationId: string;
  queuedMessageId: string;
}) {
  const result = getDb()
    .prepare(
      `DELETE FROM queued_messages
       WHERE id = ?
         AND conversation_id = ?`
    )
    .run(queuedMessageId, conversationId);

  return result.changes > 0;
}

export function failQueuedMessage({
  conversationId,
  queuedMessageId,
  failureMessage
}: {
  conversationId: string;
  queuedMessageId: string;
  failureMessage: string;
}) {
  const timestamp = nowIso();
  const result = getDb()
    .prepare(
      `UPDATE queued_messages
       SET status = 'failed',
           failure_message = ?,
           processing_started_at = NULL,
           updated_at = ?
       WHERE id = ?
         AND conversation_id = ?
         AND status = 'processing'`
    )
    .run(failureMessage, timestamp, queuedMessageId, conversationId);

  return result.changes > 0;
}

export function markOrphanedQueuedMessagesFailed(
  conversationId: string,
  failureMessage = "Queued follow-up was abandoned before dispatch completed"
) {
  const timestamp = nowIso();
  const result = getDb()
    .prepare(
      `UPDATE queued_messages
       SET status = 'failed',
           failure_message = ?,
           processing_started_at = NULL,
           updated_at = ?
       WHERE conversation_id = ?
         AND status = 'processing'`
    )
    .run(failureMessage, timestamp, conversationId);

  return result.changes;
}

export function moveQueuedMessageToFront({
  conversationId,
  queuedMessageId
}: {
  conversationId: string;
  queuedMessageId: string;
}) {
  const db = getDb();
  const selectRows = db.prepare(
    `SELECT
      id,
      conversation_id,
      content,
      status,
      sort_order,
      failure_message,
      mode,
      created_at,
      updated_at,
      processing_started_at
     FROM queued_messages
     WHERE conversation_id = ?
     ORDER BY sort_order ASC, created_at ASC, rowid ASC`
  );
  const updateSortOrder = db.prepare(
    "UPDATE queued_messages SET sort_order = ?, updated_at = ? WHERE id = ? AND conversation_id = ?"
  );

  const transaction = db.transaction((targetConversationId: string, targetQueuedMessageId: string) => {
    const rows = selectRows.all(targetConversationId) as Array<{
      id: string;
      conversation_id: string;
      content: string;
      status: QueuedMessageStatus;
      sort_order: number;
      failure_message: string | null;
      mode: ChatInputMode;
      created_at: string;
      updated_at: string;
      processing_started_at: string | null;
    }>;
    const targetIndex = rows.findIndex((row) => row.id === targetQueuedMessageId);

    if (targetIndex <= 0) {
      return targetIndex === 0;
    }

    const reorderedRows = [rows[targetIndex], ...rows.slice(0, targetIndex), ...rows.slice(targetIndex + 1)];
    const timestamp = nowIso();
    reorderedRows.forEach((row, index) => {
      updateSortOrder.run(index, timestamp, row.id, targetConversationId);
    });

    return true;
  });

  return transaction(conversationId, queuedMessageId);
}

export function claimNextQueuedMessageForDispatch(conversationId: string) {
  const db = getDb();
  const selectProcessing = db.prepare(
    `SELECT id
     FROM queued_messages
     WHERE conversation_id = ?
       AND status = 'processing'
     LIMIT 1`
  );
  const selectNextPending = db.prepare(
    `SELECT
      id,
      conversation_id,
      content,
      status,
      sort_order,
      failure_message,
      mode,
      created_at,
      updated_at,
      processing_started_at
     FROM queued_messages
     WHERE conversation_id = ?
       AND status = 'pending'
     ORDER BY sort_order ASC, created_at ASC, rowid ASC
     LIMIT 1`
  );
  const claimQueuedMessage = db.prepare(
    `UPDATE queued_messages
     SET status = 'processing',
         failure_message = NULL,
         processing_started_at = ?,
         updated_at = ?
     WHERE id = ?
       AND status = 'pending'`
  );

  const transaction = db.transaction((targetConversationId: string) => {
    const processingRow = selectProcessing.get(targetConversationId) as { id: string } | undefined;

    if (processingRow) {
      return null;
    }

    const row = selectNextPending.get(targetConversationId) as
      | {
          id: string;
          conversation_id: string;
          content: string;
          status: QueuedMessageStatus;
          sort_order: number;
          failure_message: string | null;
          mode: ChatInputMode;
          created_at: string;
          updated_at: string;
          processing_started_at: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const timestamp = nowIso();
    const result = claimQueuedMessage.run(timestamp, timestamp, row.id);

    if (result.changes === 0) {
      return null;
    }

    return rowToQueuedMessage({
      ...row,
      status: "processing",
      failure_message: null,
      updated_at: timestamp,
      processing_started_at: timestamp
    });
  });

  return transaction(conversationId);
}
