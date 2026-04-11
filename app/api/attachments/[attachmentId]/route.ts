import { z } from "zod";

import { deleteAttachmentById, getAttachment, readAttachmentBuffer } from "@/lib/attachments";
import { requireUser } from "@/lib/auth";
import { badRequest } from "@/lib/http";

const paramsSchema = z.object({
  attachmentId: z.string().min(1)
});

export async function GET(
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

  const attachment = getAttachment(params.data.attachmentId, user.id);

  if (!attachment) {
    return badRequest("Attachment not found", 404);
  }

  try {
    const buffer = readAttachmentBuffer(attachment);

    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${attachment.filename}"`
      }
    });
  } catch {
    return badRequest("Attachment file not found", 404);
  }
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
