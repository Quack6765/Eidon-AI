import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deleteConversation,
  deleteConversationIfEmpty,
  getConversation,
  listQueuedMessages,
  listVisibleMessages,
  moveConversationToFolder,
  renameConversation,
  setConversationActive,
  setConversationTemporary,
  updateConversationProviderProfile
} from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";
import { getFolder } from "@/lib/folders";
import { badRequest, ok, parseRouteParams } from "@/lib/http";
import { getProviderProfile } from "@/lib/settings";
import { getConversationManager } from "@/lib/ws-singleton";

const paramsSchema = z.object({
  conversationId: z.string().min(1)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  const conversation = getConversation(params.conversationId, user.id);

  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }

  return ok({
    conversation,
    messages: listVisibleMessages(conversation.id),
    queuedMessages: listQueuedMessages(conversation.id),
    debug: getConversationDebugStats(conversation.id)
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  const onlyIfEmptyParam = new URL(request.url).searchParams.get("onlyIfEmpty");
  const onlyIfEmpty = onlyIfEmptyParam === "1" || onlyIfEmptyParam === "true";
  const conversation = getConversation(params.conversationId, user.id);

  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }

  const deleted = onlyIfEmpty
    ? deleteConversationIfEmpty(params.conversationId, user.id)
    : deleteConversation(params.conversationId, user.id);

  if (deleted) {
    try {
      getConversationManager().broadcastAll({
        type: "conversation_deleted",
        conversationId: params.conversationId
      }, user.id);
    } catch { /* WS server may not be running */ }
  }

  return ok({ success: true, deleted });
}

const updateSchema = z
  .object({
    folderId: z.string().nullable().optional(),
    providerProfileId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    isTemporary: z.boolean().optional(),
    title: z.string().min(1).max(200).optional()
  })
  .refine(
    (value) =>
      value.folderId !== undefined ||
      value.providerProfileId !== undefined ||
      value.isActive !== undefined ||
      value.isTemporary !== undefined ||
      value.title !== undefined,
    "Invalid conversation update"
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const user = await requireUser();
  const params = await parseRouteParams(context, paramsSchema, "conversation id");
  if (params instanceof NextResponse) return params;

  const body = updateSchema.safeParse(await request.json());

  if (!body.success) {
    return badRequest("Invalid conversation update");
  }

  const conversation = getConversation(params.conversationId, user.id);

  if (!conversation) {
    return badRequest("Conversation not found", 404);
  }

  if (body.data.folderId !== undefined) {
    if (body.data.folderId && !getFolder(body.data.folderId, user.id)) {
      return badRequest("Folder not found", 404);
    }

    moveConversationToFolder(conversation.id, body.data.folderId, user.id);
  }

  if (body.data.providerProfileId !== undefined) {
    const providerProfile = getProviderProfile(body.data.providerProfileId);

    if (!providerProfile) {
      return badRequest("Provider profile not found", 404);
    }

    updateConversationProviderProfile(conversation.id, providerProfile.id, user.id);
  }

  if (body.data.isActive !== undefined) {
    setConversationActive(conversation.id, body.data.isActive);
  }

  if (body.data.isTemporary !== undefined) {
    setConversationTemporary(conversation.id, body.data.isTemporary);
  }

  if (body.data.title !== undefined) {
    renameConversation(conversation.id, body.data.title);
    try {
      getConversationManager().broadcastAll(
        {
          type: "conversation_title_updated",
          conversationId: conversation.id,
          title: body.data.title
        },
        user.id
      );
    } catch {}
  }

  const updated = getConversation(conversation.id, user.id);

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
    }, user.id);
  } catch { /* WS server may not be running */ }

  return ok({ conversation: updated });
}
