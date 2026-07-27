import WebSocket from "ws";
import type { WebSocketServer } from "ws";
import { getCurrentUser, verifySessionToken } from "@/lib/auth";
import { createAutomationScheduler as createAutomationSchedulerBase } from "@/lib/automation-scheduler";
import { startChatTurn } from "@/lib/chat-turn";
import { SESSION_COOKIE_NAME } from "@/lib/constants";
import {
  createQueuedMessage,
  deleteQueuedMessage,
  getConversationSnapshot,
  getMessage,
  listActiveConversations,
  listQueuedMessages,
  moveQueuedMessageToFront,
  updateQueuedMessage
} from "@/lib/conversations";
import { MAX_WS_CONNECTIONS, type ConversationManager } from "@/lib/conversation-manager";
import { isPasswordLoginEnabled } from "@/lib/env";
import { requestStop } from "@/lib/chat-turn-control";
import { parseClientMessage, serializeServerMessage } from "@/lib/ws-protocol";
import type { ClientMessage } from "@/lib/ws-protocol";
import { initializeMcpServers, shutdownAllProcesses } from "@/lib/mcp-client";
import { getConversationManager } from "@/lib/ws-singleton";
import { disposeTitleModel, initTitleModel } from "@/lib/local-title-model";
import { getDb } from "@/lib/db";
import { sendWebSocketData } from "@/lib/ws-send";
import { bootstrapRuntimeState } from "@/lib/runtime-bootstrap";
import { truncateText } from "@/lib/bounded-text";

const MAX_WS_ERROR_MESSAGE_CHARS = 1_000;

export {
  bootstrapRuntimeState,
  disposeTitleModel,
  getDb,
  initTitleModel,
  initializeMcpServers,
  shutdownAllProcesses
};

function extractToken(req: import("http").IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

export function setupWebSocketHandler(wss: WebSocketServer) {
  const aliveSockets = new WeakSet<WebSocket>();

  wss.on("connection", async (ws, req) => {
    ws.on("error", () => {
      if (ws.readyState === WebSocket.CLOSED) {
        return;
      }

      try {
        ws.terminate();
      } catch {
        return;
      }
    });

    if (wss.clients.size > MAX_WS_CONNECTIONS) {
      ws.close(1013, "Connection limit reached");
      return;
    }

    aliveSockets.add(ws);
    ws.on("pong", () => aliveSockets.add(ws));
    const token = extractToken(req);
    try {
      await handleConnection(ws, token);
    } catch (error) {
      console.error("[ws-handler] connection setup failed:", error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, "WebSocket setup failed");
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) {
        aliveSockets.delete(ws);
        continue;
      }

      if (!aliveSockets.has(ws)) {
        ws.terminate();
        continue;
      }

      aliveSockets.delete(ws);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, 30_000);
  heartbeat.unref();
  wss.on("close", () => clearInterval(heartbeat));
}

export function createAutomationScheduler() {
  return createAutomationSchedulerBase({
    manager: getConversationManager(),
    startChatTurn
  });
}

export async function handleConnection(ws: WebSocket, token: string | null) {
  let closed = ws.readyState !== WebSocket.OPEN;
  let mgr: ConversationManager | null = null;
  const currentSubscription = new Set<string>();

  ws.on("close", () => {
    closed = true;
    if (!mgr) {
      return;
    }

    mgr.removeConnection(ws);
    for (const conversationId of currentSubscription) {
      mgr.unsubscribe(conversationId, ws);
    }
    mgr.disconnect(ws);
    mgr = null;
  });

  let sessionUserId: string;

  if (isPasswordLoginEnabled()) {
    if (!token) {
      sendError(ws, "Authentication required");
      ws.close();
      return;
    }

    const session = await verifySessionToken(token);
    if (!session) {
      sendError(ws, "Invalid session");
      ws.close();
      return;
    }

    sessionUserId = session.userId;
  } else {
    const user = await getCurrentUser();
    if (!user) {
      sendError(ws, "Unable to resolve the local user");
      ws.close();
      return;
    }
    sessionUserId = user.id;
  }

  if (closed || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  mgr = getConversationManager();
  if (!mgr.addConnection(ws, sessionUserId)) {
    sendError(ws, "Too many WebSocket connections");
    ws.close(1013, "Connection limit reached");
    mgr = null;
    return;
  }

  const active = listActiveConversations(sessionUserId);
  sendWebSocketData(ws, serializeServerMessage({
    type: "ready",
    activeConversations: active.map(c => ({
      id: c.id,
      title: c.title,
      status: c.isActive ? "streaming" : "idle"
    }))
  }));

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msg = parseClientMessage(raw.toString());
      if (!msg) return;
      if (mgr) {
        handleMessage(mgr, ws, msg, currentSubscription, sessionUserId);
      }
    } catch (error) {
      handleMessageFailure(ws, error);
    }
  });
}

