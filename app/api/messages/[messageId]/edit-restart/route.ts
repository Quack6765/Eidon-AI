import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  getAssistantTurnStartPreflight,
  startAssistantTurnFromExistingUserMessage
} from "@/lib/chat-turn";
import {
  getConversationSnapshot,
  getMessage,
  rewriteConversationFromEditedUserMessage
} from "@/lib/conversations";
import { claimChatTurnStart, releaseChatTurnStart } from "@/lib/chat-turn-control";
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

  const preflight = getAssistantTurnStartPreflight(message.conversationId);
  if (!preflight.ok) {
    return badRequest(preflight.errorMessage, preflight.statusCode);
  }

  const claimed = claimChatTurnStart(message.conversationId);
  if (!claimed.ok) {
    return badRequest(
      "Wait for the current assistant response to finish before editing this conversation",
      409
    );
  }

  try {
    const rewritten = rewriteConversationFromEditedUserMessage(
      message.id,
      {
        content: body.data.content
      },
      user.id
    );

    void startAssistantTurnFromExistingUserMessage(
      getConversationManager(),
      rewritten.conversation.id,
      message.id,
      undefined,
      {
        control: claimed.control,
        preflight
      }
    ).catch((error) => {
      releaseChatTurnStart(message.conversationId, claimed.control);
      console.error("[message-edit-restart-route] continuation failed:", error);
    });

    return ok(rewritten);
  } catch (error) {
    releaseChatTurnStart(message.conversationId, claimed.control);
    throw error;
  }
}
