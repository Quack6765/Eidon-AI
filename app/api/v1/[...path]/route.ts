import {
  exportedMethods,
  mobileGatewayRoutes,
  type RouteHandler
} from "@/app/api/v1/mobile-route-table";

import {
  authenticateMobileRequest,
  runWithMobileUser
} from "@/lib/auth";
import {
  deleteQueuedMessage,
  getConversationSnapshot,
  listQueuedMessages,
  reorderQueuedMessages,
  updateQueuedMessage
} from "@/lib/conversations";
import { stopConversationWork } from "@/lib/bot-runs";
import { queueFollowUpMessage, sendQueuedMessageNow } from "@/lib/queued-chat-dispatcher";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import { MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_REQUEST_BYTES } from "@/lib/constants";
import {
  isSecureMobileRequest,
  mobileApiError,
  normalizeMobileApiResponse
} from "@/lib/mobile-api";
import { getConversationManager } from "@/lib/ws-singleton";

function matchPattern(pattern: string[], path: string[]) {
  if (pattern.length !== path.length) return null;
  const params: Record<string, string> = {};

  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = path[index];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = actual;
    } else if (expected !== actual) {
      return null;
    }
  }

  return params;
}

function broadcastQueue(conversationId: string) {
  getConversationManager().broadcast(conversationId, {
    type: "queue_updated",
    conversationId,
    queuedMessages: listQueuedMessages(conversationId)
  });
}

async function readJsonBody(request: Request): Promise<{ payload: unknown; error?: Response }> {
  try {
    const body = await readRequestBodyWithLimit(request, MAX_CHAT_REQUEST_BYTES);
    return { payload: JSON.parse(Buffer.from(body).toString("utf8")) };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { payload: null, error: Response.json({ error: error.message }, { status: 413 }) };
    }
    return { payload: null };
  }
}

async function handleQueueRoute(request: Request, path: string[], userId: string) {
  if (path.length < 3 || (path[2] !== "stop" && path[2] !== "queue")) {
    return null;
  }

  const conversationId = path[1];
  if (!getConversationSnapshot(conversationId, userId)) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (path.length === 3 && path[2] === "stop" && request.method === "POST") {
    stopConversationWork(conversationId);
    return Response.json({ success: true });
  }

  if (path.length === 3 && path[2] === "queue") {
    if (request.method === "GET") {
      return Response.json({ queuedMessages: listQueuedMessages(conversationId) });
    }
    if (request.method === "POST") {
      const { payload, error: bodyError } = await readJsonBody(request);
      if (bodyError) return bodyError;
      const body = payload as { content?: unknown; mode?: unknown } | null;
      if (
        typeof body?.content !== "string" ||
        !body.content.trim() ||
        body.content.length > MAX_CHAT_MESSAGE_CHARS ||
        (body.mode !== undefined && body.mode !== "chat" && body.mode !== "image")
      ) {
        return Response.json({ error: "Invalid queued message payload" }, { status: 400 });
      }
      const queuedMessage = queueFollowUpMessage({
        conversationId,
        content: body.content,
        mode: body.mode
      });
      broadcastQueue(conversationId);
      return Response.json({ queuedMessage }, { status: 201 });
    }
  }

  if (path.length === 4 && path[2] === "queue" && path[3] === "order" && request.method === "PUT") {
    const { payload, error: bodyError } = await readJsonBody(request);
    if (bodyError) return bodyError;
    const body = payload as { queuedMessageIds?: unknown } | null;
    if (
      !Array.isArray(body?.queuedMessageIds) ||
      !body.queuedMessageIds.every((id) => typeof id === "string" && id.length > 0) ||
      !reorderQueuedMessages({ conversationId, queuedMessageIds: body.queuedMessageIds })
    ) {
      return Response.json({ error: "Invalid queue order" }, { status: 400 });
    }
    broadcastQueue(conversationId);
    return Response.json({ queuedMessages: listQueuedMessages(conversationId) });
  }

  const queuedMessageId = path[3];
  if (path.length === 4 && path[2] === "queue") {
    if (request.method === "PATCH") {
      const { payload, error: bodyError } = await readJsonBody(request);
      if (bodyError) return bodyError;
      const body = payload as { content?: unknown } | null;
      if (typeof body?.content !== "string" || !body.content.trim() || body.content.length > MAX_CHAT_MESSAGE_CHARS) {
        return Response.json({ error: "Invalid queued message payload" }, { status: 400 });
      }
      const queuedMessage = updateQueuedMessage({ conversationId, queuedMessageId, content: body.content });
      if (!queuedMessage) return Response.json({ error: "Queued message not found" }, { status: 404 });
      broadcastQueue(conversationId);
      return Response.json({ queuedMessage });
    }
    if (request.method === "DELETE") {
      if (!deleteQueuedMessage({ conversationId, queuedMessageId })) {
        return Response.json({ error: "Queued message not found" }, { status: 404 });
      }
      broadcastQueue(conversationId);
      return Response.json({ success: true });
    }
  }

  if (
    path.length === 5 &&
    path[2] === "queue" &&
    path[4] === "send-now" &&
    request.method === "POST"
  ) {
    if (!sendQueuedMessageNow({ conversationId, queuedMessageId })) {
      return Response.json({ error: "Queued message not found" }, { status: 404 });
    }
    broadcastQueue(conversationId);
    return Response.json({ success: true });
  }

  return null;
}

async function dispatch(
  request: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  if (!isSecureMobileRequest(request)) {
    return mobileApiError("insecure_transport", "A trusted HTTPS connection is required", 400);
  }

  const authenticated = await authenticateMobileRequest(request);
  if (!authenticated) {
    return mobileApiError("authentication_required", "Invalid or expired mobile session", 401, {
      headers: { "www-authenticate": "Bearer" }
    });
  }

  const { path } = await context.params;

  try {
    const customResponse = path[0] === "conversations"
      ? await handleQueueRoute(request, path, authenticated.user.id)
      : null;
    if (customResponse) return normalizeMobileApiResponse(customResponse);

    for (const route of mobileGatewayRoutes) {
      const params = matchPattern(route.pattern, path);
      if (!params) continue;
      const handler = route.module[request.method] as RouteHandler | undefined;
      if (!handler) {
        return mobileApiError("unsupported_method", "Method not allowed", 405, {
          headers: { allow: exportedMethods(route.module).map((method) => method.toUpperCase()).join(", ") }
        });
      }

      const response = await runWithMobileUser(
        authenticated.sessionId,
        authenticated.user,
        () => handler(request, { params: Promise.resolve(params) })
      );
      return normalizeMobileApiResponse(response);
    }

    return mobileApiError("not_found", "Mobile API operation not found", 404);
  } catch (error) {
    console.error("[mobile-api] handler failed", {
      method: request.method,
      path: path.join("/"),
      error: error instanceof Error ? error.name : "UnknownError"
    });
    return mobileApiError("internal_error", "Unable to complete the request", 500);
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
