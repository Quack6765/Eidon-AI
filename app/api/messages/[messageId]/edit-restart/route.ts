import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  prepareMessageManipulationTurn,
  startManipulationTurn
} from "@/lib/chat-turn";
import { releaseChatTurnStart } from "@/lib/chat-turn-control";
import {
  getMessage,
  rewriteConversationFromEditedUserMessage
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

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
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return badRequest("Invalid message id");
  }

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

  const message = getMessage(params.data.messageId, user.id);
  if (!message) {
    return badRequest("Message not found", 404);
  }
  if (message.role !== "user") {
    return badRequest("Only user messages can be edited", 400);
  }

  const turn = prepareMessageManipulationTurn({
    conversationId: message.conversationId,
    userId: user.id,
    busyErrorMessage: "Wait for the current assistant response to finish before editing this conversation"
  });
  if (turn instanceof Response) return turn;

  try {
    const rewritten = rewriteConversationFromEditedUserMessage(
      message.id,
      { content: body.data.content },
      user.id
    );

    startManipulationTurn({
      conversationId: message.conversationId,
      userMessageId: message.id,
      preflight: turn.preflight,
      control: turn.control,
      logTag: "message-edit-restart-route"
    });

    return ok(rewritten);
  } catch (error) {
    releaseChatTurnStart(message.conversationId, turn.control);
    throw error;
  }
}
