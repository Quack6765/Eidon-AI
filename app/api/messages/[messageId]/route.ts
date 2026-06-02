import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  getMessage,
  updateMessage
} from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
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
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "message id");
  if (params instanceof NextResponse) return params;

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid message update");
  }

  const message = getMessage(params.messageId, user.id);

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
  return ok({ message: updated });
}
