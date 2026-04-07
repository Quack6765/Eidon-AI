import type WebSocket from "ws";
import type { WebSocketServer } from "ws";
import { verifySessionToken } from "@/lib/auth";
import { startChatTurn } from "@/lib/chat-turn";
import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { getConversationSnapshot, listActiveConversations } from "@/lib/conversations";
import { createConversationManager, type ConversationManager } from "@/lib/conversation-manager";
import { isPasswordLoginEnabled } from "@/lib/env";
import { parseClientMessage, serializeServerMessage } from "@/lib/ws-protocol";
import type { ClientMessage } from "@/lib/ws-protocol";
import { initializeMcpServers, shutdownAllProcesses } from "@/lib/mcp-client";

let manager: ConversationManager | null = null;

function getManager(): ConversationManager {
  if (!manager) {
    manager = createConversationManager();
  }
  return manager;
}

function extractToken(req: import("http").IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

export function setupWebSocketHandler(wss: WebSocketServer) {
  wss.on("connection", async (ws, req) => {
    const token = extractToken(req);
    await handleConnection(ws, token);
  });
}

export async function handleConnection(ws: WebSocket, token: string | null) {
  if (isPasswordLoginEnabled()) {
    if (!token) {
      ws.send(serializeServerMessage({ type: "error", message: "Authentication required" }));
      ws.close();
      return;
    }

    const session = await verifySessionToken(token);
    if (!session) {
      ws.send(serializeServerMessage({ type: "error", message: "Invalid session" }));
      ws.close();
      return;
    }
  }

  const mgr = getManager();
  const currentSubscription = new Set<string>();

  const active = listActiveConversations();
  ws.send(serializeServerMessage({
    type: "ready",
    activeConversations: active.map(c => ({
      id: c.id,
      title: c.title,
      status: c.isActive ? "streaming" : "idle"
    }))
  }));

  ws.on("message", (raw: WebSocket.RawData) => {
    const msg = parseClientMessage(raw.toString());
    if (!msg) return;
    handleMessage(mgr, ws, msg, currentSubscription);
  });

  ws.on("close", () => {
    for (const conversationId of currentSubscription) {
      mgr.unsubscribe(conversationId, ws);
    }
    mgr.disconnect(ws);
  });
}

function handleMessage(
  mgr: ConversationManager,
  ws: WebSocket,
  msg: ClientMessage,
  currentSubscription: Set<string>
) {
  switch (msg.type) {
    case "subscribe": {
      currentSubscription.add(msg.conversationId);
      mgr.subscribe(msg.conversationId, ws);
      const snapshot = getConversationSnapshot(msg.conversationId);
      if (snapshot) {
        ws.send(serializeServerMessage({
          type: "snapshot",
          conversationId: msg.conversationId,
          messages: snapshot.messages,
          actions: snapshot.messages.flatMap(m => m.actions ?? []),
          segments: snapshot.messages.flatMap(m => m.textSegments ?? [])
        }));
      }
      break;
    }
    case "unsubscribe": {
      currentSubscription.delete(msg.conversationId);
      mgr.unsubscribe(msg.conversationId, ws);
      break;
    }
    case "message": {
      handleUserMessage(mgr, ws, msg).catch((error) => {
        console.error("[ws-handler] handleUserMessage failed:", error);
        ws.send(serializeServerMessage({
          type: "error",
          message: error instanceof Error ? error.message : "Chat stream failed"
        }));
      });
      break;
    }
    case "edit": {
      break;
    }
  }
}

async function handleUserMessage(
  mgr: ConversationManager,
  ws: WebSocket,
  msg: { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string }
) {
  if (!mgr.hasSubscribers(msg.conversationId)) {
    mgr.subscribe(msg.conversationId, ws);
  }
  await startChatTurn(mgr, msg.conversationId, msg.content, msg.attachmentIds ?? [], msg.personaId);
}
