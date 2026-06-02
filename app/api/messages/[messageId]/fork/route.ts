import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { forkConversationFromMessage } from "@/lib/conversations";
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

  try {
    const conversation = forkConversationFromMessage(params.messageId, user.id);
    return ok({ conversation }, { status: 201 });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Message not found" || error.message === "Conversation not found") {
        return badRequest(error.message, 404);
      }

      if (error.message === "Only assistant messages can be forked") {
        return badRequest(error.message, 400);
      }
    }

    throw error;
  }
}
