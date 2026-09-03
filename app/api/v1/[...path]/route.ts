import * as accountRoute from "@/app/api/auth/account/route";
import * as automationRunRoute from "@/app/api/automation-runs/[runId]/route";
import * as automationRunRetryRoute from "@/app/api/automation-runs/[runId]/retry/route";
import * as automationRoute from "@/app/api/automations/[automationId]/route";
import * as automationRunNowRoute from "@/app/api/automations/[automationId]/run-now/route";
import * as automationRunsRoute from "@/app/api/automations/[automationId]/runs/route";
import * as automationsRoute from "@/app/api/automations/route";
import * as attachmentRoute from "@/app/api/attachments/[attachmentId]/route";
import * as attachmentsRoute from "@/app/api/attachments/route";
import * as avatarRoute from "@/app/api/avatars/[seed]/route";
import * as botRoute from "@/app/api/bots/[botId]/route";
import * as botMemoriesRoute from "@/app/api/bots/[botId]/memories/route";
import * as botResetBrowserRoute from "@/app/api/bots/[botId]/reset-browser-session/route";
import * as botWorkspaceRoute from "@/app/api/bots/[botId]/workspace/route";
import * as botsRoute from "@/app/api/bots/route";
import * as conversationRoute from "@/app/api/conversations/[conversationId]/route";
import * as conversationChatRoute from "@/app/api/conversations/[conversationId]/chat/route";
import * as conversationShareRoute from "@/app/api/conversations/[conversationId]/share/route";
import * as conversationsRoute from "@/app/api/conversations/route";
import * as conversationSearchRoute from "@/app/api/conversations/search/route";
import * as folderRoute from "@/app/api/folders/[folderId]/route";
import * as foldersRoute from "@/app/api/folders/route";
import * as mcpServerRoute from "@/app/api/mcp-servers/[serverId]/route";
import * as mcpServersRoute from "@/app/api/mcp-servers/route";
import * as mcpServersTestRoute from "@/app/api/mcp-servers/test/route";
import * as memoryRoute from "@/app/api/memories/[memoryId]/route";
import * as memoriesRoute from "@/app/api/memories/route";
import * as messageActionApproveRoute from "@/app/api/message-actions/[actionId]/approve/route";
import * as messageActionDismissRoute from "@/app/api/message-actions/[actionId]/dismiss/route";
import * as messageRoute from "@/app/api/messages/[messageId]/route";
import * as messageEditRestartRoute from "@/app/api/messages/[messageId]/edit-restart/route";
import * as messageForkRoute from "@/app/api/messages/[messageId]/fork/route";
import * as messageRegenerateRoute from "@/app/api/messages/[messageId]/regenerate/route";
import * as messageRetryRoute from "@/app/api/messages/[messageId]/retry/route";
import * as personaRoute from "@/app/api/personas/[personaId]/route";
import * as personasRoute from "@/app/api/personas/route";
import * as providerConnectionRoute from "@/app/api/providers/[profileId]/connection/route";
import * as providerConnectionFlowsRoute from "@/app/api/providers/[profileId]/connection/flows/route";
import * as providerConnectionFlowRoute from "@/app/api/providers/[profileId]/connection/flows/[flowId]/route";
import * as providerModelsRoute from "@/app/api/providers/[profileId]/models/route";
import * as generalSettingsRoute from "@/app/api/settings/general/route";
import * as providerDuplicateRoute from "@/app/api/settings/providers/duplicate/route";
import * as providerSettingsRoute from "@/app/api/settings/providers/route";
import * as settingsRoute from "@/app/api/settings/route";
import * as settingsTestRoute from "@/app/api/settings/test/route";
import * as titleGenerationSettingsRoute from "@/app/api/settings/title-generation/route";
import * as skillRoute from "@/app/api/skills/[skillId]/route";
import * as skillsRoute from "@/app/api/skills/route";
import * as speechCleanupRoute from "@/app/api/speech/transcription/cleanup/route";
import * as speechPrepareRoute from "@/app/api/speech/transcription/prepare/route";
import * as speechTranscribeRoute from "@/app/api/speech/transcription/transcribe/route";
import * as userRoute from "@/app/api/users/[userId]/route";
import * as usersRoute from "@/app/api/users/route";
import {
  authenticateMobileRequest,
  runWithMobileUser
} from "@/lib/auth";
import {
  createQueuedMessage,
  deleteQueuedMessage,
  getConversationSnapshot,
  listQueuedMessages,
  moveQueuedMessageToFront,
  reorderQueuedMessages,
  updateQueuedMessage
} from "@/lib/conversations";
import { requestStop } from "@/lib/chat-turn-control";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import { MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_REQUEST_BYTES } from "@/lib/constants";
import {
  isSecureMobileRequest,
  mobileApiError,
  normalizeMobileApiResponse
} from "@/lib/mobile-api";
import { getConversationManager } from "@/lib/ws-singleton";

type RouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (request: Request, context: RouteContext) => Response | Promise<Response>;
type RouteModule = Record<string, unknown>;

const routes: Array<{ pattern: string[]; module: RouteModule }> = [
  { pattern: ["auth", "account"], module: accountRoute },
  { pattern: ["conversations", "search"], module: conversationSearchRoute },
  { pattern: ["conversations"], module: conversationsRoute },
  { pattern: ["conversations", ":conversationId", "chat"], module: conversationChatRoute },
  { pattern: ["conversations", ":conversationId", "share"], module: conversationShareRoute },
  { pattern: ["conversations", ":conversationId"], module: conversationRoute },
  { pattern: ["folders"], module: foldersRoute },
  { pattern: ["folders", ":folderId"], module: folderRoute },
  { pattern: ["attachments"], module: attachmentsRoute },
  { pattern: ["attachments", ":attachmentId"], module: attachmentRoute },
  { pattern: ["avatars", ":seed"], module: avatarRoute },
  { pattern: ["bots", ":botId", "memories"], module: botMemoriesRoute },
  { pattern: ["bots", ":botId", "reset-browser-session"], module: botResetBrowserRoute },
  { pattern: ["bots", ":botId", "workspace"], module: botWorkspaceRoute },
  { pattern: ["bots", ":botId"], module: botRoute },
  { pattern: ["bots"], module: botsRoute },
  { pattern: ["automations"], module: automationsRoute },
  { pattern: ["automations", ":automationId", "run-now"], module: automationRunNowRoute },
  { pattern: ["automations", ":automationId", "runs"], module: automationRunsRoute },
  { pattern: ["automations", ":automationId"], module: automationRoute },
  { pattern: ["automation-runs", ":runId", "retry"], module: automationRunRetryRoute },
  { pattern: ["automation-runs", ":runId"], module: automationRunRoute },
  { pattern: ["messages", ":messageId", "edit-restart"], module: messageEditRestartRoute },
  { pattern: ["messages", ":messageId", "regenerate"], module: messageRegenerateRoute },
  { pattern: ["messages", ":messageId", "retry"], module: messageRetryRoute },
  { pattern: ["messages", ":messageId", "fork"], module: messageForkRoute },
  { pattern: ["messages", ":messageId"], module: messageRoute },
  { pattern: ["message-actions", ":actionId", "approve"], module: messageActionApproveRoute },
  { pattern: ["message-actions", ":actionId", "dismiss"], module: messageActionDismissRoute },
  { pattern: ["settings", "general"], module: generalSettingsRoute },
  { pattern: ["settings", "title-generation"], module: titleGenerationSettingsRoute },
  { pattern: ["settings", "providers", "duplicate"], module: providerDuplicateRoute },
  { pattern: ["settings", "providers"], module: providerSettingsRoute },
  { pattern: ["settings", "test"], module: settingsTestRoute },
  { pattern: ["settings"], module: settingsRoute },
  { pattern: ["personas"], module: personasRoute },
  { pattern: ["personas", ":personaId"], module: personaRoute },
  { pattern: ["memories"], module: memoriesRoute },
  { pattern: ["memories", ":memoryId"], module: memoryRoute },
  { pattern: ["mcp-servers", "test"], module: mcpServersTestRoute },
  { pattern: ["mcp-servers"], module: mcpServersRoute },
  { pattern: ["mcp-servers", ":serverId"], module: mcpServerRoute },
  { pattern: ["skills"], module: skillsRoute },
  { pattern: ["skills", ":skillId"], module: skillRoute },
  { pattern: ["users"], module: usersRoute },
  { pattern: ["users", ":userId"], module: userRoute },
  { pattern: ["providers", ":profileId", "connection"], module: providerConnectionRoute },
  { pattern: ["providers", ":profileId", "connection", "flows"], module: providerConnectionFlowsRoute },
  { pattern: ["providers", ":profileId", "connection", "flows", ":flowId"], module: providerConnectionFlowRoute },
  { pattern: ["providers", ":profileId", "models"], module: providerModelsRoute },
  { pattern: ["speech", "transcription", "prepare"], module: speechPrepareRoute },
  { pattern: ["speech", "transcription", "transcribe"], module: speechTranscribeRoute },
  { pattern: ["speech", "transcription", "cleanup"], module: speechCleanupRoute }
];

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
    requestStop(conversationId);
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
      const queuedMessage = createQueuedMessage({
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
    if (!moveQueuedMessageToFront({ conversationId, queuedMessageId })) {
      return Response.json({ error: "Queued message not found" }, { status: 404 });
    }
    requestStop(conversationId);
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

    for (const route of routes) {
      const params = matchPattern(route.pattern, path);
      if (!params) continue;
      const handler = route.module[request.method] as RouteHandler | undefined;
      if (!handler) {
        return mobileApiError("unsupported_method", "Method not allowed", 405, {
          headers: { allow: Object.keys(route.module).filter((key) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(key)).join(", ") }
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
