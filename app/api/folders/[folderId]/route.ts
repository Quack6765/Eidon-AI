import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteFolder, getFolder, renameFolder, reorderFolders } from "@/lib/folders";
import { moveConversationToFolder } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ folderId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid folder id");

  const folder = getFolder(params.data.folderId);
  if (!folder) return badRequest("Folder not found", 404);

  const body = await request.json() as { name?: string; sortOrder?: number; conversationId?: string; moveConversationTo?: string | null };

  if (body.name) {
    renameFolder(params.data.folderId, body.name);
  }

  if (body.conversationId) {
    moveConversationToFolder(body.conversationId, params.data.folderId);
  }

  if (body.moveConversationTo !== undefined) {
    moveConversationToFolder(params.data.folderId, null);
  }

  return ok({ success: true });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid folder id");

  deleteFolder(params.data.folderId);
  return ok({ success: true });
}
