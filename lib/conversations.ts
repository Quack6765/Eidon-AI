import {
  assignAttachmentsToMessage,
  deleteConversationAttachmentFiles,
  listAttachmentsForMessageIds
} from "@/lib/attachments";
import {
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE,
  DEFAULT_CONVERSATION_TITLE,
  generateConversationTitle
} from "@/lib/conversation-title-generator";
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import {
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey,
  getSettings
} from "@/lib/settings";
import { getConversationManager } from "@/lib/ws-singleton";
import { estimateMessageTokens, estimateTextTokens } from "@/lib/tokenization";
import type {
  Conversation,
  ConversationListPage,
  ConversationTitleGenerationStatus,
  Message,
  MessageAttachment,
  MessageAction,
  MessageActionKind,
  MessageActionStatus,
  MessageTextSegment,
  MessageTimelineItem,
  MessageRole,
  MessageStatus,
  SystemMessageKind
} from "@/lib/types";

export const DEFAULT_CONVERSATION_PAGE_SIZE = 10;

type ConversationRow = {
  id: string;
  title: string;
  title_generation_status: ConversationTitleGenerationStatus;
  folder_id: string | null;
  provider_profile_id: string | null;
  automation_id: string | null;
  automation_run_id: string | null;
  conversation_origin: "manual" | "automation";
  sort_order: number;
  created_at: string;
  updated_at: string;
  is_active: number;
};

type ConversationCursor = {
  updatedAt: string;
  id: string;
};

function conversationActivityTimestampSql(alias: string) {
  return `COALESCE((
    SELECT MAX(m.created_at)
    FROM messages m
    WHERE m.conversation_id = ${alias}.id
      AND m.role != 'system'
  ), ${alias}.updated_at)`;
}

function nowIso() {
  return new Date().toISOString();
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    titleGenerationStatus: row.title_generation_status,
    folderId: row.folder_id,
    providerProfileId: row.provider_profile_id,
    automationId: row.automation_id,
    automationRunId: row.automation_run_id,
    conversationOrigin: row.conversation_origin,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: row.is_active === 1
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
    actions: [],
    attachments: []
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

function rowToMessageTextSegment(row: {
  id: string;
  message_id: string;
  content: string;
  sort_order: number;
  created_at: string;
}): MessageTextSegment {
  return {
    id: row.id,
    messageId: row.message_id,
    content: row.content,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  };
}

function buildMessageTimeline(message: Message): MessageTimelineItem[] {
  const textItems = (message.textSegments ?? []).map((segment) => ({
    id: segment.id,
    timelineKind: "text" as const,
    sortOrder: segment.sortOrder,
    createdAt: segment.createdAt,
    content: segment.content
  }));
  const actionItems = (message.actions ?? []).map((action) => ({
    ...action,
    timelineKind: "action" as const
  }));

  const getTimelineTimestamp = (item: MessageTimelineItem) =>
    item.timelineKind === "text" ? item.createdAt : item.startedAt;

  return [...textItems, ...actionItems].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return getTimelineTimestamp(left).localeCompare(getTimelineTimestamp(right));
  });
}

