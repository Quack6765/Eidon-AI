import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
import { env } from "@/lib/env";
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
  ConversationOrigin,
  ConversationSearchResult,
  ConversationSnapshot,
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
  MemoryProposalPayload,
  MemoryProposalState,
  QueuedMessage,
  QueuedMessageStatus,
  SystemMessageKind
} from "@/lib/types";

export const DEFAULT_CONVERSATION_PAGE_SIZE = 10;

const MANUAL_CONVERSATION_ORIGIN: ConversationOrigin = "manual";

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
  return `MAX(COALESCE((
    SELECT MAX(m.created_at)
    FROM messages m
    WHERE m.conversation_id = ${alias}.id
      AND m.role != 'system'
  ), ''), ${alias}.updated_at)`;
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

function buildConversationMatchSnippet(content: string, query: string) {
  const normalizedContent = content.replace(/\s+/g, " ").trim();
  const normalizedQuery = query.replace(/\s+/g, " ").trim();

  if (!normalizedContent || !normalizedQuery) {
    return normalizedContent;
  }

  const matchIndex = normalizedContent.toLowerCase().indexOf(normalizedQuery.toLowerCase());

  if (matchIndex === -1) {
    return normalizedContent.slice(0, 120);
  }

  const start = Math.max(0, matchIndex - 36);
  const end = Math.min(normalizedContent.length, matchIndex + normalizedQuery.length + 48);

  return `${start > 0 ? "…" : ""}${normalizedContent.slice(start, end).trim()}${end < normalizedContent.length ? "…" : ""}`;
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
  proposal_state: MemoryProposalState | null;
  proposal_payload_json: string | null;
  proposal_updated_at: string | null;
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
    completedAt: row.completed_at,
    proposalState: row.proposal_state,
    proposalPayload: row.proposal_payload_json
      ? (JSON.parse(row.proposal_payload_json) as MemoryProposalPayload)
      : null,
    proposalUpdatedAt: row.proposal_updated_at
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

function rowToQueuedMessage(row: {
  id: string;
  conversation_id: string;
  content: string;
  status: QueuedMessageStatus;
  sort_order: number;
  failure_message: string | null;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processingStartedAt: row.processing_started_at
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

export function listConversations(userId?: string) {
  const activityTimestamp = conversationActivityTimestampSql("c");
  const rows = (userId
    ? getDb()
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
           WHERE c.user_id = ?
             AND c.conversation_origin = ?
           ORDER BY ${activityTimestamp} DESC, c.id DESC`
        )
        .all(userId, MANUAL_CONVERSATION_ORIGIN)
    : getDb()
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
           WHERE c.conversation_origin = ?
           ORDER BY ${activityTimestamp} DESC, c.id DESC`
        )
        .all(MANUAL_CONVERSATION_ORIGIN)) as ConversationRow[];

  return rows.map(rowToConversation);
}

export function listConversationsPage(input: {
  userId?: string;
  limit?: number;
  cursor?: string | null;
} = {}): ConversationListPage {
  const limit = input.limit ?? DEFAULT_CONVERSATION_PAGE_SIZE;
  const cursor = input.cursor ? decodeConversationCursor(input.cursor) : null;
  const activityTimestamp = conversationActivityTimestampSql("c");
  const userCondition = input.userId ? "c.user_id = ? AND " : "";

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
           WHERE ${userCondition}c.conversation_origin = ?
             AND (
               ${activityTimestamp} < ?
               OR (${activityTimestamp} = ? AND c.id < ?)
             )
           ORDER BY ${activityTimestamp} DESC, c.id DESC
           LIMIT ?`
        )
        .all(
          ...(input.userId ? [input.userId] : []),
          MANUAL_CONVERSATION_ORIGIN,
          cursor.updatedAt,
          cursor.updatedAt,
          cursor.id,
          limit + 1
        ) as ConversationRow[])
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
           WHERE ${userCondition}c.conversation_origin = ?
           ORDER BY ${activityTimestamp} DESC, c.id DESC
           LIMIT ?`
        )
        .all(...(input.userId ? [input.userId] : []), MANUAL_CONVERSATION_ORIGIN, limit + 1) as ConversationRow[]);

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

export function getConversation(conversationId: string, userId?: string) {
  const activityTimestamp = conversationActivityTimestampSql("c");
  const row = (userId
    ? getDb()
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
           WHERE c.id = ? AND c.user_id = ?`
        )
        .get(conversationId, userId)
    : getDb()
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
        .get(conversationId)) as ConversationRow | undefined;

  return row ? rowToConversation(row) : null;
}

export function getConversationOwnerId(conversationId: string) {
  const row = getDb()
    .prepare("SELECT user_id FROM conversations WHERE id = ?")
    .get(conversationId) as { user_id: string | null } | undefined;

  return row?.user_id ?? null;
}

export function createConversation(
  title?: string | null,
  folderId?: string | null,
  options?: {
    providerProfileId?: string | null;
    origin?: ConversationOrigin;
    automationId?: string | null;
    automationRunId?: string | null;
  },
  userId?: string
) {
  const timestamp = nowIso();
  const settings = getSettings();
  const trimmedTitle = title?.trim() ?? "";

  const maxOrder = (userId
    ? getDb()
        .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM conversations WHERE user_id = ?")
        .get(userId)
    : getDb()
        .prepare("SELECT COALESCE(MAX(sort_order), -1) as max_order FROM conversations")
        .get()) as { max_order: number };

  const conversation = {
    id: createId("conv"),
    title: trimmedTitle || DEFAULT_CONVERSATION_TITLE,
    titleGenerationStatus: (trimmedTitle ? "completed" : "pending") as ConversationTitleGenerationStatus,
    folderId: folderId ?? null,
    providerProfileId: options?.providerProfileId ?? settings.defaultProviderProfileId,
    automationId: options?.automationId ?? null,
    automationRunId: options?.automationRunId ?? null,
    conversationOrigin: options?.origin ?? MANUAL_CONVERSATION_ORIGIN,
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
        user_id,
        folder_id,
        provider_profile_id,
        automation_id,
        automation_run_id,
        conversation_origin,
        sort_order,
        created_at,
        updated_at,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      conversation.id,
      conversation.title,
      conversation.titleGenerationStatus,
      userId ?? null,
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

export function deleteConversation(conversationId: string, userId?: string) {
  if (userId && !getConversation(conversationId, userId)) {
    return;
  }

  const transaction = getDb().transaction((id: string) => {
    deleteConversationRecord(id);
  });

  transaction(conversationId);
}

export function deleteConversationIfEmpty(conversationId: string, userId?: string) {
  const transaction = getDb().transaction((id: string) => {
    const conversation = (userId
      ? getDb()
          .prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
          .get(id, userId)
      : getDb()
          .prepare("SELECT id FROM conversations WHERE id = ?")
          .get(id)) as { id: string } | undefined;

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
        completed_at,
        proposal_state,
        proposal_payload_json,
        proposal_updated_at
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
      proposal_state: MemoryProposalState | null;
      proposal_payload_json: string | null;
      proposal_updated_at: string | null;
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
       ORDER BY created_at ASC, rowid ASC`
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
    created_at: string;
    updated_at: string;
    processing_started_at: string | null;
  }>;

  return rows.map(rowToQueuedMessage);
}

export function createQueuedMessage({
  conversationId,
  content
}: {
  conversationId: string;
  content: string;
}) {
  const timestamp = nowIso();
  const db = getDb();
  const nextSortOrder =
    ((db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM queued_messages WHERE conversation_id = ?"
      )
      .get(conversationId) as { max_sort_order: number | null }).max_sort_order ?? -1) + 1;

  const queuedMessage: QueuedMessage = {
    id: createId("queue"),
    conversationId,
    content,
    status: "pending",
    sortOrder: nextSortOrder,
    failureMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    processingStartedAt: null
  };

  db.prepare(
    `INSERT INTO queued_messages (
      id,
      conversation_id,
      content,
      status,
      sort_order,
      failure_message,
      processing_started_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    queuedMessage.id,
    queuedMessage.conversationId,
    queuedMessage.content,
    queuedMessage.status,
    queuedMessage.sortOrder,
    queuedMessage.failureMessage,
    queuedMessage.processingStartedAt,
    queuedMessage.createdAt,
    queuedMessage.updatedAt
  );

  return queuedMessage;
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
  const selectNextPending = db.prepare(
    `SELECT
      id,
      conversation_id,
      content,
      status,
      sort_order,
      failure_message,
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
         processing_started_at = ?,
         updated_at = ?
     WHERE id = ?
       AND status = 'pending'`
  );

  const transaction = db.transaction((targetConversationId: string) => {
    const row = selectNextPending.get(targetConversationId) as
      | {
          id: string;
          conversation_id: string;
          content: string;
          status: QueuedMessageStatus;
          sort_order: number;
          failure_message: string | null;
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
      updated_at: timestamp,
      processing_started_at: timestamp
    });
  });

  return transaction(conversationId);
}

export function getConversationSnapshot(conversationId: string, userId?: string): ConversationSnapshot | null {
  const conversation = getConversation(conversationId, userId);
  if (!conversation) return null;
  const messages = listVisibleMessages(conversationId);
  const queuedMessages = listQueuedMessages(conversationId);
  return { conversation, messages, queuedMessages };
}

export function listActiveConversations(userId?: string): Array<{ id: string; title: string; isActive: boolean }> {
  const db = getDb();
  const rows = (userId
    ? db
        .prepare(
          "SELECT id, title, is_active FROM conversations WHERE is_active = 1 AND user_id = ? ORDER BY updated_at DESC"
        )
        .all(userId)
    : db
        .prepare("SELECT id, title, is_active FROM conversations WHERE is_active = 1 ORDER BY updated_at DESC")
        .all()) as Array<{ id: string; title: string; is_active: number }>;
  return rows.map(r => ({ id: r.id, title: r.title, isActive: Boolean(r.is_active) }));
}

export function getMessage(messageId: string, userId?: string) {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT
            m.id,
            m.conversation_id,
            m.role,
            m.content,
            m.thinking_content,
            m.status,
            m.estimated_tokens,
            m.system_kind,
            m.compacted_at,
            m.created_at
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.id = ? AND c.user_id = ?`
        )
        .get(messageId, userId)
    : getDb()
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
        .get(messageId)) as
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

