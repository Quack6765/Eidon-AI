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
  if (message.role !== "user") {
    return badRequest("Only user messages can be regenerated", 400);
  }

  const snapshot = getConversationSnapshot(message.conversationId, user.id);
  if (!snapshot) {
    return badRequest("Conversation not found", 404);
  }
  if (snapshot.conversation.isActive) {
    return badRequest(
      "Wait for the current assistant response to finish before regenerating",
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
      "Wait for the current assistant response to finish before regenerating",
      409
    );
  }

  try {
    const allMessages = listMessages(message.conversationId);
    const targetIndex = allMessages.findIndex((m) => m.id === message.id);

    let rewritten = snapshot;
    for (let i = targetIndex + 1; i < allMessages.length; i++) {
      if (allMessages[i].role === "assistant") {
        rewritten = deleteAssistantMessageAndChildren(allMessages[i].id, user.id);
        break;
      }
    }

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
      console.error("[message-regenerate-route] continuation failed:", error);
    });

    return ok(rewritten);
  } catch (error) {
    releaseChatTurnStart(message.conversationId, claimed.control);
    throw error;
  }
}
