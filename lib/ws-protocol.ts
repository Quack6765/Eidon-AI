import type { ChatStreamEvent, QueuedMessage } from "@/lib/types";

export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string }
  | { type: "stop"; conversationId: string }
  | { type: "edit"; messageId: string; content: string }
  | { type: "queue_message"; conversationId: string; content: string }
  | { type: "update_queued_message"; conversationId: string; queuedMessageId: string; content: string }
  | { type: "delete_queued_message"; conversationId: string; queuedMessageId: string }
  | { type: "send_queued_message_now"; conversationId: string; queuedMessageId: string };

export type ServerMessage =
  | { type: "ready"; activeConversations: { id: string; title: string; status: string }[] }
  | { type: "snapshot"; conversationId: string; messages: unknown[]; actions: unknown[]; segments: unknown[]; queuedMessages: QueuedMessage[] }
  | { type: "queue_updated"; conversationId: string; queuedMessages: QueuedMessage[] }
  | { type: "delta"; conversationId: string; event: ChatStreamEvent }
  | { type: "user_message_persisted"; conversationId: string; message: unknown }
  | { type: "error"; message: string }
  | { type: "conversation_created"; conversation: { id: string; title: string; folderId: string | null; createdAt: string; updatedAt: string; isActive: boolean; isTemporary: boolean } }
  | { type: "conversation_deleted"; conversationId: string }
  | { type: "conversation_updated"; conversation: { id: string; title: string; folderId: string | null; updatedAt: string; isActive: boolean } }
  | { type: "conversation_activity"; conversationId: string; isActive: boolean }
  | { type: "conversation_title_updated"; conversationId: string; title: string };

export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

const MAX_CLIENT_IDENTIFIER_CHARS = 512;
const MAX_CLIENT_CONTENT_CHARS = 64 * 1024;
const MAX_CLIENT_ATTACHMENT_IDS = 100;

function parseIdentifier(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_CLIENT_IDENTIFIER_CHARS
    ? value
    : null;
}

function parseContent(value: unknown) {
  return typeof value === "string" && value.length <= MAX_CLIENT_CONTENT_CHARS
    ? value
    : null;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
      return null;
    }

    if (parsed.type === "edit") {
      const messageId = parseIdentifier(parsed.messageId);
      const content = parseContent(parsed.content);
      return messageId && content !== null ? { type: "edit", messageId, content } : null;
    }

    const conversationId = parseIdentifier(parsed.conversationId);
    if (!conversationId) {
      return null;
    }

    if (parsed.type === "subscribe" || parsed.type === "unsubscribe" || parsed.type === "stop") {
      return { type: parsed.type, conversationId };
    }

    if (parsed.type === "message") {
      const content = parseContent(parsed.content);
      const attachmentIds = parsed.attachmentIds;
      const personaId = parsed.personaId;
      const hasValidAttachmentIds = attachmentIds === undefined || (
        Array.isArray(attachmentIds) &&
        attachmentIds.length <= MAX_CLIENT_ATTACHMENT_IDS &&
        attachmentIds.every((attachmentId) => Boolean(parseIdentifier(attachmentId)))
      );
      if (
        content === null ||
        !hasValidAttachmentIds ||
        (!content.trim() && (!Array.isArray(attachmentIds) || attachmentIds.length === 0)) ||
        (personaId !== undefined && !parseIdentifier(personaId))
      ) {
        return null;
      }

      return {
        type: "message",
        conversationId,
        content,
        ...(attachmentIds !== undefined ? { attachmentIds: attachmentIds as string[] } : {}),
        ...(personaId !== undefined ? { personaId: personaId as string } : {})
      };
    }

    if (parsed.type === "queue_message") {
      const content = parseContent(parsed.content);
      return content?.trim() ? { type: "queue_message", conversationId, content } : null;
    }

    const queuedMessageId = parseIdentifier(parsed.queuedMessageId);
    if (!queuedMessageId) {
      return null;
    }

    if (parsed.type === "update_queued_message") {
      const content = parseContent(parsed.content);
      return content?.trim()
        ? { type: "update_queued_message", conversationId, queuedMessageId, content }
        : null;
    }

    if (parsed.type === "delete_queued_message" || parsed.type === "send_queued_message_now") {
      return { type: parsed.type, conversationId, queuedMessageId };
    }

    return null;
  } catch {
    return null;
  }
}