function getAttachmentsRoot() {
  const root = path.resolve(env.EIDON_DATA_DIR, "attachments");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function cloneAttachmentFile(input: {
  sourceRelativePath: string;
  targetRelativePath: string;
}) {
  const sourcePath = path.resolve(getAttachmentsRoot(), input.sourceRelativePath);
  const targetPath = path.resolve(getAttachmentsRoot(), input.targetRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function recoverTextAttachmentFile(input: {
  targetRelativePath: string;
  extractedText: string;
}) {
  const targetPath = path.resolve(getAttachmentsRoot(), input.targetRelativePath);
  const bytes = Buffer.from(input.extractedText, "utf8");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, bytes);
  return {
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

export function forkConversationFromMessage(messageId: string, userId?: string) {
  const db = getDb();
  const copiedAttachmentPaths: string[] = [];

  const cleanupCopiedAttachments = () => {
    copiedAttachmentPaths.forEach((relativePath) => {
      const absolutePath = path.resolve(getAttachmentsRoot(), relativePath);
      try {
        fs.unlinkSync(absolutePath);
      } catch {}
    });
  };

  const transaction = db.transaction(() => {
    const sourceMessage = getMessage(messageId, userId);

    if (!sourceMessage) {
      throw new Error("Message not found");
    }

    if (sourceMessage.role !== "assistant") {
      throw new Error("Only assistant messages can be forked");
    }

    const sourceConversation = getConversation(sourceMessage.conversationId, userId);

    if (!sourceConversation) {
      throw new Error("Conversation not found");
    }

    const sourceConversationOwnerRow = db
      .prepare("SELECT user_id FROM conversations WHERE id = ?")
      .get(sourceConversation.id) as { user_id: string | null } | undefined;
    const sourceConversationOwnerId = sourceConversationOwnerRow?.user_id ?? null;
    const sourceMessages = listMessages(sourceConversation.id);
    const selectedIndex = sourceMessages.findIndex((message) => message.id === messageId);

    if (selectedIndex < 0) {
      throw new Error("Message not found");
    }

    const retainedMessages = sourceMessages.slice(0, selectedIndex + 1);
    const retainedMessageIds = new Set(retainedMessages.map((message) => message.id));

    const forkConversation = createConversation(
      `Fork ${sourceConversation.title}`,
      sourceConversation.folderId,
      {
        providerProfileId: sourceConversation.providerProfileId ?? undefined
      },
      sourceConversationOwnerId ?? userId
    );

    if (sourceConversation.providerProfileId === null) {
      db.prepare("UPDATE conversations SET provider_profile_id = NULL WHERE id = ?").run(
        forkConversation.id
      );
    }

    const clonedMessageIdBySourceId = new Map<string, string>();

    retainedMessages.forEach((message) => {
      const clonedMessageId = createId("msg");
      clonedMessageIdBySourceId.set(message.id, clonedMessageId);

      db.prepare(
        `INSERT INTO messages (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        clonedMessageId,
        forkConversation.id,
        message.role,
        message.content,
        message.thinkingContent,
        message.status,
        message.estimatedTokens,
        message.systemKind,
        message.compactedAt,
        message.createdAt
      );
    });

    retainedMessages.forEach((message) => {
      const clonedMessageId = clonedMessageIdBySourceId.get(message.id);

      if (!clonedMessageId) {
        return;
      }

      (message.actions ?? []).forEach((action) => {
        db.prepare(
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
        ).run(
          createId("act"),
          clonedMessageId,
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
      });

      (message.textSegments ?? []).forEach((segment) => {
        db.prepare(
          `INSERT INTO message_text_segments (
            id,
            message_id,
            content,
            sort_order,
            created_at
          ) VALUES (?, ?, ?, ?, ?)`
        ).run(createId("seg"), clonedMessageId, segment.content, segment.sortOrder, segment.createdAt);
      });
    });

    retainedMessages.forEach((message) => {
      const clonedMessageId = clonedMessageIdBySourceId.get(message.id);

      if (!clonedMessageId) {
        return;
      }

      message.attachments.forEach((attachment) => {
        const clonedAttachmentId = createId("att");
        const clonedRelativePath = path.join(
          forkConversation.id,
          `${clonedAttachmentId}_${attachment.filename}`
        );
        let clonedByteSize = attachment.byteSize;
        let clonedSha256 = attachment.sha256;

        try {
          cloneAttachmentFile({
            sourceRelativePath: attachment.relativePath,
            targetRelativePath: clonedRelativePath
          });
        } catch (error) {
          if (
            attachment.kind === "text" &&
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            const recovered = recoverTextAttachmentFile({
              targetRelativePath: clonedRelativePath,
              extractedText: attachment.extractedText
            });
            clonedByteSize = recovered.byteSize;
            clonedSha256 = recovered.sha256;
          } else {
            throw error;
          }
        }
        copiedAttachmentPaths.push(clonedRelativePath);

        db.prepare(
          `INSERT INTO message_attachments (
            id,
            conversation_id,
            message_id,
            filename,
            mime_type,
            byte_size,
            sha256,
            relative_path,
            kind,
            extracted_text,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          clonedAttachmentId,
          forkConversation.id,
          clonedMessageId,
          attachment.filename,
          attachment.mimeType,
          clonedByteSize,
          clonedSha256,
          clonedRelativePath,
          attachment.kind,
          attachment.extractedText,
          attachment.createdAt
        );
      });
    });

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
      .all(sourceConversation.id) as Array<{
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
    }>;

    const retainedMemoryNodes = sourceMemoryNodes.filter((node) => {
      return (
        retainedMessageIds.has(node.source_start_message_id) &&
        retainedMessageIds.has(node.source_end_message_id)
      );
    });

    const cloneableMemoryNodeIds = new Set(retainedMemoryNodes.map((node) => node.id));
    let hasChanges = true;

    while (hasChanges) {
      hasChanges = false;

      for (const node of retainedMemoryNodes) {
        if (!cloneableMemoryNodeIds.has(node.id)) {
          continue;
        }

        const childNodeIds = JSON.parse(node.child_node_ids) as string[];
        const referencesMissingChild = childNodeIds.some((childNodeId) => {
          return !cloneableMemoryNodeIds.has(childNodeId);
        });
        if (referencesMissingChild) {
          cloneableMemoryNodeIds.delete(node.id);
          hasChanges = true;
        }
      }
    }

    const cloneableRetainedMemoryNodes = retainedMemoryNodes.filter((node) =>
      cloneableMemoryNodeIds.has(node.id)
    );
    const clonedNodeIdBySourceId = new Map<string, string>();

    cloneableRetainedMemoryNodes.forEach((node) => {
      clonedNodeIdBySourceId.set(node.id, createId("mem"));
    });

    cloneableRetainedMemoryNodes.forEach((node) => {
      const clonedStartMessageId = clonedMessageIdBySourceId.get(node.source_start_message_id);
      const clonedEndMessageId = clonedMessageIdBySourceId.get(node.source_end_message_id);

      if (!clonedStartMessageId || !clonedEndMessageId) {
        return;
      }

      const childNodeIds = JSON.parse(node.child_node_ids) as string[];
      const clonedChildNodeIds = childNodeIds
        .map((childNodeId) => clonedNodeIdBySourceId.get(childNodeId))
        .filter((childNodeId): childNodeId is string => Boolean(childNodeId));

      if (clonedChildNodeIds.length !== childNodeIds.length) {
        return;
      }

      const clonedSupersededByNodeId =
        node.superseded_by_node_id && cloneableMemoryNodeIds.has(node.superseded_by_node_id)
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
        clonedNodeIdBySourceId.get(node.id),
        forkConversation.id,
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

    const sourceCompactionEvents = db
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
      .all(sourceConversation.id) as Array<{
      id: string;
      node_id: string;
      source_start_message_id: string;
      source_end_message_id: string;
      notice_message_id: string | null;
      created_at: string;
    }>;

    sourceCompactionEvents.forEach((event) => {
      const clonedNodeId = clonedNodeIdBySourceId.get(event.node_id);
      const clonedStartMessageId = clonedMessageIdBySourceId.get(event.source_start_message_id);
      const clonedEndMessageId = clonedMessageIdBySourceId.get(event.source_end_message_id);

      if (!clonedNodeId || !clonedStartMessageId || !clonedEndMessageId) {
        return;
      }

      if (event.notice_message_id && !retainedMessageIds.has(event.notice_message_id)) {
        return;
      }

      const clonedNoticeMessageId = event.notice_message_id
        ? clonedMessageIdBySourceId.get(event.notice_message_id) ?? null
        : null;

      if (event.notice_message_id && !clonedNoticeMessageId) {
        return;
      }

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
        forkConversation.id,
        clonedNodeId,
        clonedStartMessageId,
        clonedEndMessageId,
        clonedNoticeMessageId,
        event.created_at
      );
    });

    return forkConversation.id;
  });

  try {
    const forkConversationId = transaction();
    const forkConversation = getConversation(forkConversationId);

    if (!forkConversation) {
      throw new Error("Conversation not created");
    }

    return forkConversation;
  } catch (error) {
    cleanupCopiedAttachments();
    throw error;
  }
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
  proposalState?: MemoryProposalState | null;
  proposalPayload?: MemoryProposalPayload | null;
  proposalUpdatedAt?: string | null;
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
    completedAt: null,
    proposalState: input.proposalState ?? null,
    proposalPayload: input.proposalPayload ?? null,
    proposalUpdatedAt: input.proposalUpdatedAt ?? null
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
        completed_at,
        proposal_state,
        proposal_payload_json,
        proposal_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      action.completedAt,
      action.proposalState,
      action.proposalPayload ? JSON.stringify(action.proposalPayload) : null,
      action.proposalUpdatedAt
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
    proposalState?: MemoryProposalState | null;
    proposalPayload?: MemoryProposalPayload | null;
    proposalUpdatedAt?: string | null;
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
        completed_at,
        proposal_state,
        proposal_payload_json,
        proposal_updated_at
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
        proposal_state: MemoryProposalState | null;
        proposal_payload_json: string | null;
        proposal_updated_at: string | null;
      }
    | undefined;

  if (!current) {
    return null;
  }

  getDb()
    .prepare(
      `UPDATE message_actions
       SET status = ?, detail = ?, result_summary = ?, completed_at = ?,
           proposal_state = ?, proposal_payload_json = ?, proposal_updated_at = ?
       WHERE id = ?`
    )
    .run(
      patch.status ?? current.status,
      patch.detail ?? current.detail,
      patch.resultSummary ?? current.result_summary,
      patch.completedAt !== undefined ? patch.completedAt : current.completed_at,
      patch.proposalState !== undefined ? patch.proposalState : current.proposal_state,
      patch.proposalPayload !== undefined
        ? patch.proposalPayload
          ? JSON.stringify(patch.proposalPayload)
          : null
        : current.proposal_payload_json,
      patch.proposalUpdatedAt !== undefined ? patch.proposalUpdatedAt : current.proposal_updated_at,
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
          const conversationOwnerId = getConversationOwnerId(conversationId);
          getConversationManager().broadcastAll({
            type: "conversation_title_updated",
            conversationId,
            title: DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE
          }, conversationOwnerId ?? undefined);
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
      const conversationOwnerId = getConversationOwnerId(conversationId);
      getConversationManager().broadcastAll({
        type: "conversation_title_updated",
        conversationId,
        title
      }, conversationOwnerId ?? undefined);
    } catch { /* WS server may not be running */ }

    return true;
  } catch {
    failConversationTitleGeneration(conversationId);
    return false;
  }
}

export function moveConversationToFolder(conversationId: string, folderId: string | null, userId?: string) {
  const timestamp = nowIso();
  if (userId) {
    getDb()
      .prepare(
        `UPDATE conversations SET folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`
      )
      .run(folderId, timestamp, conversationId, userId);
    return;
  }

  getDb()
    .prepare(
      `UPDATE conversations SET folder_id = ?, updated_at = ? WHERE id = ?`
    )
    .run(folderId, timestamp, conversationId);
}

export function updateConversationProviderProfile(
  conversationId: string,
  providerProfileId: string,
  userId?: string
) {
  const timestamp = nowIso();
  if (userId) {
    getDb()
      .prepare(
        `UPDATE conversations
         SET provider_profile_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(providerProfileId, timestamp, conversationId, userId);
    return;
  }

  getDb()
    .prepare(
      `UPDATE conversations
       SET provider_profile_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(providerProfileId, timestamp, conversationId);
}

export function reorderConversations(
  items: Array<{ id: string; folderId: string | null }>,
  userId?: string
) {
  const statement = userId
    ? getDb()
        .prepare(
          "UPDATE conversations SET sort_order = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?"
        )
    : getDb()
        .prepare("UPDATE conversations SET sort_order = ?, folder_id = ?, updated_at = ? WHERE id = ?");

  const timestamp = nowIso();
  const transaction = getDb().transaction(
    (entries: Array<{ id: string; folderId: string | null; sortOrder: number }>) => {
      entries.forEach((entry) => {
        if (userId) {
          statement.run(entry.sortOrder, entry.folderId, timestamp, entry.id, userId);
          return;
        }

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

export function searchConversations(query: string, userId?: string): ConversationSearchResult[] {
  const likeQuery = `%${query}%`;
  const activityTimestamp = conversationActivityTimestampSql("c");
  const userCondition = userId ? "c.user_id = ? AND " : "";

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
        c.is_active,
        m.content AS matched_message_content
       FROM conversations c
       LEFT JOIN messages m
         ON c.id = m.conversation_id
        AND m.content LIKE ?
        AND (m.role != 'system' OR m.system_kind IS NOT NULL)
       WHERE ${userCondition}c.conversation_origin = ?
         AND (
           c.title LIKE ?
           OR m.id IS NOT NULL
         )
       ORDER BY ${activityTimestamp} DESC, c.id DESC, m.created_at ASC`
    )
    .all(
      likeQuery,
      ...(userId ? [userId] : []),
      MANUAL_CONVERSATION_ORIGIN,
      likeQuery
    ) as Array<ConversationRow & { matched_message_content: string | null }>;

  const normalizedQuery = query.trim().toLowerCase();
  const results: ConversationSearchResult[] = [];
  const seenConversationIds = new Set<string>();

  rows.forEach((row) => {
    if (seenConversationIds.has(row.id)) {
      return;
    }

    seenConversationIds.add(row.id);

    const conversation = rowToConversation(row);
    const titleMatches = row.title.toLowerCase().includes(normalizedQuery);

    results.push(
      titleMatches || !row.matched_message_content
        ? conversation
        : {
            ...conversation,
            matchSnippet: buildConversationMatchSnippet(row.matched_message_content, query)
          }
    );
  });

  return results;
}
