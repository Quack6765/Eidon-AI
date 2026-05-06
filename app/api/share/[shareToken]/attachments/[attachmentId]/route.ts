import { z } from "zod";

import {
  AttachmentTextPreviewUnsupportedError,
  readAttachmentBuffer,
  readAttachmentText
} from "@/lib/attachments";
import { getSharedConversationSnapshot } from "@/lib/conversations";
import { badRequest } from "@/lib/http";

const paramsSchema = z.object({
  shareToken: z.string().min(16),
  attachmentId: z.string().min(1)
});

export async function GET(
  request: Request,
  context: { params: Promise<{ shareToken: string; attachmentId: string }> }
) {
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Attachment not found", 404);
  }

  const snapshot = getSharedConversationSnapshot(params.data.shareToken);

  if (!snapshot) {
    return badRequest("Attachment not found", 404);
  }

  const attachment = snapshot.messages
    .flatMap((message) => message.attachments ?? [])
    .find((item) => item.id === params.data.attachmentId);

  if (!attachment) {
    return badRequest("Attachment not found", 404);
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const download = url.searchParams.get("download") === "1";

  if (format === "text") {
    try {
      return Response.json({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        content: readAttachmentText(attachment)
      });
    } catch (error) {
      if (error instanceof AttachmentTextPreviewUnsupportedError) {
        return badRequest("Attachment cannot be previewed as text", 415);
      }

      return badRequest("Internal server error", 500);
    }
  }

  try {
    const buffer = readAttachmentBuffer(attachment);

    return new Response(buffer, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${attachment.filename}"`
      }
    });
  } catch {
    return badRequest("Attachment file not found", 404);
  }
}
