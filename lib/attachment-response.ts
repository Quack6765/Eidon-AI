import {
  AttachmentTextPreviewUnsupportedError,
  readAttachmentBuffer,
  readAttachmentText
} from "@/lib/attachments";
import { badRequest } from "@/lib/http";
import type { AttachmentKind, MessageAttachment } from "@/lib/types";

function buildContentDisposition(disposition: "inline" | "attachment", filename: string) {
  const asciiFilename = filename.replace(/[^\w.-]+/g, "_") || "file";
  if (asciiFilename === filename) {
    return `${disposition}; filename="${filename}"`;
  }

  const encodedFilename = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

export function buildFileResponse(
  file: { filename: string; mimeType: string; kind: AttachmentKind; byteSize: number },
  body: BodyInit,
  download: boolean
) {
  const isImage = file.kind === "image";
  const disposition = download || !isImage ? "attachment" : "inline";

  return new Response(body, {
    headers: {
      "Content-Type": isImage ? file.mimeType : "application/octet-stream",
      "Content-Length": String(file.byteSize),
      "Content-Disposition": buildContentDisposition(disposition, file.filename),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
}

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
    return buildFileResponse({ ...attachment, byteSize: buffer.length }, buffer, download);
  } catch {
    return badRequest("Attachment file not found", 404);
  }
}
