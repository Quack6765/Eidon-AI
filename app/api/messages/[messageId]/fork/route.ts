import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { forkConversationFromMessage } from "@/lib/conversations";
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

  try {
    const conversation = forkConversationFromMessage(params.data.messageId, user.id);
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
