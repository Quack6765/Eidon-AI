import type { ChatInputMode, ChatStreamEvent, QueuedMessage } from "@/lib/types";

export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string; mode?: ChatInputMode }
  | { type: "stop"; conversationId: string }
  | { type: "edit"; messageId: string; content: string }
  | { type: "queue_message"; conversationId: string; content: string; mode?: ChatInputMode }
  | { type: "update_queued_message"; conversationId: string; queuedMessageId: string; content: string }
  | { type: "delete_queued_message"; conversationId: string; queuedMessageId: string }
  | { type: "send_queued_message_now"; conversationId: string; queuedMessageId: string };

export type ServerMessage =
  | { type: "ready"; activeConversations: { id: string; title: string; status: string }[] }
  | { type: "snapshot"; conversationId: string; messages: unknown[]; actions: unknown[]; segments: unknown[]; queuedMessages: QueuedMessage[] }
  | { type: "queue_updated"; conversationId: string; queuedMessages: QueuedMessage[] }
  | { type: "delta"; conversationId: string; event: ChatStreamEvent }
  | { type: "error"; message: string }
  | { type: "conversation_created"; conversation: { id: string; title: string; folderId: string | null; createdAt: string; updatedAt: string; isActive: boolean } }
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

const CLIENT_MESSAGE_TYPES = new Set([
  "subscribe",
  "unsubscribe",
  "message",
  "stop",
  "edit",
  "queue_message",
  "update_queued_message",
  "delete_queued_message",
  "send_queued_message_now"
]);

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !CLIENT_MESSAGE_TYPES.has(parsed.type)) {
      return null;
    }
    return parsed as ClientMessage;
  } catch {
    return null;
  }
}
