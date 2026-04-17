import { randomBytes } from "node:crypto";
import path from "node:path";

import type { GenerateImageResult } from "./types";

const MIME_TYPE_EXTENSION_FALLBACKS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif"
};

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatTimestamp(now: Date) {
  return [
    now.getUTCFullYear().toString(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate())
  ].join("") + `-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

function resolveExtension(mimeType: string, originalFilename: string) {
  const originalExtension = path.extname(originalFilename).replace(/^\./, "").toLowerCase();
  if (originalExtension) {
    return originalExtension;
  }

  return MIME_TYPE_EXTENSION_FALLBACKS[mimeType.toLowerCase()] ?? "png";
}

export function renameGeneratedImages(
  images: GenerateImageResult["images"],
  input: { now?: Date; batchToken?: string } = {}
): GenerateImageResult["images"] {
  const now = input.now ?? new Date();
  const batchToken = input.batchToken ?? randomBytes(4).toString("hex");
  const timestamp = formatTimestamp(now);

  return images.map((image, index) => ({
    ...image,
    filename: `${timestamp}-${batchToken}-${index + 1}.${resolveExtension(image.mimeType, image.filename)}`
  }));
}