function handleMessageFailure(ws: WebSocket, error: unknown) {
  try {
    console.error("[ws-handler] message dispatch failed:", error);
  } catch {
    return closeAfterMessageFailure(ws);
  }

  try {
    sendError(ws, "Unable to process WebSocket message");
  } catch {
    return closeAfterMessageFailure(ws);
  }

  closeAfterMessageFailure(ws);
}

function closeAfterMessageFailure(ws: WebSocket) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    ws.close(1011, "WebSocket message failed");
  } catch {
    try {
      ws.terminate();
    } catch {
      return;
    }
  }
}

function handleMessage(
  mgr: ConversationManager,
  ws: WebSocket,
  msg: ClientMessage,
  currentSubscription: Set<string>,
  currentUserId: string
) {
  switch (msg.type) {
    case "subscribe": {
      const snapshot = getConversationSnapshot(msg.conversationId, currentUserId);
      if (!snapshot) {
        sendError(ws, "Conversation not found");
        break;
      }

      currentSubscription.add(msg.conversationId);
      mgr.subscribe(msg.conversationId, ws);
      sendWebSocketData(ws, serializeServerMessage({
        type: "snapshot",
        conversationId: msg.conversationId,
        messages: snapshot.messages,
        actions: snapshot.messages.flatMap(m => m.actions ?? []),
        segments: snapshot.messages.flatMap(m => m.textSegments ?? []),
        queuedMessages: snapshot.queuedMessages
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
        sendWebSocketData(ws, serializeServerMessage({
          type: "error",
          message: truncateText(
            error instanceof Error ? error.message : "Chat stream failed",
            MAX_WS_ERROR_MESSAGE_CHARS
          )
        }));
      });
      break;
    }
    case "edit": {
      break;
    }
    case "stop": {
      if (!getConversationSnapshot(msg.conversationId, currentUserId)) {
        sendError(ws, "Conversation not found");
        break;
      }
      requestStop(msg.conversationId);
      break;
    }
    case "queue_message": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId)) {
        break;
      }

      createQueuedMessage({
        conversationId: msg.conversationId,
        content: msg.content
      });
      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
    case "update_queued_message": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId)) {
        break;
      }

      const updated = updateQueuedMessage({
        conversationId: msg.conversationId,
        queuedMessageId: msg.queuedMessageId,
        content: msg.content
      });

      if (!updated) {
        sendError(ws, "Queued message not found");
        break;
      }

      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
    case "delete_queued_message": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId)) {
        break;
      }

      const deleted = deleteQueuedMessage({
        conversationId: msg.conversationId,
        queuedMessageId: msg.queuedMessageId
      });

      if (!deleted) {
        sendError(ws, "Queued message not found");
        break;
      }

      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
    case "send_queued_message_now": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId)) {
        break;
      }

      const moved = moveQueuedMessageToFront({
        conversationId: msg.conversationId,
        queuedMessageId: msg.queuedMessageId
      });

      if (!moved) {
        sendError(ws, "Queued message not found");
        break;
      }

      requestStop(msg.conversationId);
      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
  }
}

function ensureConversationAccess(
  ws: WebSocket,
  conversationId: string,
  currentUserId: string
) {
  if (!getConversationSnapshot(conversationId, currentUserId)) {
    sendError(ws, "Conversation not found");
    return false;
  }

  return true;
}

function sendError(ws: WebSocket, message: string) {
  sendWebSocketData(ws, serializeServerMessage({ type: "error", message }));
}

function broadcastQueueUpdated(mgr: ConversationManager, conversationId: string) {
  mgr.broadcast(conversationId, {
    type: "queue_updated",
    conversationId,
    queuedMessages: listQueuedMessages(conversationId)
  });
}

async function handleUserMessage(
  mgr: ConversationManager,
  ws: WebSocket,
  msg: { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string },
  currentUserId: string
) {
  if (!getConversationSnapshot(msg.conversationId, currentUserId)) {
    sendError(ws, "Conversation not found");
    return;
  }

  if (!mgr.hasSubscribers(msg.conversationId)) {
    mgr.subscribe(msg.conversationId, ws);
  }
  await startChatTurn(mgr, msg.conversationId, msg.content, msg.attachmentIds ?? [], msg.personaId, {
    onMessagesCreated({ userMessageId }) {
      const userMessage = getMessage(userMessageId, currentUserId);
      if (userMessage) {
        mgr.broadcast(msg.conversationId, {
          type: "user_message_persisted",
          conversationId: msg.conversationId,
          message: userMessage
        });
      }
    }
  });
}