export function isVisibleMessage(
  message: Pick<Message, "role" | "systemKind">
) {
  if (message.role !== "system") {
    return true;
  }

  return message.systemKind !== null && message.systemKind !== "compaction_notice";
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
  const activityTimestamp = conversationActivityTimestampSql("c");
  const rows = getDb()
    .prepare(
      `SELECT
        c.id,
        c.title,
        c.title_generation_status,
        c.folder_id,
        c.provider_profile_id,
        c.automation_id,
        c.automation_run_id,
        c.conversation_origin,
        c.sort_order,
        c.created_at,
        ${activityTimestamp} AS updated_at,
        c.is_active
       FROM conversations c
       ORDER BY ${activityTimestamp} DESC, c.id DESC`
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
  const activityTimestamp = conversationActivityTimestampSql("c");

  const rows = cursor
    ? (getDb()
        .prepare(
          `SELECT
            c.id,
            c.title,
            c.title_generation_status,
            c.folder_id,
            c.provider_profile_id,
            c.automation_id,
            c.automation_run_id,
            c.conversation_origin,
            c.sort_order,
            c.created_at,
            ${activityTimestamp} AS updated_at,
            c.is_active
           FROM conversations c
           WHERE ${activityTimestamp} < ?
             OR (${activityTimestamp} = ? AND c.id < ?)
           ORDER BY ${activityTimestamp} DESC, c.id DESC
           LIMIT ?`
        )
        .all(cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1) as ConversationRow[])
    : (getDb()
        .prepare(
          `SELECT
            c.id,
            c.title,
            c.title_generation_status,
            c.folder_id,
            c.provider_profile_id,
            c.automation_id,
            c.automation_run_id,
            c.conversation_origin,
            c.sort_order,
            c.created_at,
            ${activityTimestamp} AS updated_at,
            c.is_active
           FROM conversations c
           ORDER BY ${activityTimestamp} DESC, c.id DESC
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
  const activityTimestamp = conversationActivityTimestampSql("c");
  const row = getDb()
    .prepare(
      `SELECT
        c.id,
        c.title,
        c.title_generation_status,
        c.folder_id,
        c.provider_profile_id,
        c.automation_id,
        c.automation_run_id,
        c.conversation_origin,
        c.sort_order,
        c.created_at,
        ${activityTimestamp} AS updated_at,
        c.is_active
       FROM conversations c
       WHERE c.id = ?`
    )
    .get(conversationId) as ConversationRow | undefined;

  return row ? rowToConversation(row) : null;
}

export function createConversation(
  title?: string | null,
  folderId?: string | null,
  options?: {
    providerProfileId?: string | null;
  }
) {
  const timestamp = nowIso();
  const settings = getSettings();
  const trimmedTitle = title?.trim() ?? "";

  const maxOrder = getDb()
    .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM conversations")
    .get() as { max_order: number };

  const conversation = {
    id: createId("conv"),
    title: trimmedTitle || DEFAULT_CONVERSATION_TITLE,
    titleGenerationStatus: (trimmedTitle ? "completed" : "pending") as ConversationTitleGenerationStatus,
    folderId: folderId ?? null,
    providerProfileId: options?.providerProfileId ?? settings.defaultProviderProfileId,
    automationId: null,
    automationRunId: null,
    conversationOrigin: "manual" as const,
    sortOrder: maxOrder.max_order + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    isActive: false
  };

  getDb()
    .prepare(
      `INSERT INTO conversations (
        id,
        title,
        title_generation_status,
        folder_id,
        provider_profile_id,
        automation_id,
        automation_run_id,
        conversation_origin,
        sort_order,
        created_at,
        updated_at,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conversation.id,
      conversation.title,
      conversation.titleGenerationStatus,
      conversation.folderId,
      conversation.providerProfileId,
      conversation.automationId,
      conversation.automationRunId,
      conversation.conversationOrigin,
      conversation.sortOrder,
      conversation.createdAt,
      conversation.updatedAt,
      0
    );

  return conversation;
}

function deleteConversationRecord(conversationId: string) {
  deleteConversationAttachmentFiles(conversationId);
  getDb().prepare("DELETE FROM message_attachments WHERE conversation_id = ?").run(conversationId);
  return getDb().prepare("DELETE FROM conversations WHERE id = ?").run(conversationId).changes > 0;
}

export function deleteConversation(conversationId: string) {
  const transaction = getDb().transaction((id: string) => {
    deleteConversationRecord(id);
  });

  transaction(conversationId);
}

export function deleteConversationIfEmpty(conversationId: string) {
  const transaction = getDb().transaction((id: string) => {
    const conversation = getDb()
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(id) as { id: string } | undefined;

    if (!conversation) {
      return false;
    }

    const message = getDb()
      .prepare("SELECT id FROM messages WHERE conversation_id = ? LIMIT 1")
      .get(id) as { id: string } | undefined;

    if (message) {
      return false;
    }

    return deleteConversationRecord(id);
  });

  return transaction(conversationId);
}

export function renameConversation(conversationId: string, title: string) {
  updateConversationTitleRecord({
    conversationId,
    title,
    titleGenerationStatus: "completed"
  });
}

function updateConversationTitleRecord(input: {
  conversationId: string;
  title?: string;
  titleGenerationStatus?: ConversationTitleGenerationStatus;
  updateTimestamp?: boolean;
}) {
  const current = getDb()
    .prepare(
      `SELECT title, title_generation_status, updated_at
       FROM conversations
       WHERE id = ?`
    )
    .get(input.conversationId) as
    | {
        title: string;
        title_generation_status: ConversationTitleGenerationStatus;
        updated_at: string;
      }
    | undefined;

  if (!current) {
    return false;
  }

  getDb()
    .prepare(
      `UPDATE conversations
       SET title = ?,
           title_generation_status = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      input.title ?? current.title,
      input.titleGenerationStatus ?? current.title_generation_status,
      input.updateTimestamp === false ? current.updated_at : nowIso(),
      input.conversationId
    );

  return true;
}

export function bumpConversation(conversationId: string) {
  getDb()
    .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
    .run(nowIso(), conversationId);
}

export function setConversationActive(conversationId: string, active: boolean) {
  const timestamp = nowIso();
  getDb()
    .prepare("UPDATE conversations SET is_active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, timestamp, conversationId);
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

export function updateMessage(
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
    return null;
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

  const updated = getMessage(messageId);

  if (!updated) {
    return null;
  }

  bumpConversation(updated.conversationId);
  return updated;
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

function listMessageTextSegmentsForMessageIds(messageIds: string[]) {
  if (!messageIds.length) {
    return [];
  }

  const placeholders = messageIds.map(() => "?").join(", ");

  const rows = getDb()
    .prepare(
      `SELECT
        id,
        message_id,
        content,
        sort_order,
        created_at
       FROM message_text_segments
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, sort_order ASC, created_at ASC`
    )
    .all(...messageIds) as Array<{
      id: string;
      message_id: string;
      content: string;
      sort_order: number;
      created_at: string;
    }>;

  return rows.map(rowToMessageTextSegment);
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

function attachTextSegmentsToMessages(messages: Message[]) {
  const textSegmentsByMessageId = new Map<string, MessageTextSegment[]>();

  listMessageTextSegmentsForMessageIds(messages.map((message) => message.id)).forEach((segment) => {
    const current = textSegmentsByMessageId.get(segment.messageId) ?? [];
    current.push(segment);
    textSegmentsByMessageId.set(segment.messageId, current);
  });

  return messages.map((message) => ({
    ...message,
    textSegments: textSegmentsByMessageId.get(message.id) ?? []
  }));
}

function attachAttachmentsToMessages(messages: Message[]) {
  const attachmentsByMessageId = new Map<string, MessageAttachment[]>();

  listAttachmentsForMessageIds(messages.map((message) => message.id)).forEach((attachment) => {
    if (!attachment.messageId) {
      return;
    }

    const current = attachmentsByMessageId.get(attachment.messageId) ?? [];
    current.push(attachment);
    attachmentsByMessageId.set(attachment.messageId, current);
  });

  return messages.map((message) => ({
    ...message,
    attachments: attachmentsByMessageId.get(message.id) ?? []
  }));
}

function hydrateMessages(messages: Message[]) {
  return attachAttachmentsToMessages(
    attachTextSegmentsToMessages(attachActionsToMessages(messages))
  ).map((message) => ({
    ...message,
    timeline: buildMessageTimeline(message)
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

  return hydrateMessages(rows.map(rowToMessage));
}

export function listVisibleMessages(conversationId: string) {
  return listMessages(conversationId).filter(isVisibleMessage);
}

export type ConversationSnapshot = {
  conversation: Conversation;
  messages: Message[];
};

export function getConversationSnapshot(conversationId: string): ConversationSnapshot | null {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;
  const messages = listVisibleMessages(conversationId);
  return { conversation, messages };
}

export function listActiveConversations(): Array<{ id: string; title: string; isActive: boolean }> {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, title, is_active FROM conversations WHERE is_active = 1 ORDER BY updated_at DESC")
    .all() as Array<{ id: string; title: string; is_active: number }>;
  return rows.map(r => ({ id: r.id, title: r.title, isActive: Boolean(r.is_active) }));
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

  return hydrateMessages([rowToMessage(row)])[0] ?? null;
}

function updateMessageEstimatedTokens(messageId: string) {
  const message = getMessage(messageId);

  if (!message) {
    return;
  }

  getDb()
    .prepare(
      `UPDATE messages
       SET estimated_tokens = ?
       WHERE id = ?`
    )
    .run(estimateMessageTokens(message), messageId);
}

export function bindAttachmentsToMessage(conversationId: string, messageId: string, attachmentIds: string[]) {
  const attachments = assignAttachmentsToMessage(conversationId, messageId, attachmentIds);
  updateMessageEstimatedTokens(messageId);
  return attachments;
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

export function createMessageTextSegment(input: {
  messageId: string;
  content: string;
  sortOrder?: number;
}) {
  const segment: MessageTextSegment = {
    id: createId("seg"),
    messageId: input.messageId,
    content: input.content,
    sortOrder: input.sortOrder ?? 0,
    createdAt: nowIso()
  };

  getDb()
    .prepare(
      `INSERT INTO message_text_segments (
        id,
        message_id,
        content,
        sort_order,
        created_at
      ) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      segment.id,
      segment.messageId,
      segment.content,
      segment.sortOrder,
      segment.createdAt
    );

  return segment;
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

export function claimConversationTitleGeneration(conversationId: string, userMessageId: string) {
  const result = getDb()
    .prepare(
      `UPDATE conversations
       SET title_generation_status = 'running',
           is_active = 1
       WHERE id = ?
         AND title_generation_status = 'pending'
         AND ? = (
           SELECT id
           FROM messages
           WHERE conversation_id = ?
             AND role = 'user'
           ORDER BY rowid ASC
           LIMIT 1
         )`
    )
    .run(conversationId, userMessageId, conversationId);

  return result.changes > 0;
}

export function completeConversationTitleGeneration(conversationId: string, title: string) {
  getDb()
    .prepare(
      `UPDATE conversations
       SET title = ?,
           title_generation_status = 'completed',
           is_active = 0
       WHERE id = ?`
    )
    .run(title, conversationId);
  return true;
}

export function failConversationTitleGeneration(conversationId: string) {
  getDb()
    .prepare(
      `UPDATE conversations
       SET title = ?,
           title_generation_status = 'failed',
           is_active = 0
       WHERE id = ?`
    )
    .run(DEFAULT_CONVERSATION_TITLE, conversationId);
  return true;
}

export async function generateConversationTitleFromFirstUserMessage(
  conversationId: string,
  userMessageId: string
) {
  if (!claimConversationTitleGeneration(conversationId, userMessageId)) {
    return false;
  }

  try {
    const firstUserMessage = getDb()
      .prepare(
        `SELECT content
         FROM messages
         WHERE id = ? AND conversation_id = ? AND role = 'user'`
      )
      .get(userMessageId, conversationId) as { content: string } | undefined;

    if (!firstUserMessage) {
      failConversationTitleGeneration(conversationId);
      return false;
    }

    const trimmedContent = firstUserMessage.content.trim();

    if (!trimmedContent) {
      completeConversationTitleGeneration(
        conversationId,
        DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE
      );

      const currentConversation = getConversation(conversationId);
      if (currentConversation) {
        try {
          getConversationManager().broadcastAll({
            type: "conversation_title_updated",
            conversationId,
            title: DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE
          });
        } catch { /* WS server may not be running */ }
      }

      return true;
    }

    const conversation = getConversation(conversationId);

    if (!conversation) {
      failConversationTitleGeneration(conversationId);
      return false;
    }

    const settings =
      (conversation.providerProfileId
        ? getProviderProfileWithApiKey(conversation.providerProfileId)
        : null) ?? getDefaultProviderProfileWithApiKey();

    if (!settings?.apiKey) {
      failConversationTitleGeneration(conversationId);
      return false;
    }

    const title = await generateConversationTitle({
      settings,
      firstMessage: trimmedContent
    });

    completeConversationTitleGeneration(conversationId, title);

    try {
      getConversationManager().broadcastAll({
        type: "conversation_title_updated",
        conversationId,
        title
      });
    } catch { /* WS server may not be running */ }

    return true;
  } catch {
    failConversationTitleGeneration(conversationId);
    return false;
  }
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
  const activityTimestamp = conversationActivityTimestampSql("c");

  const rows = getDb()
    .prepare(
      `SELECT DISTINCT
        c.id,
        c.title,
        c.title_generation_status,
        c.folder_id,
        c.provider_profile_id,
        c.automation_id,
        c.automation_run_id,
        c.conversation_origin,
        c.sort_order,
        c.created_at,
        ${activityTimestamp} AS updated_at,
        c.is_active
       FROM conversations c
       LEFT JOIN messages m ON c.id = m.conversation_id
       WHERE c.title LIKE ?
          OR (
            m.content LIKE ?
            AND (m.role != 'system' OR m.system_kind IS NOT NULL)
          )
       ORDER BY ${activityTimestamp} DESC, c.id DESC`
    )
    .all(likeQuery, likeQuery) as ConversationRow[];

  return rows.map(rowToConversation);
}
