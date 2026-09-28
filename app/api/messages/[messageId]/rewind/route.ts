import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { claimChatTurnStart, releaseChatTurnStart } from "@/lib/chat-turn-control";
import { getConversationContextUsage } from "@/lib/compaction";
import { getConversation, getMessage, rewindConversationToMessage } from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { getConversationManager } from "@/lib/ws-singleton";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

const BUSY_ERROR_MESSAGE = "Wait for the current assistant response to finish before rewinding this conversation";

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
  if (message.role === "system") {
    return badRequest("Only user and assistant messages can be rewound to", 400);
  }

  const conversation = getConversation(message.conversationId, user.id);
  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }
  if (conversation.isActive) {
    return badRequest(BUSY_ERROR_MESSAGE, 409);
  }

  const claimed = claimChatTurnStart(conversation.id);
  if (!claimed.ok) {
    return badRequest(BUSY_ERROR_MESSAGE, 409);
  }

  try {
    const { snapshot, deletedMessageIds, draft } = rewindConversationToMessage(message.id, user.id);

    if (deletedMessageIds.length > 0) {
      try {
        const manager = getConversationManager();
        manager.broadcast(conversation.id, {
          type: "messages_deleted",
          conversationId: conversation.id,
          messageIds: deletedMessageIds
        });
        const contextUsage = getConversationContextUsage(conversation.id, user.id);
        if (contextUsage) {
          manager.broadcast(conversation.id, {
            type: "delta",
            conversationId: conversation.id,
            event: {
              type: "context_usage",
              contextTokens: contextUsage.contextTokens ?? 0,
              compactionLimit: contextUsage.compactionLimit
            }
          });
        }
      } catch {}
    }

    return ok({ ...snapshot, draft });
  } catch (error) {
    if (error instanceof Error && (error.message === "Message not found" || error.message === "Conversation not found")) {
      return badRequest(error.message, 404);
    }
    throw error;
  } finally {
    releaseChatTurnStart(conversation.id, claimed.control);
  }
}
