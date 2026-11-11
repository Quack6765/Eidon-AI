import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { restartTurnAfterMutation } from "@/lib/turn-session";
import {
  getMessage,
  rewriteConversationFromEditedUserMessage
} from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

const bodySchema = z.object({
  content: z.string().trim().min(1)
});

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "message id");
  if (params instanceof NextResponse) return params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest("Invalid message update");
  }

  const body = bodySchema.safeParse(rawBody);
  if (!body.success) {
    return badRequest("Invalid message update");
  }

  const message = getMessage(params.messageId, user.id);
  if (!message) {
    return badRequest("Message not found", 404);
  }
  if (message.role !== "user") {
    return badRequest("Only user messages can be edited", 400);
  }

  const restarted = restartTurnAfterMutation({
    conversationId: message.conversationId,
    userId: user.id,
    userMessageId: message.id,
    busyErrorMessage: "Wait for the current assistant response to finish before editing this conversation",
    logTag: "message-edit-restart-route",
    mutate: () => rewriteConversationFromEditedUserMessage(
      message.id,
      { content: body.data.content },
      user.id
    )
  });
  return restarted instanceof Response ? restarted : ok(restarted);
}
