import type { ChatStreamEvent } from "@/lib/types";

export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string }
  | { type: "edit"; messageId: string; content: string };

export type ServerMessage =
  | { type: "ready"; activeConversations: { id: string; title: string; status: string }[] }
  | { type: "snapshot"; conversationId: string; messages: unknown[]; actions: unknown[]; segments: unknown[] }
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

const CLIENT_MESSAGE_TYPES = new Set(["subscribe", "unsubscribe", "message", "edit"]);

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
