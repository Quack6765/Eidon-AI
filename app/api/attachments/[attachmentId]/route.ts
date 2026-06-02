import { z } from "zod";

import {
  deleteAttachmentById,
  getAttachment
} from "@/lib/attachments";
import { buildAttachmentResponse } from "@/lib/attachment-response";
import { requireUser } from "@/lib/auth";
import { badRequest } from "@/lib/http";

const paramsSchema = z.object({
  attachmentId: z.string().min(1)
});

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> }
) {
  const user = await requireUser(false);

  if (!user) {
    return badRequest("Authentication required", 401);
  }

  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid attachment id");
  }

  const attachment = getAttachment(params.data.attachmentId, user.id);

  if (!attachment) {
    return badRequest("Attachment not found", 404);
  }

  const format = new URL(request.url).searchParams.get("format");
  const download = new URL(request.url).searchParams.get("download") === "1";

  return buildAttachmentResponse(attachment, format, download);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ attachmentId: string }> }
) {
  const user = await requireUser(false);

  if (!user) {
    return badRequest("Authentication required", 401);
  }

  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid attachment id");
  }

  try {
    const deleted = deleteAttachmentById(params.data.attachmentId, { userId: user.id });
    return Response.json({ success: deleted });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to delete attachment");
  }
}
