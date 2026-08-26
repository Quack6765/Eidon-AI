import WebSocket from "ws";
import type { WebSocketServer } from "ws";
import { getCurrentUser, verifyMobileSessionToken, verifySessionToken } from "@/lib/auth";
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
  reorderQueuedMessages,
  updateQueuedMessage
} from "@/lib/conversations";
import { MAX_WS_CONNECTIONS, type ConversationManager } from "@/lib/conversation-manager";
import { isPasswordLoginEnabled } from "@/lib/env";
import { requestStop } from "@/lib/chat-turn-control";
import { parseClientMessage, serializeServerMessage } from "@/lib/ws-protocol";
import type { ClientMessage } from "@/lib/ws-protocol";
import type { Message, QueuedMessage } from "@/lib/types";
import { initializeMcpServers, shutdownAllProcesses } from "@/lib/mcp-client";
import { getConversationManager } from "@/lib/ws-singleton";
import { disposeTitleModel, initTitleModel } from "@/lib/local-title-model";
import { getDb } from "@/lib/db";
import { sendWebSocketData } from "@/lib/ws-send";
import { bootstrapRuntimeState } from "@/lib/runtime-bootstrap";
import { truncateText } from "@/lib/bounded-text";
import { sanitizeMobilePayload } from "@/lib/mobile-api";
import {
  claimWebSocketUpgradeRouting,
  resolveWebSocketAuthMode,
  routeWebSocketUpgrade
} from "@/lib/ws-upgrade-router";

const MAX_WS_ERROR_MESSAGE_CHARS = 1_000;
const MAX_MOBILE_SNAPSHOT_BYTES = 768 * 1024;
const MAX_PRE_SETUP_MESSAGES = 64;

function buildSnapshotMessage(
  conversationId: string,
  messages: Message[],
  queuedMessages: QueuedMessage[],
  versioned: boolean
): Parameters<typeof serializeServerMessage>[0] {
  if (!versioned) {
    return {
      type: "snapshot",
      conversationId,
      messages,
      actions: messages.flatMap(message => message.actions ?? []),
      segments: messages.flatMap(message => message.textSegments ?? []),
      queuedMessages
    };
  }

  let retained = messages.map(({ timeline: _timeline, actions: _actions, textSegments: _textSegments, ...rest }) => rest);
  let actions = messages.flatMap(message => message.actions ?? []);
  let segments = messages.flatMap(message => message.textSegments ?? []);

  const serializedSize = () => Buffer.byteLength(serializeServerMessage({
    type: "snapshot",
    conversationId,
    messages: retained,
    actions,
    segments,
    queuedMessages
  } as Parameters<typeof serializeServerMessage>[0]));

  while (retained.length > 0 && serializedSize() > MAX_MOBILE_SNAPSHOT_BYTES) {
    const removedIds = new Set(
      retained.splice(0, Math.max(1, Math.ceil(retained.length / 8))).map(message => message.id)
    );
    actions = actions.filter(action => !removedIds.has(action.messageId));
    segments = segments.filter(segment => !removedIds.has(segment.messageId));
  }

  return {
    type: "snapshot",
    conversationId,
    messages: retained,
    actions,
    segments,
    queuedMessages
  };
}

export {
  bootstrapRuntimeState,
  disposeTitleModel,
  getDb,
  initTitleModel,
  initializeMcpServers,
  claimWebSocketUpgradeRouting,
  resolveWebSocketAuthMode,
  routeWebSocketUpgrade,
  shutdownAllProcesses
};

