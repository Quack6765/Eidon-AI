import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  prepareMessageManipulationTurn,
  restartAssistantTurnAfterMutation
} from "@/lib/chat-turn";
import {
  deleteAssistantMessagesAndChildren,
  getMessage,
  listMessages
} from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "message id");
  if (params instanceof NextResponse) return params;

  const message = getMessage(params.messageId, user.id);
  if (!message) {
    return badRequest("Message not found", 404);
  }
  if (message.role !== "user") {
    return badRequest("Only user messages can be regenerated", 400);
  }

  const allMessages = listMessages(message.conversationId);
  const lastUserMessage = [...allMessages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage || lastUserMessage.id !== message.id) {
    return badRequest("Only the latest user message can be regenerated", 409);
  }

  const turn = prepareMessageManipulationTurn({
    conversationId: message.conversationId,
    userId: user.id,
    busyErrorMessage: "Wait for the current assistant response to finish before regenerating"
  });
  if (turn instanceof Response) return turn;

  const rewritten = restartAssistantTurnAfterMutation({
    conversationId: message.conversationId,
    userMessageId: message.id,
    turn,
    logTag: "message-regenerate-route",
    mutate: () => {
      const targetIndex = allMessages.findIndex((m) => m.id === message.id);
      const trailingAssistantIds = allMessages
        .slice(targetIndex + 1)
        .filter((m) => m.role === "assistant")
        .map((m) => m.id);

      if (trailingAssistantIds.length === 0) {
        return turn.snapshot;
      }

      return deleteAssistantMessagesAndChildren(trailingAssistantIds, user.id);
    }
  });
  return ok(rewritten);
}
