import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { getSettings } from "@/lib/settings";
import { estimateTextTokens } from "@/lib/tokenization";
import type { Conversation, Message, MessageRole, MessageStatus, SystemMessageKind } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToConversation(row: {
  id: string;
  title: string;
  folder_id: string | null;
  provider_profile_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}): Conversation {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    providerProfileId: row.provider_profile_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToMessage(row: {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  thinking_content: string;
  status: MessageStatus;
  estimated_tokens: number;
  system_kind: SystemMessageKind | null;
  compacted_at: string | null;
  created_at: string;
}): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    thinkingContent: row.thinking_content,
    status: row.status,
    estimatedTokens: row.estimated_tokens,
    systemKind: row.system_kind,
    compactedAt: row.compacted_at,
    createdAt: row.created_at
  };
}

export function listConversations() {
  const rows = getDb()
    .prepare(
      `SELECT id, title, folder_id, provider_profile_id, sort_order, created_at, updated_at
       FROM conversations
       ORDER BY updated_at DESC`
    )
    .all() as Array<{
    id: string;
    title: string;
    folder_id: string | null;
    provider_profile_id: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToConversation);
}

export function getConversation(conversationId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, title, folder_id, provider_profile_id, sort_order, created_at, updated_at
       FROM conversations
       WHERE id = ?`
    )
    .get(conversationId) as
    | {
        id: string;
        title: string;
        folder_id: string | null;
        provider_profile_id: string | null;
        sort_order: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  return row ? rowToConversation(row) : null;
}

export function createConversation(title = "New conversation", folderId?: string | null) {
  const timestamp = nowIso();
  const settings = getSettings();

  const maxOrder = getDb()
    .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM conversations")
    .get() as { max_order: number };

  const conversation = {
    id: createId("conv"),
    title,
    folderId: folderId ?? null,
    providerProfileId: settings.defaultProviderProfileId,
    sortOrder: maxOrder.max_order + 1,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO conversations (
        id,
        title,
        folder_id,
        provider_profile_id,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conversation.id,
      conversation.title,
      conversation.folderId,
      conversation.providerProfileId,
      conversation.sortOrder,
      conversation.createdAt,
      conversation.updatedAt
    );

  return conversation;
}

export function deleteConversation(conversationId: string) {
  getDb().prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
}

export function renameConversation(conversationId: string, title: string) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE conversations
       SET title = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(title, timestamp, conversationId);
}

export function bumpConversation(conversationId: string) {
  getDb()
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(nowIso(), conversationId);
}

export function createMessage(input: {
  conversationId: string;
  role: MessageRole;
  content?: string;
  thinkingContent?: string;
  status?: MessageStatus;
  systemKind?: SystemMessageKind | null;
  estimatedTokens?: number;
}) {
  const timestamp = nowIso();
  const message = {
    id: createId("msg"),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content ?? "",
    thinkingContent: input.thinkingContent ?? "",
    status: input.status ?? "completed",
    estimatedTokens:
      input.estimatedTokens ?? estimateTextTokens(`${input.content ?? ""}\n${input.thinkingContent ?? ""}`),
    systemKind: input.systemKind ?? null,
    createdAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO messages (
        id,
        conversation_id,
        role,
        content,
        thinking_content,
        status,
        estimated_tokens,
        system_kind,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.thinkingContent,
      message.status,
      message.estimatedTokens,
      message.systemKind,
      message.createdAt
    );

  bumpConversation(input.conversationId);

  return message;
}

export function updateAssistantMessage(
  messageId: string,
  patch: {
    content?: string;
    thinkingContent?: string;
    status?: MessageStatus;
    estimatedTokens?: number;
  }
) {
  const current = getDb()
    .prepare(
      `SELECT content, thinking_content, status, estimated_tokens
       FROM messages
       WHERE id = ?`
    )
    .get(messageId) as
    | {
        content: string;
        thinking_content: string;
        status: MessageStatus;
        estimated_tokens: number;
      }
    | undefined;

  if (!current) {
    return;
  }

  getDb()
    .prepare(
      `UPDATE messages
       SET content = ?,
           thinking_content = ?,
           status = ?,
           estimated_tokens = ?
       WHERE id = ?`
    )
    .run(
      patch.content ?? current.content,
      patch.thinkingContent ?? current.thinking_content,
      patch.status ?? current.status,
      patch.estimatedTokens ?? current.estimated_tokens,
      messageId
    );
}

export function listMessages(conversationId: string) {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        role,
        content,
        thinking_content,
        status,
        estimated_tokens,
        system_kind,
        compacted_at,
        created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(conversationId) as Array<{
    id: string;
    conversation_id: string;
    role: MessageRole;
    content: string;
    thinking_content: string;
    status: MessageStatus;
    estimated_tokens: number;
    system_kind: SystemMessageKind | null;
    compacted_at: string | null;
    created_at: string;
  }>;

  return rows.map(rowToMessage);
}

export function getMessage(messageId: string) {
  const row = getDb()
    .prepare(
      `SELECT
        id,
        conversation_id,
        role,
        content,
        thinking_content,
        status,
        estimated_tokens,
        system_kind,
        compacted_at,
        created_at
       FROM messages
       WHERE id = ?`
    )
    .get(messageId) as
    | {
        id: string;
        conversation_id: string;
        role: MessageRole;
        content: string;
        thinking_content: string;
        status: MessageStatus;
        estimated_tokens: number;
        system_kind: SystemMessageKind | null;
        compacted_at: string | null;
        created_at: string;
      }
    | undefined;

  return row ? rowToMessage(row) : null;
}

export function markMessagesCompacted(messageIds: string[]) {
  if (!messageIds.length) {
    return;
  }

  const compactedAt = nowIso();
  const statement = getDb().prepare(
    `UPDATE messages
     SET compacted_at = ?
     WHERE id = ?`
  );

  const transaction = getDb().transaction((ids: string[]) => {
    ids.forEach((id) => statement.run(compactedAt, id));
  });

  transaction(messageIds);
}

export function maybeRetitleConversationFromFirstUserMessage(conversationId: string) {
  const firstUserMessage = getDb()
    .prepare(
      `SELECT content
       FROM messages
       WHERE conversation_id = ? AND role = 'user'
       ORDER BY created_at ASC
       LIMIT 1`
    )
    .get(conversationId) as { content: string } | undefined;

  if (!firstUserMessage) {
    return;
  }

  const rawTitle = firstUserMessage.content.trim().replace(/\s+/g, " ");
  const title = rawTitle.length > 64 ? `${rawTitle.slice(0, 61)}...` : rawTitle;

  renameConversation(conversationId, title || "New conversation");
}

export function moveConversationToFolder(conversationId: string, folderId: string | null) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE conversations SET folder_id = ?, updated_at = ? WHERE id = ?`
    )
    .run(folderId, timestamp, conversationId);
}

