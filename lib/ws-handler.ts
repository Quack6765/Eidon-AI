import type WebSocket from "ws";
import type { WebSocketServer } from "ws";
import { verifySessionToken } from "@/lib/auth";
import { createAutomationScheduler as createAutomationSchedulerBase } from "@/lib/automation-scheduler";
import { startChatTurn } from "@/lib/chat-turn";
import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { getConversationSnapshot, listActiveConversations } from "@/lib/conversations";
import { type ConversationManager } from "@/lib/conversation-manager";
import { isPasswordLoginEnabled } from "@/lib/env";
import { requestStop } from "@/lib/chat-turn-control";
import { parseClientMessage, serializeServerMessage } from "@/lib/ws-protocol";
import type { ClientMessage } from "@/lib/ws-protocol";
import { initializeMcpServers, shutdownAllProcesses } from "@/lib/mcp-client";
import { getConversationManager } from "@/lib/ws-singleton";

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

export function createAutomationScheduler() {
  return createAutomationSchedulerBase({
    manager: getConversationManager(),
    startChatTurn
  });
}

export async function handleConnection(ws: WebSocket, token: string | null) {
  let sessionUserId: string | null = null;

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

    sessionUserId = session.userId;
  }

  const mgr = getConversationManager();
  mgr.addConnection(ws, sessionUserId);
  const currentSubscription = new Set<string>();

  const active = listActiveConversations(sessionUserId ?? undefined);
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
    handleMessage(mgr, ws, msg, currentSubscription, sessionUserId);
  });

  ws.on("close", () => {
    mgr.removeConnection(ws);
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
  currentSubscription: Set<string>,
  currentUserId: string | null
) {
  switch (msg.type) {
    case "subscribe": {
      const snapshot = getConversationSnapshot(msg.conversationId, currentUserId ?? undefined);
      if (!snapshot) {
        ws.send(serializeServerMessage({ type: "error", message: "Conversation not found" }));
        break;
      }

      currentSubscription.add(msg.conversationId);
      mgr.subscribe(msg.conversationId, ws);
      ws.send(serializeServerMessage({
        type: "snapshot",
        conversationId: msg.conversationId,
        messages: snapshot.messages,
        actions: snapshot.messages.flatMap(m => m.actions ?? []),
        segments: snapshot.messages.flatMap(m => m.textSegments ?? [])
      }));
      break;
    }
    case "unsubscribe": {
      currentSubscription.delete(msg.conversationId);
      mgr.unsubscribe(msg.conversationId, ws);
      break;
    }
    case "message": {
      handleUserMessage(mgr, ws, msg, currentUserId).catch((error) => {
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
    case "stop": {
      if (currentUserId && !getConversationSnapshot(msg.conversationId, currentUserId)) {
        ws.send(serializeServerMessage({ type: "error", message: "Conversation not found" }));
        break;
      }
      requestStop(msg.conversationId);
      break;
    }
  }
}

async function handleUserMessage(
  mgr: ConversationManager,
  ws: WebSocket,
  msg: { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string },
  currentUserId: string | null
) {
  if (currentUserId && !getConversationSnapshot(msg.conversationId, currentUserId)) {
    ws.send(serializeServerMessage({ type: "error", message: "Conversation not found" }));
    return;
  }

  if (!mgr.hasSubscribers(msg.conversationId)) {
    mgr.subscribe(msg.conversationId, ws);
  }
  await startChatTurn(mgr, msg.conversationId, msg.content, msg.attachmentIds ?? [], msg.personaId);
}
