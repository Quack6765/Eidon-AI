import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deleteConversation,
  getConversation,
  listMessages,
  moveConversationToFolder
} from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const conversation = getConversation(params.data.conversationId);

  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }

  return ok({
    conversation,
    messages: listMessages(conversation.id),
    debug: getConversationDebugStats(conversation.id)
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  deleteConversation(params.data.conversationId);
  return ok({ success: true });
}

const updateSchema = z.object({
  folderId: z.string().nullable()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid conversation update");
  }

  const conversation = getConversation(params.data.conversationId);

  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }

  moveConversationToFolder(conversation.id, body.data.folderId);
  return ok({ conversation: getConversation(conversation.id) });
}
