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
    const isImage = attachment.kind === "image";
    const disposition = download || !isImage ? "attachment" : "inline";

    return new Response(buffer, {
      headers: {
        "Content-Type": isImage ? attachment.mimeType : "application/octet-stream",
        "Content-Length": String(buffer.length),
        "Content-Disposition": `${disposition}; filename="${attachment.filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store"
      }
    });
  } catch {
    return badRequest("Attachment file not found", 404);
  }
}
