import { z } from "zod";

import { createAttachments } from "@/lib/attachments";
import { requireUser } from "@/lib/auth";
import { getConversation } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const formSchema = z.object({
  conversationId: z.string().min(1)
});

function getMultipartBoundary(contentType: string | null) {
  if (!contentType) {
    return null;
  }

  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseContentDisposition(value: string) {
  const nameMatch = value.match(/name="([^"]+)"/i);
  const filenameMatch = value.match(/filename="([^"]*)"/i);

  return {
    name: nameMatch?.[1] ?? null,
    filename: filenameMatch?.[1] ?? null
  };
}

async function parseMultipartRequest(request: Request) {
  const boundary = getMultipartBoundary(request.headers.get("content-type"));

  if (!boundary) {
    throw new Error("Invalid attachment upload");
  }

  const body = Buffer.from(await request.arrayBuffer());
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const fields = new Map<string, string>();
  const files: Array<{ filename: string; mimeType: string; bytes: Buffer }> = [];

  let cursor = body.indexOf(boundaryBuffer);

  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length;

    if (body[partStart] === 45 && body[partStart + 1] === 45) {
      break;
    }

    if (body[partStart] === 13 && body[partStart + 1] === 10) {
      partStart += 2;
    }

    const nextBoundary = body.indexOf(boundaryBuffer, partStart);

    if (nextBoundary === -1) {
      break;
    }

    let partEnd = nextBoundary;

    if (body[partEnd - 2] === 13 && body[partEnd - 1] === 10) {
      partEnd -= 2;
    }

    const part = body.slice(partStart, partEnd);
    const headerEnd = part.indexOf(headerSeparator);

    if (headerEnd === -1) {
      cursor = nextBoundary;
      continue;
    }

    const headersText = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + headerSeparator.length);
    const headers = new Map(
      headersText
        .split("\r\n")
        .map((line) => {
          const separatorIndex = line.indexOf(":");
          const key = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim().toLowerCase() : "";
          const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : "";
          return [key, value] as const;
        })
        .filter(([key]) => key)
    );
    const disposition = parseContentDisposition(headers.get("content-disposition") ?? "");

    if (disposition.name) {
      if (disposition.filename !== null) {
        files.push({
          filename: disposition.filename,
          mimeType: headers.get("content-type") ?? "application/octet-stream",
          bytes: content
        });
      } else {
        fields.set(disposition.name, content.toString("utf8"));
      }
    }

    cursor = nextBoundary;
  }

  return { fields, files };
}

export async function POST(request: Request) {
  const user = await requireUser(false);

  if (!user) {
    return badRequest("Authentication required", 401);
  }

  const multipart = await parseMultipartRequest(request);
  const parsed = formSchema.safeParse({
    conversationId: multipart.fields.get("conversationId")
  });

  if (!parsed.success) {
    return badRequest("Invalid attachment upload");
  }

  if (!getConversation(parsed.data.conversationId, user.id)) {
    return badRequest("Conversation not found", 404);
  }

  const files = multipart.files;

  if (!files.length) {
    return badRequest("No files were uploaded");
  }

  try {
    const attachments = createAttachments(
      parsed.data.conversationId,
      files
    );

    return ok({ attachments }, { status: 201 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to upload attachments");
  }
}
