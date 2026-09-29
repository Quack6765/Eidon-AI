import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import {
  createAttachments,
  getAttachment,
  normalizeStoredImageAttachments
} from "@/lib/attachments";
import { createConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import {
  normalizeImageBytes,
  sniffImageMimeType
} from "@/lib/image-normalization";

const FIXTURES_DIR = path.resolve("tests/fixtures/images");

function fixture(name: string) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

describe("sniffImageMimeType", () => {
  it.each([
    ["tiny.png", "image/png"],
    ["tiny.jpg", "image/jpeg"],
    ["tiny.webp", "image/webp"],
    ["tiny.gif", "image/gif"],
    ["tiny.heic", "image/heic"],
    ["tiny.avif", "image/avif"],
    ["tiny.bmp", "image/bmp"],
    ["tiny.tiff", "image/tiff"]
  ])("detects %s", (name, expected) => {
    expect(sniffImageMimeType(fixture(name))).toBe(expected);
  });

  it("returns null for non-image bytes", () => {
    expect(sniffImageMimeType(Buffer.from("plain text attachment body"))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(4))).toBeNull();
  });
});

describe("normalizeImageBytes", () => {
  it.each(["tiny.png", "tiny.jpg", "tiny.webp", "tiny.gif"])(
    "passes %s through byte-identically",
    async (name) => {
      const bytes = fixture(name);
      const normalized = await normalizeImageBytes(bytes);

      expect(normalized?.mimeType).toBe(sniffImageMimeType(bytes));
      expect(normalized?.bytes.equals(bytes)).toBe(true);
    }
  );

  it.each([
    ["tiny.heic", "image/heic"],
    ["tiny.bmp", "image/bmp"],
    ["tiny.tiff", "image/tiff"],
    ["tiny.avif", "image/avif"]
  ])("transcodes %s (%s) to decodable JPEG", async (name, _sniffed) => {
    const normalized = await normalizeImageBytes(fixture(name));

    expect(normalized?.mimeType).toBe("image/jpeg");
    expect(normalized?.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const metadata = await sharp(normalized!.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
  });

  it("returns null for non-image bytes", async () => {
    await expect(normalizeImageBytes(Buffer.from("not an image at all, just text"))).resolves.toBeNull();
  });
});

describe("image attachment ingest", () => {
  it("stores HEIC uploads as JPEG images and keeps the original filename", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "IMG_1234.HEIC",
        mimeType: "image/heic",
        bytes: fixture("tiny.heic")
      }
    ]);

    expect(attachment.kind).toBe("image");
    expect(attachment.mimeType).toBe("image/jpeg");
    expect(attachment.filename).toBe("IMG_1234.HEIC");

    const stored = fs.readFileSync(
      path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath)
    );
    const metadata = await sharp(stored).metadata();
    expect(metadata.format).toBe("jpeg");
  });

  it("normalizes HEIC bytes that arrive under a .jpg name", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "image.jpg",
        mimeType: "image/jpeg",
        bytes: fixture("tiny.heic")
      }
    ]);

    expect(attachment.kind).toBe("image");
    expect(attachment.mimeType).toBe("image/jpeg");
    const stored = fs.readFileSync(
      path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath)
    );
    expect((await sharp(stored).metadata()).format).toBe("jpeg");
  });

  it("keeps provider-safe images byte-identical", async () => {
    const conversation = createConversation();
    const bytes = fixture("tiny.png");
    const [attachment] = await createAttachments(conversation.id, [
      { filename: "tiny.png", mimeType: "image/png", bytes }
    ]);

    expect(attachment.kind).toBe("image");
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.byteSize).toBe(bytes.length);
    const stored = fs.readFileSync(
      path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath)
    );
    expect(stored.equals(bytes)).toBe(true);
  });
});

describe("normalizeStoredImageAttachments backfill", () => {
  it("reclassifies and transcodes legacy HEIC rows in place", async () => {
    const conversation = createConversation();
    const db = getDb();
    const id = "att_legacy_heic";
    const relativePath = path.join(conversation.id, `${id}_IMG_9.HEIC`);
    const absolutePath = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, fixture("tiny.heic"));
    db.prepare(
      `INSERT INTO message_attachments (
        id, conversation_id, message_id, filename, mime_type, byte_size, sha256,
        relative_path, kind, extracted_text, source_path, created_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ).run(
      id,
      conversation.id,
      "IMG_9.HEIC",
      "image/heic",
      10,
      "stale-hash",
      relativePath,
      "file",
      "",
      new Date().toISOString()
    );

    const result = await normalizeStoredImageAttachments();

    expect(result.normalized).toBeGreaterThanOrEqual(1);
    expect(result.transcoded).toBeGreaterThanOrEqual(1);
    const row = getDb()
      .prepare("SELECT kind, mime_type, byte_size, sha256 FROM message_attachments WHERE id = ?")
      .get(id) as { kind: string; mime_type: string; byte_size: number; sha256: string };
    expect(row.kind).toBe("image");
    expect(row.mime_type).toBe("image/jpeg");

    const stored = fs.readFileSync(absolutePath);
    expect(row.byte_size).toBe(stored.length);
    expect((await sharp(stored).metadata()).format).toBe("jpeg");

    const second = await normalizeStoredImageAttachments();
    expect(second.normalized).toBe(0);
    expect(second.transcoded).toBe(0);
    expect(getAttachment(id)?.kind).toBe("image");
  });
});
