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
  if (message.role !== "assistant") {
    return badRequest("Only assistant messages can be retried", 400);
  }
  if (message.status !== "error") {
    return badRequest("Only error messages can be retried", 400);
  }

  const allMessages = listMessages(message.conversationId);
  const targetIndex = allMessages.findIndex((m) => m.id === message.id);

  let userMessageId: string | null = null;
  for (let i = targetIndex - 1; i >= 0; i--) {
    if (allMessages[i].role === "user") {
      userMessageId = allMessages[i].id;
      break;
    }
  }

  if (!userMessageId) {
    return badRequest("No user message found before this assistant message", 400);
  }

  const turn = prepareMessageManipulationTurn({
    conversationId: message.conversationId,
    userId: user.id,
    busyErrorMessage: "Wait for the current assistant response to finish before retrying"
  });
  if (turn instanceof Response) return turn;

  try {
    const rewritten = deleteAssistantMessageAndChildren(message.id, user.id);

    startManipulationTurn({
      conversationId: message.conversationId,
      userMessageId: userMessageId!,
      preflight: turn.preflight,
      control: turn.control,
      logTag: "message-retry-route"
    });

    return ok(rewritten);
  } catch (error) {
    releaseChatTurnStart(message.conversationId, turn.control);
    throw error;
  }
}
