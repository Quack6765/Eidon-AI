import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import { getSettings } from "@/lib/settings";
import { estimateTextTokens } from "@/lib/tokenization";
import type {
  Conversation,
  ConversationListPage,
  Message,
  MessageAction,
  MessageActionKind,
  MessageActionStatus,
  MessageRole,
  MessageStatus,
  SystemMessageKind,
  ToolExecutionMode
} from "@/lib/types";

export const DEFAULT_CONVERSATION_PAGE_SIZE = 10;

type ConversationRow = {
  id: string;
  title: string;
  folder_id: string | null;
  provider_profile_id: string | null;
  tool_execution_mode: ToolExecutionMode;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type ConversationCursor = {
  updatedAt: string;
  id: string;
};

function nowIso() {
  return new Date().toISOString();
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folder_id,
    providerProfileId: row.provider_profile_id,
    toolExecutionMode: row.tool_execution_mode,
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
    createdAt: row.created_at,
    actions: []
  };
}

function rowToMessageAction(row: {
  id: string;
  message_id: string;
  kind: MessageActionKind;
  status: MessageActionStatus;
  server_id: string | null;
  skill_id: string | null;
  tool_name: string | null;
  label: string;
  detail: string;
  arguments_json: string | null;
  result_summary: string;
  sort_order: number;
  started_at: string;
  completed_at: string | null;
}): MessageAction {
  return {
    id: row.id,
    messageId: row.message_id,
    kind: row.kind,
    status: row.status,
    serverId: row.server_id,
    skillId: row.skill_id,
    toolName: row.tool_name,
    label: row.label,
    detail: row.detail,
    arguments: row.arguments_json ? (JSON.parse(row.arguments_json) as Record<string, unknown>) : null,
    resultSummary: row.result_summary,
    sortOrder: row.sort_order,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function isVisibleMessage(
  message: Pick<Message, "role" | "systemKind">
) {
  return message.role !== "system" || message.systemKind !== null;
}

function encodeConversationCursor(cursor: ConversationCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeConversationCursor(cursor: string): ConversationCursor {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<ConversationCursor>;
  if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string") {
    throw new Error("Invalid conversation cursor");
  }
  return {
    updatedAt: parsed.updatedAt,
    id: parsed.id
  };
}

export function listConversations() {
  const rows = getDb()
    .prepare(
      `SELECT id, title, folder_id, provider_profile_id, tool_execution_mode, sort_order, created_at, updated_at
       FROM conversations
       ORDER BY updated_at DESC`
    )
    .all() as ConversationRow[];

  return rows.map(rowToConversation);
}

export function listConversationsPage(input: {
  limit?: number;
  cursor?: string | null;
} = {}): ConversationListPage {
  const limit = input.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE;
  const cursor = input.cursor ? decodeConversationCursor(input.cursor) : null;

  const rows = cursor
    ? (getDb()
        .prepare(
          `SELECT id, title, folder_id, provider_profile_id, tool_execution_mode, sort_order, created_at, updated_at
           FROM conversations
           WHERE updated_at < ?
             OR (updated_at = ? AND id < ?)
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`
        )
        .all(cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1) as ConversationRow[])
    : (getDb()
        .prepare(
          `SELECT id, title, folder_id, provider_profile_id, tool_execution_mode, sort_order, created_at, updated_at
           FROM conversations
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`
        )
        .all(limit + 1) as ConversationRow[]);

  const hasMore = rows.length > limit;
  const conversations = rows.slice(0, limit).map(rowToConversation);
  const lastConversation = conversations.at(-1);

  return {
    conversations,
    nextCursor: hasMore && lastConversation
      ? encodeConversationCursor({
          updatedAt: lastConversation.updatedAt,
          id: lastConversation.id
        })
      : null,
    hasMore
  };
}

export function getConversation(conversationId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, title, folder_id, provider_profile_id, tool_execution_mode, sort_order, created_at, updated_at
       FROM conversations
       WHERE id = ?`
    )
    .get(conversationId) as
    | {
        id: string;
        title: string;
        folder_id: string | null;
        provider_profile_id: string | null;
        tool_execution_mode: ToolExecutionMode;
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
    toolExecutionMode: "read_only" as ToolExecutionMode,
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
        tool_execution_mode,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conversation.id,
      conversation.title,
      conversation.folderId,
      conversation.providerProfileId,
      conversation.toolExecutionMode,
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

function listMessageActionsForMessageIds(messageIds: string[]) {
  if (!messageIds.length) {
    return [];
  }

  const placeholders = messageIds.map(() => "?").join(", ");

  const rows = getDb()
    .prepare(
      `SELECT
        id,
        message_id,
        kind,
        status,
        server_id,
        skill_id,
        tool_name,
        label,
        detail,
        arguments_json,
        result_summary,
        sort_order,
        started_at,
        completed_at
       FROM message_actions
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, sort_order ASC, started_at ASC`
    )
    .all(...messageIds) as Array<{
      id: string;
      message_id: string;
      kind: MessageActionKind;
      status: MessageActionStatus;
      server_id: string | null;
      skill_id: string | null;
      tool_name: string | null;
      label: string;
      detail: string;
      arguments_json: string | null;
      result_summary: string;
      sort_order: number;
      started_at: string;
      completed_at: string | null;
    }>;

  return rows.map(rowToMessageAction);
}

function attachActionsToMessages(messages: Message[]) {
  const actionsByMessageId = new Map<string, MessageAction[]>();

  listMessageActionsForMessageIds(messages.map((message) => message.id)).forEach((action) => {
    const current = actionsByMessageId.get(action.messageId) ?? [];
    current.push(action);
    actionsByMessageId.set(action.messageId, current);
  });

  return messages.map((message) => ({
    ...message,
    actions: actionsByMessageId.get(message.id) ?? []
  }));
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

  return attachActionsToMessages(rows.map(rowToMessage));
}

export function listVisibleMessages(conversationId: string) {
  return listMessages(conversationId).filter(isVisibleMessage);
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

  if (!row) {
    return null;
  }

  return attachActionsToMessages([rowToMessage(row)])[0] ?? null;
}

export function createMessageAction(input: {
  messageId: string;
  kind: MessageActionKind;
  status?: MessageActionStatus;
  serverId?: string | null;
  skillId?: string | null;
  toolName?: string | null;
  label: string;
  detail?: string;
  arguments?: Record<string, unknown> | null;
  resultSummary?: string;
  sortOrder?: number;
}) {
  const timestamp = nowIso();
  const action: MessageAction = {
    id: createId("act"),
    messageId: input.messageId,
    kind: input.kind,
    status: input.status ?? "running",
    serverId: input.serverId ?? null,
    skillId: input.skillId ?? null,
    toolName: input.toolName ?? null,
    label: input.label,
    detail: input.detail ?? "",
    arguments: input.arguments ?? null,
    resultSummary: input.resultSummary ?? "",
    sortOrder: input.sortOrder ?? 0,
    startedAt: timestamp,
    completedAt: null
  };

  getDb()
    .prepare(
      `INSERT INTO message_actions (
        id,
        message_id,
        kind,
        status,
        server_id,
        skill_id,
        tool_name,
        label,
        detail,
        arguments_json,
        result_summary,
        sort_order,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      action.id,
      action.messageId,
      action.kind,
      action.status,
      action.serverId,
      action.skillId,
      action.toolName,
      action.label,
      action.detail,
      action.arguments ? JSON.stringify(action.arguments) : null,
      action.resultSummary,
      action.sortOrder,
      action.startedAt,
      action.completedAt
    );

  return action;
}

export function updateMessageAction(
  actionId: string,
  patch: {
    status?: MessageActionStatus;
    detail?: string;
    resultSummary?: string;
    completedAt?: string | null;
  }
) {
  const current = getDb()
    .prepare(
      `SELECT
        id,
        message_id,
        kind,
        status,
        server_id,
        skill_id,
        tool_name,
        label,
        detail,
        arguments_json,
        result_summary,
        sort_order,
        started_at,
        completed_at
       FROM message_actions
       WHERE id = ?`
    )
    .get(actionId) as
    | {
        id: string;
        message_id: string;
        kind: MessageActionKind;
        status: MessageActionStatus;
        server_id: string | null;
        skill_id: string | null;
        tool_name: string | null;
        label: string;
        detail: string;
        arguments_json: string | null;
        result_summary: string;
        sort_order: number;
        started_at: string;
        completed_at: string | null;
      }
    | undefined;

  if (!current) {
    return null;
  }

  getDb()
    .prepare(
      `UPDATE message_actions
       SET status = ?, detail = ?, result_summary = ?, completed_at = ?
       WHERE id = ?`
    )
    .run(
      patch.status ?? current.status,
      patch.detail ?? current.detail,
      patch.resultSummary ?? current.result_summary,
      patch.completedAt !== undefined ? patch.completedAt : current.completed_at,
      actionId
    );

  return listMessageActionsForMessageIds([current.message_id]).find((action) => action.id === actionId) ?? null;
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

export function updateConversationToolExecutionMode(
  conversationId: string,
  toolExecutionMode: ToolExecutionMode
) {
  const timestamp = nowIso();
  getDb()
    .prepare(
      `UPDATE conversations
       SET tool_execution_mode = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(toolExecutionMode, timestamp, conversationId);
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
      `SELECT DISTINCT
        c.id,
        c.title,
        c.folder_id,
        c.provider_profile_id,
        c.tool_execution_mode,
        c.sort_order,
        c.created_at,
        c.updated_at
       FROM conversations c
       LEFT JOIN messages m ON c.id = m.conversation_id
       WHERE c.title LIKE ?
          OR (
            m.content LIKE ?
            AND (m.role != 'system' OR m.system_kind IS NOT NULL)
          )
       ORDER BY c.updated_at DESC`
    )
    .all(likeQuery, likeQuery) as Array<{
    id: string;
    title: string;
    folder_id: string | null;
    provider_profile_id: string | null;
    tool_execution_mode: ToolExecutionMode;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map(rowToConversation);
}
