import bmp from "bmp-js";
import heicDecode from "heic-decode";
import sharp from "sharp";

export const MAX_NORMALIZED_IMAGE_EDGE = 2048;
export const NORMALIZED_JPEG_QUALITY = 85;

const PROVIDER_SAFE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

const HEIF_BRANDS_MOSTLY_AV1 = new Set(["avif", "avis"]);
const HEIF_BRANDS_MOSTLY_HEVC = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs"
]);

export function isProviderSafeImageMimeType(mimeType: string) {
  return PROVIDER_SAFE_IMAGE_MIME_TYPES.has(mimeType);
}

export function sniffImageMimeType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  const headAscii = bytes.subarray(0, 8).toString("latin1");

  if (headAscii.startsWith("GIF87a") || headAscii.startsWith("GIF89a")) {
    return "image/gif";
  }

  if (headAscii.startsWith("RIFF") && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }

  if (headAscii.startsWith("BM")) {
    return "image/bmp";
  }

  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return "image/tiff";
  }

  if (bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (HEIF_BRANDS_MOSTLY_AV1.has(brand)) return "image/avif";
    if (HEIF_BRANDS_MOSTLY_HEVC.has(brand)) return "image/heic";
    return "image/heif";
  }

  return null;
}

function transcodeRawToJpeg(rgba: Buffer, width: number, height: number) {
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize({
      width: MAX_NORMALIZED_IMAGE_EDGE,
      height: MAX_NORMALIZED_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: NORMALIZED_JPEG_QUALITY })
    .toBuffer();
}

function transcodeWithSharp(bytes: Buffer) {
  return sharp(bytes)
    .rotate()
    .resize({
      width: MAX_NORMALIZED_IMAGE_EDGE,
      height: MAX_NORMALIZED_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true
    })
    .jpeg({ quality: NORMALIZED_JPEG_QUALITY })
    .toBuffer();
}

function abgrToRgba(source: Buffer) {
  const rgba = Buffer.allocUnsafe(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    rgba[offset] = source[offset + 3];
    rgba[offset + 1] = source[offset + 2];
    rgba[offset + 2] = source[offset + 1];
    rgba[offset + 3] = source[offset];
  }
  return rgba;
}

export type NormalizedImageBytes = {
  bytes: Buffer;
  mimeType: string;
};

export async function normalizeImageBytes(bytes: Buffer): Promise<NormalizedImageBytes | null> {
  const sniffed = sniffImageMimeType(bytes);
  if (!sniffed) return null;

  if (isProviderSafeImageMimeType(sniffed)) {
    return { bytes, mimeType: sniffed };
  }

  try {
    if (sniffed === "image/bmp") {
      const decoded = bmp.decode(bytes);
      return {
        bytes: await transcodeRawToJpeg(abgrToRgba(decoded.data), decoded.width, decoded.height),
        mimeType: "image/jpeg"
      };
    }

    if (sniffed === "image/heic" || sniffed === "image/heif") {
      try {
        return { bytes: await transcodeWithSharp(bytes), mimeType: "image/jpeg" };
      } catch {
        const decoded = await heicDecode({ buffer: bytes });
        return {
          bytes: await transcodeRawToJpeg(
            Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
            decoded.width,
            decoded.height
          ),
          mimeType: "image/jpeg"
        };
      }
    }

    return { bytes: await transcodeWithSharp(bytes), mimeType: "image/jpeg" };
  } catch (error) {
    console.error("Image bytes could not be normalized:", error);
    return null;
  }
}
