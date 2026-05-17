import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  getAssistantTurnStartPreflight,
  startAssistantTurnFromExistingUserMessage
} from "@/lib/chat-turn";
import {
  deleteAssistantMessageAndChildren,
  getConversationSnapshot,
  getMessage,
  listMessages
} from "@/lib/conversations";
import { claimChatTurnStart, releaseChatTurnStart } from "@/lib/chat-turn-control";
import { badRequest, ok } from "@/lib/http";
import { getConversationManager } from "@/lib/ws-singleton";

const paramsSchema = z.object({
  messageId: z.string().min(1)
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

  const snapshot = getConversationSnapshot(message.conversationId, user.id);
  if (!snapshot) {
    return badRequest("Conversation not found", 404);
  }
  if (snapshot.conversation.isActive) {
    return badRequest(
      "Wait for the current assistant response to finish before retrying",
      409
    );
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

  const preflight = getAssistantTurnStartPreflight(message.conversationId);
  if (!preflight.ok) {
    return badRequest(preflight.errorMessage, preflight.statusCode);
  }

  const claimed = claimChatTurnStart(message.conversationId);
  if (!claimed.ok) {
    return badRequest(
      "Wait for the current assistant response to finish before retrying",
      409
    );
  }

  try {
    const rewritten = deleteAssistantMessageAndChildren(
      message.id,
      user.id
    );

    void startAssistantTurnFromExistingUserMessage(
      getConversationManager(),
      rewritten.conversation.id,
      userMessageId,
      undefined,
      {
        control: claimed.control,
        preflight
      }
    ).catch((error) => {
      releaseChatTurnStart(message.conversationId, claimed.control);
      console.error("[message-retry-route] continuation failed:", error);
    });

    return ok(rewritten);
  } catch (error) {
    releaseChatTurnStart(message.conversationId, claimed.control);
    throw error;
  }
}
