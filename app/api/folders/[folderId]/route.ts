import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteFolder, getFolder, renameFolder } from "@/lib/folders";
import { moveConversationToFolder } from "@/lib/conversations";
import { badRequest, ok, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({ folderId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "folder id");
  if (params instanceof NextResponse) return params;

  const folder = getFolder(params.folderId, user.id);
  if (!folder) return badRequest("Folder not found", 404);

  const body = await request.json() as { name?: string; sortOrder?: number; conversationId?: string; moveConversationTo?: string | null };

  if (body.name) {
    renameFolder(params.folderId, body.name, user.id);
  }

  if (body.conversationId) {
    moveConversationToFolder(body.conversationId, params.folderId, user.id);
  }

  if (typeof body.moveConversationTo === "string") {
    moveConversationToFolder(body.moveConversationTo, null, user.id);
  }

  return ok({ success: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const user = await requireUser();
    const params = await parseRouteParams(context, paramsSchema, "folder id");
  if (params instanceof NextResponse) return params;

  deleteFolder(params.folderId, user.id);
  return ok({ success: true });
}
