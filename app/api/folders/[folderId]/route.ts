import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteFolder, getFolder, renameFolder } from "@/lib/folders";
import { moveConversationToFolder } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ folderId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ folderId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid folder id");

  const folder = getFolder(params.data.folderId, user.id);
  if (!folder) return badRequest("Folder not found", 404);

  const body = await request.json() as { name?: string; sortOrder?: number; conversationId?: string; moveConversationTo?: string | null };

  if (body.name) {
    renameFolder(params.data.folderId, body.name, user.id);
  }

  if (body.conversationId) {
    moveConversationToFolder(body.conversationId, params.data.folderId, user.id);
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
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid folder id");

  deleteFolder(params.data.folderId, user.id);
  return ok({ success: true });
}
