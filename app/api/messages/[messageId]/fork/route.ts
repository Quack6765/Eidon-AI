import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { forkConversationFromMessage } from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { getConversationManager } from "@/lib/ws-singleton";

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

  try {
    const { conversation, draft } = forkConversationFromMessage(params.messageId, user.id);

    try {
      getConversationManager().broadcastAll({
        type: "conversation_created",
        conversation: {
          id: conversation.id,
          title: conversation.title,
          folderId: conversation.folderId,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          isActive: conversation.isActive,
          isTemporary: conversation.isTemporary
        }
      }, user.id);
    } catch {}

    return ok({ conversation, draft }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Message not found" || error.message === "Conversation not found") {
        return badRequest(error.message, 404);
      }

      if (
        error.message === "Only user and assistant messages can be forked" ||
        error.message === "Bot conversations cannot be forked"
      ) {
        return badRequest(error.message, 400);
      }
    }

    throw error;
  }
}
