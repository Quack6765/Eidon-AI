import {
  AttachmentTextPreviewUnsupportedError,
  readAttachmentBuffer,
  readAttachmentText
} from "@/lib/attachments";
import { badRequest } from "@/lib/http";
import type { MessageAttachment } from "@/lib/types";

export function buildAttachmentResponse(
  attachment: Pick<MessageAttachment, "id" | "filename" | "mimeType" | "relativePath" | "kind" | "extractedText">,
  format: string | null,
  download: boolean
) {
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
