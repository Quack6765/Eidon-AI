import WebSocket from "ws";
import type { ServerMessage } from "@/lib/ws-protocol";
import { serializeServerMessage } from "@/lib/ws-protocol";
import { sendWebSocketData } from "@/lib/ws-send";
import { sanitizeMobilePayload } from "@/lib/mobile-api";

export const MAX_WS_CONNECTIONS = 500;

function mobileServerMessage(event: ServerMessage) {
  const sanitized = sanitizeMobilePayload(event) as ServerMessage;
  if (sanitized.type === "error" && !sanitized.code) {
    return { ...sanitized, code: "request_failed" };
  }
  return sanitized;
}

export function createConversationManager() {
  const rooms = new Map<string, Set<WebSocket>>();
  const clientRooms = new Map<WebSocket, Set<string>>();
  const connectionUsers = new Map<WebSocket, string>();
  const connectionKinds = new Map<WebSocket, "browser" | "mobile">();
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
    for (const ws of room) {
      const payload = connectionKinds.get(ws) === "mobile"
        ? mobileServerMessage(event)
        : event;
      sendWebSocketData(ws, serializeServerMessage(payload));
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
    connectionKinds.delete(ws);
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

  function addConnection(
    ws: WebSocket,
    userId: string,
    kind: "browser" | "mobile" = "browser"
  ) {
    if (connectedSockets.size >= MAX_WS_CONNECTIONS) {
      return false;
    }

    connectedSockets.add(ws);
    connectionUsers.set(ws, userId);
    connectionKinds.set(ws, kind);
    return true;
  }

  function removeConnection(ws: WebSocket) {
    connectedSockets.delete(ws);
    connectionUsers.delete(ws);
    connectionKinds.delete(ws);
  }

  function broadcastAll(event: ServerMessage, userId: string | null) {
    for (const ws of connectedSockets) {
      const socketUserId = connectionUsers.get(ws);
      if (!userId || !socketUserId || socketUserId !== userId) {
        continue;
      }

      const payload = connectionKinds.get(ws) === "mobile"
        ? mobileServerMessage(event)
        : event;
      sendWebSocketData(ws, serializeServerMessage(payload));
    }
  }

  return { subscribe, unsubscribe, broadcast, disconnect, isActive, setActive, getActiveConversationIds, hasSubscribers, addConnection, removeConnection, broadcastAll };
}

export type ConversationManager = ReturnType<typeof createConversationManager>;
