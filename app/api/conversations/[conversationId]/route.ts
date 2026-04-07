import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deleteConversation,
  deleteConversationIfEmpty,
  getConversation,
  listVisibleMessages,
  moveConversationToFolder,
  setConversationActive,
  updateConversationProviderProfile
} from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";
import { badRequest, ok } from "@/lib/http";
import { getProviderProfile } from "@/lib/settings";
import { getConversationManager } from "@/lib/ws-handler";

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
    messages: listVisibleMessages(conversation.id),
    debug: getConversationDebugStats(conversation.id)
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const onlyIfEmptyParam = new URL(request.url).searchParams.get("onlyIfEmpty");
  const onlyIfEmpty = onlyIfEmptyParam === "1" || onlyIfEmptyParam === "true";
  const deleted = onlyIfEmpty
    ? deleteConversationIfEmpty(params.data.conversationId)
    : (deleteConversation(params.data.conversationId), true);

  if (deleted) {
    try {
      getConversationManager().broadcastAll({
        type: "conversation_deleted",
        conversationId: params.data.conversationId
      });
    } catch { /* WS server may not be running */ }
  }

  return ok({ success: true, deleted });
}

const updateSchema = z
  .object({
    folderId: z.string().nullable().optional(),
    providerProfileId: z.string().min(1).optional(),
    isActive: z.boolean().optional()
  })
  .refine(
    (value) =>
      value.folderId !== undefined ||
      value.providerProfileId !== undefined ||
      value.isActive !== undefined,
    "Invalid conversation update"
  );

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

  if (body.data.folderId !== undefined) {
    moveConversationToFolder(conversation.id, body.data.folderId);
  }

  if (body.data.providerProfileId !== undefined) {
    const providerProfile = getProviderProfile(body.data.providerProfileId);

    if (!providerProfile) {
      return badRequest("Provider profile not found", 404);
    }

    updateConversationProviderProfile(conversation.id, providerProfile.id);
  }

  if (body.data.isActive !== undefined) {
    setConversationActive(conversation.id, body.data.isActive);
  }

  const updated = getConversation(conversation.id);

  try {
    getConversationManager().broadcastAll({
      type: "conversation_updated",
      conversation: {
        id: updated!.id,
        title: updated!.title,
        folderId: updated!.folderId,
        updatedAt: updated!.updatedAt,
        isActive: updated!.isActive
      }
    });
  } catch { /* WS server may not be running */ }

  return ok({ conversation: updated });
}
