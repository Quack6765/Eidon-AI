import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { startAssistantTurnFromExistingUserMessage } from "@/lib/chat-turn";
import {
  getConversationSnapshot,
  getMessage,
  rewriteConversationFromEditedUserMessage
} from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";
import { getConversationManager } from "@/lib/ws-singleton";

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

  const body = bodySchema.safeParse(await request.json());
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

  const snapshot = getConversationSnapshot(message.conversationId, user.id);
  if (!snapshot) {
    return badRequest("Conversation not found", 404);
  }
  if (snapshot.conversation.isActive) {
    return badRequest(
      "Wait for the current assistant response to finish before editing this conversation",
      409
    );
  }

  const rewritten = rewriteConversationFromEditedUserMessage(
    message.id,
    {
      content: body.data.content
    },
    user.id
  );

  await startAssistantTurnFromExistingUserMessage(
    getConversationManager(),
    rewritten.conversation.id,
    message.id,
    undefined
  );

  return ok(rewritten);
}
