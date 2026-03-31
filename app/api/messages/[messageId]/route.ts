import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  getMessage,
  maybeRetitleConversationFromFirstUserMessage,
  updateMessage
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";
import { estimateTextTokens } from "@/lib/tokenization";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

const updateSchema = z.object({
  content: z.string().trim().min(1)
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid message id");
  }

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid message update");
  }

  const message = getMessage(params.data.messageId);

  if (!message) {
    return badRequest("Message not found", 404);
  }

  if (message.role !== "user") {
    return badRequest("Only user messages can be edited", 400);
  }

  const updated = updateMessage(message.id, {
    content: body.data.content,
    estimatedTokens: estimateTextTokens(body.data.content)
  });

  if (!updated) {
    return badRequest("Message not found", 404);
  }

  maybeRetitleConversationFromFirstUserMessage(updated.conversationId);

  return ok({ message: updated });
}
