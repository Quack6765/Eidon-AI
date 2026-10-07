import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import {
  bindAttachmentsToMessage,
  createAttachments,
  deleteAttachmentById,
  resolveAttachmentPath
} from "@/lib/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { tokenizeShellCommand } from "@/lib/shell-tokenizer";
import type { PromptImageContentPart } from "@/lib/types";

const MAX_INLINE_SCREENSHOT_EDGE = 8000;
const MAX_INLINE_SCREENSHOT_BYTES = 2 * 1024 * 1024;

export type ScreenshotCandidate = {
  sourcePath: string;
  preexisting: boolean;
};

export type AttachedScreenshot = {
  note: string;
  image?: PromptImageContentPart;
};

function parseStandaloneScreenshotPath(command: string) {
  if (/[$`<>\r\n]/.test(command)) {
    return null;
  }

  const tokens = tokenizeShellCommand(command);

  if (
    tokens.length < 3 ||
    tokens[0] !== "agent-browser" ||
    (tokens[1] ?? "").toLowerCase() !== "screenshot"
  ) {
    return null;
  }

  const sourcePath = tokens[2] ?? "";
  if (!path.isAbsolute(sourcePath)) {
    return null;
  }

  if (tokens.slice(3).some((token) => !token.startsWith("-"))) {
    return null;
  }

  return path.normalize(sourcePath);
}

export function prepareScreenshotArtifact(command: string): ScreenshotCandidate | null {
  const sourcePath = parseStandaloneScreenshotPath(command);
  if (!sourcePath) {
    return null;
  }

  try {
    fs.lstatSync(sourcePath);
    return { sourcePath, preexisting: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return null;
    }
  }

  return { sourcePath, preexisting: false };
}

function getVerifiedImageType(filename: string, bytes: Buffer) {
  const extension = path.extname(filename).toLowerCase();
  const isPng =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg =
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const gifHeader = bytes.subarray(0, 6).toString("ascii");
  const isGif = gifHeader === "GIF87a" || gifHeader === "GIF89a";
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";

  if (extension === ".png" && isPng) return "image/png";
  if ((extension === ".jpg" || extension === ".jpeg") && isJpeg) return "image/jpeg";
  if (extension === ".gif" && isGif) return "image/gif";
  if (extension === ".webp" && isWebp) return "image/webp";
  return null;
}

function readScreenshotArtifact(sourcePath: string) {
  let fileDescriptor: number | null = null;

  try {
    const pathStats = fs.lstatSync(sourcePath);
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) {
      return null;
    }

    fileDescriptor = fs.openSync(
      sourcePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    const stats = fs.fstatSync(fileDescriptor);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_ATTACHMENT_BYTES) {
      return null;
    }

    const bytes = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const bytesRead = fs.readSync(fileDescriptor, bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) {
        return null;
      }
      offset += bytesRead;
    }

    const filename = path.basename(sourcePath);
    const mimeType = getVerifiedImageType(filename, bytes);
    if (!mimeType) {
      return null;
    }

    return { filename, mimeType, bytes };
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== null) {
      fs.closeSync(fileDescriptor);
    }
  }
}

async function readImageSize(bytes: Buffer) {
  try {
    const { width = 0, height = 0 } = await sharp(bytes).metadata();
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

async function getInlineRefusal(bytes: Buffer) {
  const { width, height } = await readImageSize(bytes);
  if (!width || !height) {
    return "The screenshot could not be decoded, so it is not shown to you.";
  }

  if (
    width > MAX_INLINE_SCREENSHOT_EDGE ||
    height > MAX_INLINE_SCREENSHOT_EDGE ||
    bytes.length > MAX_INLINE_SCREENSHOT_BYTES
  ) {
    const megabytes = (bytes.length / (1024 * 1024)).toFixed(1);
    return `The screenshot is ${width}x${height} px (${megabytes} MB), too large to show to you. Take a viewport screenshot without --full to see the page.`;
  }

  return null;
}

export async function attachScreenshot(input: {
  candidate: ScreenshotCandidate;
  conversationId: string;
  assistantMessageId: string;
}): Promise<AttachedScreenshot | null> {
  if (input.candidate.preexisting) {
    return {
      note: `Screenshot not shown: ${input.candidate.sourcePath} existed before the command. Save each screenshot to a new path.`
    };
  }

  const artifact = readScreenshotArtifact(input.candidate.sourcePath);
  if (!artifact) {
    return null;
  }

  const unattached = { note: "The screenshot could not be attached." };
  let attachment;
  try {
    [attachment] = await createAttachments(input.conversationId, [artifact]);
  } catch {
    return unattached;
  }

  let storedPath: string;
  try {
    storedPath = resolveAttachmentPath(attachment);
    bindAttachmentsToMessage(input.conversationId, input.assistantMessageId, [attachment.id]);
  } catch {
    deleteAttachmentById(attachment.id);
    return unattached;
  }

  const note = `Screenshot attached as ${attachment.filename} (stored at ${storedPath}).`;
  const refusal = await getInlineRefusal(artifact.bytes);
  if (refusal) {
    return { note: `${note} ${refusal}` };
  }

  return {
    note,
    image: {
      type: "image",
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      relativePath: attachment.relativePath
    }
  };
}
