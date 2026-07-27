import WebSocket from "ws";
import type { ServerMessage } from "@/lib/ws-protocol";
import { serializeServerMessage } from "@/lib/ws-protocol";
import { sendWebSocketData } from "@/lib/ws-send";

export const MAX_WS_CONNECTIONS = 500;

export function createConversationManager() {
  const rooms = new Map<string, Set<WebSocket>>();
  const clientRooms = new Map<WebSocket, Set<string>>();
  const connectionUsers = new Map<WebSocket, string>();
  const activeTurns = new Map<string, boolean>();
  const connectedSockets = new Set<WebSocket>();

  function subscribe(conversationId: string, ws: WebSocket) {
    if (!rooms.has(conversationId)) {
      rooms.set(conversationId, new Set());
    }
    rooms.get(conversationId)!.add(ws);

    if (!clientRooms.has(ws)) {
      clientRooms.set(ws, new Set());
    }
    clientRooms.get(ws)!.add(conversationId);
  }

  function unsubscribe(conversationId: string, ws: WebSocket) {
    const room = rooms.get(conversationId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) rooms.delete(conversationId);
    }
    const subs = clientRooms.get(ws);
    if (subs) subs.delete(conversationId);
  }

  function broadcast(conversationId: string, event: ServerMessage) {
    const room = rooms.get(conversationId);
    if (!room) return;
    const raw = serializeServerMessage(event);
    for (const ws of room) {
      sendWebSocketData(ws, raw);
    }
  }

  function disconnect(ws: WebSocket) {
    const subs = clientRooms.get(ws);
    if (!subs) return;
    for (const conversationId of subs) {
      const room = rooms.get(conversationId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) rooms.delete(conversationId);
      }
    }
    clientRooms.delete(ws);
    connectionUsers.delete(ws);
  }

  function isActive(conversationId: string): boolean {
    return activeTurns.get(conversationId) === true;
  }

  function setActive(conversationId: string, active: boolean) {
    if (active) {
      activeTurns.set(conversationId, true);
    } else {
      activeTurns.delete(conversationId);
    }
  }

  function hasSubscribers(conversationId: string): boolean {
    const room = rooms.get(conversationId);
    return Boolean(room && room.size > 0);
  }

  function getActiveConversationIds(): string[] {
    return [...activeTurns.keys()];
  }

  function addConnection(ws: WebSocket, userId: string) {
    if (connectedSockets.size >= MAX_WS_CONNECTIONS) {
      return false;
    }

    connectedSockets.add(ws);
    connectionUsers.set(ws, userId);
    return true;
  }

  function removeConnection(ws: WebSocket) {
    connectedSockets.delete(ws);
    connectionUsers.delete(ws);
  }

  function broadcastAll(event: ServerMessage, userId?: string | null) {
    const raw = serializeServerMessage(event);
    for (const ws of connectedSockets) {
      const socketUserId = connectionUsers.get(ws);
      if (!socketUserId || (userId !== undefined && socketUserId !== userId)) {
        continue;
      }

      sendWebSocketData(ws, raw);
    }
  }

  return { subscribe, unsubscribe, broadcast, disconnect, isActive, setActive, getActiveConversationIds, hasSubscribers, addConnection, removeConnection, broadcastAll };
}

export type ConversationManager = ReturnType<typeof createConversationManager>;