export function updateConversationProviderProfile(
  conversationId: string,
  providerProfileId: string
) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE conversations
       SET provider_profile_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(providerProfileId, timestamp, conversationId);
}

export function reorderConversations(items: Array<{ id: string; folderId: string | null }>) {
  const statement = getDb()
    .prepare("UPDATE conversations SET sort_order = ?, folder_id = ?, updated_at = ? WHERE id = ?");

  const timestamp = nowIso();
  const transaction = getDb().transaction(
    (entries: Array<{ id: string; folderId: string | null; sortOrder: number }>) => {
      entries.forEach((entry) => {
        statement.run(entry.sortOrder, entry.folderId, timestamp, entry.id);
      });
    }
  );

  transaction(
    items.map((item, index) => ({
      id: item.id,
      folderId: item.folderId,
      sortOrder: index
    }))
  );
}

export function searchConversations(query: string) {
  const likeQuery = `%${query}%`;

  const rows = getDb()
    .prepare(
      `SELECT DISTINCT c.id, c.title, c.folder_id, c.provider_profile_id, c.sort_order, c.created_at, c.updated_at
       FROM conversations c
       LEFT JOIN messages m ON c.id = m.conversation_id
       WHERE c.title LIKE ? OR m.content LIKE ?
       ORDER BY c.updated_at DESC`
    )
    .all(likeQuery, likeQuery) as Array<{
    id: string;
    title: string;
    folder_id: string | null;
    provider_profile_id: string | null;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToConversation);
}