function extractToken(req: import("http").IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

function extractBearerToken(req: import("http").IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (!authorization || Array.isArray(authorization)) return null;
  const match = authorization.match(/^Bearer ([^\s,]+)$/);
  return match?.[1] ?? null;
}

export function setupWebSocketHandler(
  wss: WebSocketServer,
  options: {
    authMode?: "browser" | "mobile";
    authModeForRequest?: (request: import("http").IncomingMessage) => "browser" | "mobile";
  } = {}
) {
  const aliveSockets = new WeakSet<WebSocket>();

  wss.on("connection", async (ws, req) => {
    const authMode = options.authModeForRequest?.(req) ?? options.authMode ?? "browser";
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
    const token = authMode === "mobile" ? extractBearerToken(req) : extractToken(req);
    try {
      await handleConnection(ws, token, { authMode });
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

export async function handleConnection(
  ws: WebSocket,
  token: string | null,
  options: { authMode?: "browser" | "mobile" } = {}
) {
  const authMode = options.authMode ?? "browser";
  const versioned = authMode === "mobile";
  let closed = ws.readyState !== WebSocket.OPEN;
  let mgr: ConversationManager | null = null;
  const currentSubscription = new Set<string>();

  let dispatchIncoming: ((raw: WebSocket.RawData) => void) | null = null;
  const preSetupMessages: WebSocket.RawData[] = [];
  ws.on("message", (raw: WebSocket.RawData) => {
    if (dispatchIncoming) {
      dispatchIncoming(raw);
      return;
    }

    if (preSetupMessages.length >= MAX_PRE_SETUP_MESSAGES) {
      closeAfterMessageFailure(ws);
      return;
    }

    preSetupMessages.push(raw);
  });

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

  if (authMode === "mobile") {
    if (!token) {
      sendError(ws, "Authentication required", "authentication_required", true);
      ws.close(1008, "Authentication required");
      return;
    }

    const session = await verifyMobileSessionToken(token);
    if (!session) {
      sendError(ws, "Invalid or expired mobile session", "authentication_required", true);
      ws.close(1008, "Invalid mobile session");
      return;
    }

    sessionUserId = session.userId;
  } else if (isPasswordLoginEnabled()) {
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
  const connectionAdded = versioned
    ? mgr.addConnection(ws, sessionUserId, "mobile")
    : mgr.addConnection(ws, sessionUserId);
  if (!connectionAdded) {
    sendError(ws, "Too many WebSocket connections", "connection_limit", versioned);
    ws.close(1013, "Connection limit reached");
    mgr = null;
    return;
  }

  const active = listActiveConversations(sessionUserId);
  sendServerMessage(ws, {
    type: "ready",
    ...(versioned ? { protocolVersion: "v1" as const } : {}),
    activeConversations: active.map(c => ({
      id: c.id,
      title: c.title,
      status: c.isActive ? "streaming" : "idle"
    }))
  }, versioned);

  dispatchIncoming = (raw: WebSocket.RawData) => {
    try {
      const msg = parseClientMessage(raw.toString());
      if (!msg) return;
      if (mgr) {
        handleMessage(mgr, ws, msg, currentSubscription, sessionUserId, versioned);
      }
    } catch (error) {
      handleMessageFailure(ws, error, versioned);
    }
  };

  for (const raw of preSetupMessages.splice(0)) {
    dispatchIncoming(raw);
  }
}

function handleMessageFailure(ws: WebSocket, error: unknown, versioned = false) {
  try {
    console.error("[ws-handler] message dispatch failed:", error);
  } catch {
    return closeAfterMessageFailure(ws);
  }

  try {
    sendError(ws, "Unable to process WebSocket message", "invalid_message", versioned);
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
  currentUserId: string,
  versioned = false
) {
  switch (msg.type) {
    case "subscribe":
    case "request_snapshot": {
      const snapshot = getConversationSnapshot(msg.conversationId, currentUserId);
      if (!snapshot) {
        sendError(ws, "Conversation not found", "not_found", versioned);
        break;
      }

      if (msg.type === "subscribe") {
        currentSubscription.add(msg.conversationId);
        mgr.subscribe(msg.conversationId, ws);
      }
      sendServerMessage(ws, buildSnapshotMessage(
        msg.conversationId,
        snapshot.messages,
        snapshot.queuedMessages,
        versioned
      ), versioned);
      break;
    }
    case "unsubscribe": {
      currentSubscription.delete(msg.conversationId);
      mgr.unsubscribe(msg.conversationId, ws);
      break;
    }
    case "message": {
      handleUserMessage(mgr, ws, msg, currentUserId, versioned).catch((error) => {
        console.error("[ws-handler] handleUserMessage failed:", error);
        sendServerMessage(ws, {
          type: "error",
          ...(versioned ? { code: "turn_failed" } : {}),
          message: truncateText(
            error instanceof Error ? error.message : "Chat stream failed",
            MAX_WS_ERROR_MESSAGE_CHARS
          )
        }, versioned);
      });
      break;
    }
    case "stop": {
      if (!getConversationSnapshot(msg.conversationId, currentUserId)) {
        sendError(ws, "Conversation not found", "not_found", versioned);
        break;
      }
      requestStop(msg.conversationId);
      break;
    }
    case "queue_message": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId, versioned)) {
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
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId, versioned)) {
        break;
      }

      const updated = updateQueuedMessage({
        conversationId: msg.conversationId,
        queuedMessageId: msg.queuedMessageId,
        content: msg.content
      });

      if (!updated) {
        sendError(ws, "Queued message not found", "not_found", versioned);
        break;
      }

      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
    case "delete_queued_message": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId, versioned)) {
        break;
      }

      const deleted = deleteQueuedMessage({
        conversationId: msg.conversationId,
        queuedMessageId: msg.queuedMessageId
      });

      if (!deleted) {
        sendError(ws, "Queued message not found", "not_found", versioned);
        break;
      }

      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
    case "send_queued_message_now": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId, versioned)) {
        break;
      }

      const moved = moveQueuedMessageToFront({
        conversationId: msg.conversationId,
        queuedMessageId: msg.queuedMessageId
      });

      if (!moved) {
        sendError(ws, "Queued message not found", "not_found", versioned);
        break;
      }

      requestStop(msg.conversationId);
      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
    case "reorder_queued_messages": {
      if (!ensureConversationAccess(ws, msg.conversationId, currentUserId, versioned)) {
        break;
      }

      if (!reorderQueuedMessages({
        conversationId: msg.conversationId,
        queuedMessageIds: msg.queuedMessageIds
      })) {
        sendError(ws, "Invalid queue order", "invalid_request", versioned);
        break;
      }

      broadcastQueueUpdated(mgr, msg.conversationId);
      break;
    }
  }
}

function ensureConversationAccess(
  ws: WebSocket,
  conversationId: string,
  currentUserId: string,
  versioned = false
) {
  if (!getConversationSnapshot(conversationId, currentUserId)) {
    sendError(ws, "Conversation not found", "not_found", versioned);
    return false;
  }

  return true;
}

function sendServerMessage(
  ws: WebSocket,
  message: Parameters<typeof serializeServerMessage>[0],
  versioned = false
) {
  const payload = versioned
    ? sanitizeMobilePayload(message) as Parameters<typeof serializeServerMessage>[0]
    : message;
  sendWebSocketData(ws, serializeServerMessage(payload));
}

function sendError(ws: WebSocket, message: string, code = "request_failed", versioned = false) {
  sendServerMessage(ws, {
    type: "error",
    ...(versioned ? { code } : {}),
    message
  }, versioned);
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
  currentUserId: string,
  versioned = false
) {
  if (!getConversationSnapshot(msg.conversationId, currentUserId)) {
    sendError(ws, "Conversation not found", "not_found", versioned);
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
