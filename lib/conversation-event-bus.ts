import { createEmitter } from "@/lib/emitter";
import { getConversationManager } from "@/lib/ws-singleton";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { ChatStreamEvent } from "@/lib/types";
import type { ServerMessage } from "@/lib/ws-protocol";

export type ChatEmitter = ReturnType<typeof createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>>;

export type ConversationBusEvent =
  | { kind: "delta"; conversationId: string; event: ChatStreamEvent }
  | { kind: "status"; conversationId: string; status: string }
  | { kind: "room"; conversationId: string; message: ServerMessage }
  | { kind: "user"; userId: string | null; message: ServerMessage };

type ConversationEventListener = (event: ConversationBusEvent) => void;

const chatEmitter = createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>();

const conversationListeners = new Map<string, Set<ConversationEventListener>>();

export function getChatEmitter(): ChatEmitter {
  return chatEmitter;
}

export function subscribeConversationEvents(
  conversationId: string,
  listener: ConversationEventListener
): () => void {
  let listeners = conversationListeners.get(conversationId);
  if (!listeners) {
    listeners = new Set();
    conversationListeners.set(conversationId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = conversationListeners.get(conversationId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) conversationListeners.delete(conversationId);
  };
}

function notifyConversationListeners(event: ConversationBusEvent) {
  if (event.kind === "user") return;
  const listeners = conversationListeners.get(event.conversationId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error(`[conversation-event-bus] listener failed for ${event.conversationId}:`, error);
    }
  }
}

function deliverToManager(manager: ConversationManager | null, event: ConversationBusEvent) {
  if (!manager) return;
  try {
    if (event.kind === "delta") {
      manager.broadcast(event.conversationId, {
        type: "delta",
        conversationId: event.conversationId,
        event: event.event
      });
    } else if (event.kind === "room") {
      manager.broadcast(event.conversationId, event.message);
    } else if (event.kind === "user") {
      manager.broadcastAll(event.message, event.userId);
    }
  } catch (error) {
    console.error("[conversation-event-bus] websocket sink failed:", error);
  }
}

export function publishConversationEvent(
  event: ConversationBusEvent,
  manager: ConversationManager | null = getConversationManager()
): void {
  deliverToManager(manager, event);
  if (event.kind === "delta") {
    chatEmitter.emit("delta", event.conversationId, event.event);
  } else if (event.kind === "status") {
    chatEmitter.emit("status", event.conversationId, event.status);
  }
  notifyConversationListeners(event);
}
