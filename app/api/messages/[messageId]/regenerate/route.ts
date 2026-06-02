import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  prepareMessageManipulationTurn,
  startManipulationTurn
} from "@/lib/chat-turn";
import { releaseChatTurnStart } from "@/lib/chat-turn-control";
import {
  deleteAssistantMessageAndChildren,
  getMessage,
  listMessages
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return badRequest("Invalid message id");
  }

  const message = getMessage(params.data.messageId, user.id);
  if (!message) {
    return badRequest("Message not found", 404);
  }
  if (message.role !== "user") {
    return badRequest("Only user messages can be regenerated", 400);
  }

  const turn = prepareMessageManipulationTurn({
    conversationId: message.conversationId,
    userId: user.id,
    busyErrorMessage: "Wait for the current assistant response to finish before regenerating"
  });
  if (turn instanceof Response) return turn;

  try {
    const allMessages = listMessages(message.conversationId);
    const targetIndex = allMessages.findIndex((m) => m.id === message.id);

    let rewritten = turn.snapshot;
    for (let i = targetIndex + 1; i < allMessages.length; i++) {
      if (allMessages[i].role === "assistant") {
        rewritten = deleteAssistantMessageAndChildren(allMessages[i].id, user.id);
        break;
      }
    }

    startManipulationTurn({
      conversationId: message.conversationId,
      userMessageId: message.id,
      preflight: turn.preflight,
      control: turn.control,
      logTag: "message-regenerate-route"
    });

    return ok(rewritten);
  } catch (error) {
    releaseChatTurnStart(message.conversationId, turn.control);
    throw error;
  }
}
