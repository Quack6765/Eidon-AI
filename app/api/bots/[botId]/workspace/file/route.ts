import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { z } from "zod";

import { extractFileText, normalizeAttachmentKind } from "@/lib/attachments";
import { buildFileResponse } from "@/lib/attachment-response";
import { requireUser } from "@/lib/auth";
import { getBot } from "@/lib/bots";
import { resolveBotWorkspaceFile } from "@/lib/bot-sandbox";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { badRequest, parseRouteParams } from "@/lib/http";

const paramsSchema = z.object({
  botId: z.string().min(1)
});

const querySchema = z.object({
  path: z.string().min(1).max(4096),
  scope: z.enum(["bot", "shared"]).default("bot"),
  format: z.enum(["text"]).optional(),
  download: z.enum(["0", "1"]).optional()
});

export async function GET(
  request: Request,
  context: { params: Promise<{ botId: string }> }
) {
  const user = await requireUser(false);
  if (!user) {
    return badRequest("Authentication required", 401);
  }

  const params = await parseRouteParams(context, paramsSchema, "bot id");
  if (params instanceof NextResponse) return params;

  const bot = getBot(params.botId, user.id);
  if (!bot) {
    return badRequest("Bot not found", 404);
  }

  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    return badRequest("Invalid workspace file request");
  }

  const filePath = resolveBotWorkspaceFile(bot, query.data.scope, query.data.path);
  if (!filePath) {
    return badRequest("Workspace file not found", 404);
  }

  const filename = path.basename(filePath);
  const { kind, mimeType } = normalizeAttachmentKind(filename, "");

  let descriptor: number;
  let byteSize: number;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) {
      fs.closeSync(descriptor);
      return badRequest("Workspace file not found", 404);
    }
    byteSize = stats.size;
  } catch {
    return badRequest("Workspace file not found", 404);
  }

  if (query.data.format === "text") {
    try {
      if (kind !== "text" || byteSize > MAX_ATTACHMENT_BYTES) {
        return badRequest("Workspace file cannot be previewed as text", 415);
      }
      const content = await extractFileText(fs.readFileSync(descriptor), filename);
      return Response.json({ filename, mimeType, content });
    } catch {
      return badRequest("Internal server error", 500);
    } finally {
      fs.closeSync(descriptor);
    }
  }

  const stream = fs.createReadStream(filePath, { fd: descriptor, autoClose: true });
  return buildFileResponse(
    { filename, mimeType, kind, byteSize },
    Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    query.data.download === "1"
  );
}
