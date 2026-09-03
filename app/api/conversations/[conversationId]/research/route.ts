import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { RequestBodyTooLargeError, readRequestBodyWithLimit } from "@/lib/bounded-request";
import {
  ACTIVE_TURN_ERROR_MESSAGE,
  createPendingUserMessage,
  getAssistantTurnStartPreflight,
  startAssistantTurnFromExistingUserMessage
} from "@/lib/chat-turn";
import { claimChatTurnStart } from "@/lib/chat-turn-control";
import {
  MAX_ATTACHMENT_IDS_PER_MESSAGE,
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_REQUEST_BYTES,
  MAX_RESEARCH_PLAN_STEPS,
  MAX_RESEARCH_PLAN_STEP_CHARS
} from "@/lib/constants";
import { deletePendingUserMessage, getConversation, getMessage } from "@/lib/conversations";
import { badRequest, ok, parseRouteParams, payloadTooLarge } from "@/lib/http";
import { generateResearchPlan } from "@/lib/research-plan";
import { getConversationManager } from "@/lib/ws-singleton";

const paramsSchema = z.object({ conversationId: z.string().min(1) });

const prepareSchema = z.object({
  message: z.string().trim().min(1).max(MAX_CHAT_MESSAGE_CHARS),
  attachmentIds: z.array(z.string().min(1)).max(MAX_ATTACHMENT_IDS_PER_MESSAGE).default([])
});

const startSchema = z.object({
  userMessageId: z.string().min(1),
  personaId: z.string().min(1).optional(),
  plan: z.array(z.string().trim().min(1).max(MAX_RESEARCH_PLAN_STEP_CHARS)).min(1).max(MAX_RESEARCH_PLAN_STEPS)
});

const cancelSchema = z.object({ userMessageId: z.string().min(1) });

type RouteContext = { params: Promise<{ conversationId: string }> };

async function readJsonBody(request: Request) {
  try {
    return {
      body: JSON.parse(Buffer.from(await readRequestBodyWithLimit(request, MAX_CHAT_REQUEST_BYTES)).toString("utf8")) as unknown
    };
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return { response: payloadTooLarge(error.message) };
    return { response: badRequest("Invalid research request") };
  }
}

async function resolveConversation(request: Request, context: RouteContext) {
  const user = await requireUser(false);
  if (!user) return { response: badRequest("Authentication required", 401) };
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return { response: params };
  const conversation = getConversation(params.conversationId, user.id);
  if (!conversation) return { response: badRequest("Conversation not found", 404) };
  const read = await readJsonBody(request);
  if (read.response) return { response: read.response };
  return { user, conversation, body: read.body };
}

export async function POST(request: Request, context: RouteContext) {
  const resolved = await resolveConversation(request, context);
  if (resolved.response) return resolved.response;
  const payload = prepareSchema.safeParse(resolved.body);
  if (!payload.success) return badRequest("Invalid research request");

  const userMessage = createPendingUserMessage({
    conversationId: resolved.conversation.id,
    content: payload.data.message,
    attachmentIds: payload.data.attachmentIds
  });
  const message = getMessage(userMessage.id, resolved.user.id);
  if (!message) return badRequest("Unable to persist the research request", 500);
  getConversationManager().broadcast(resolved.conversation.id, {
    type: "user_message_persisted",
    conversationId: resolved.conversation.id,
    message
  });

  const preflight = getAssistantTurnStartPreflight(resolved.conversation.id);
  const plan = preflight.ok
    ? await generateResearchPlan({
        message: payload.data.message,
        settings: preflight.settings,
        abortSignal: request.signal
      })
    : null;

  return ok({ message, plan });
}

export async function PUT(request: Request, context: RouteContext) {
  const resolved = await resolveConversation(request, context);
  if (resolved.response) return resolved.response;
  const payload = startSchema.safeParse(resolved.body);
  if (!payload.success) return badRequest("Invalid research request");

  const userMessage = getMessage(payload.data.userMessageId, resolved.user.id);
  if (!userMessage || userMessage.role !== "user" || userMessage.conversationId !== resolved.conversation.id) {
    return badRequest("User message not found", 404);
  }

  const claimed = claimChatTurnStart(resolved.conversation.id);
  if (!claimed.ok) return badRequest(ACTIVE_TURN_ERROR_MESSAGE, 409);

  void startAssistantTurnFromExistingUserMessage(
    getConversationManager(),
    resolved.conversation.id,
    userMessage.id,
    payload.data.personaId,
    { control: claimed.control, research: { plan: payload.data.plan } }
  ).catch(() => {});

  return ok({ started: true });
}

export async function DELETE(request: Request, context: RouteContext) {
  const resolved = await resolveConversation(request, context);
  if (resolved.response) return resolved.response;
  const payload = cancelSchema.safeParse(resolved.body);
  if (!payload.success) return badRequest("Invalid research request");

  const deleted = deletePendingUserMessage(resolved.conversation.id, payload.data.userMessageId, resolved.user.id);
  if (!deleted) return badRequest("User message not found", 404);
  return ok({ deleted: true });
}
