import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

import {
  createAttachments,
  createAttachmentsFromBytes,
  deleteAttachmentById,
  getAttachment,
  getAttachmentDataUrl,
  importAttachmentFromLocalFile
} from "@/lib/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { bindAttachmentsToMessage, createConversation, createMessage } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

function createMinimalPdfBuffer(): Buffer {
  const content = `%PDF-1.0
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
190
%%EOF`;
  return Buffer.from(content, "utf8");
}

describe("attachment helpers", () => {
  it("stores attachments on disk and returns metadata", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "notes.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Notes\nHello world", "utf8")
      }
    ]);

    expect(attachment.kind).toBe("text");
    expect(attachment.extractedText).toContain("Hello world");
    expect(getAttachment(attachment.id)?.filename).toBe("notes.md");
    expect(
      fs.existsSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath))
    ).toBe(true);
  });

  it("scopes attachments to the requested user", async () => {
    const userA = await createLocalUser({
      username: "attachment-owner-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "attachment-owner-b",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Scoped attachment chat", null, undefined, userA.id);
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "private.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("private", "utf8")
      }
    ]);

    expect(getAttachment(attachment.id, userA.id)?.filename).toBe("private.txt");
    expect(getAttachment(attachment.id, userB.id)).toBeNull();
    expect(deleteAttachmentById(attachment.id, { userId: userB.id })).toBe(false);
  });

  it("builds data urls for image attachments", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "pixel.png",
        mimeType: "image/png",
        bytes: Buffer.from("png-binary", "utf8")
      }
    ]);

    expect(getAttachmentDataUrl(attachment)).toBe(
      `data:image/png;base64,${Buffer.from("png-binary", "utf8").toString("base64")}`
    );
  });

  it("creates an attachment from decoded in-memory bytes", async () => {
    const conversation = createConversation();
    const imageBytes = Buffer.from("decoded-image-bytes", "utf8");
    const [attachment] = await createAttachmentsFromBytes(conversation.id, [
      {
        filename: "generated.png",
        mimeType: "image/png",
        bytes: imageBytes
      }
    ]);

    expect(attachment.filename).toBe("generated.png");
    expect(attachment.kind).toBe("image");
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.extractedText).toBe("");
    expect(
      fs.readFileSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath))
    ).toEqual(imageBytes);
  });

  it("rejects oversized in-memory attachments", async () => {
    const conversation = createConversation();

    await expect(
      createAttachmentsFromBytes(conversation.id, [
        {
          filename: "generated.png",
          mimeType: "image/png",
          bytes: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61)
        }
      ])
    ).rejects.toThrow(`Attachment exceeds ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB: generated.png`);
  });

  it("deletes attachments even when the backing file is already missing", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("hello", "utf8")
      }
    ]);
    const absolutePath = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath);

    fs.unlinkSync(absolutePath);

    expect(deleteAttachmentById(attachment.id)).toBe(true);
    expect(getAttachment(attachment.id)).toBeNull();
  });

  it("rejects unsupported file types", async () => {
    const conversation = createConversation();

    await expect(
      createAttachments(conversation.id, [
        {
          filename: "archive.zip",
          mimeType: "application/zip",
          bytes: Buffer.from("zip", "utf8")
        }
      ])
    ).rejects.toThrow("Unsupported attachment type: archive.zip");
  });

  it("imports a local text file into managed attachment storage", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-import-"));
    const sourcePath = path.join(sourceDir, "local-notes.md");
    const content = "# Notes\nHello from local storage";

    try {
      fs.writeFileSync(sourcePath, content, "utf8");

      const attachment = await importAttachmentFromLocalFile(conversation.id, sourcePath);

      expect(attachment.filename).toBe("local-notes.md");
      expect(attachment.kind).toBe("text");
      expect(attachment.extractedText).toContain("Hello from local storage");
      expect(fs.readFileSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath), "utf8")).toBe(
        content
      );
      expect(getAttachment(attachment.id)?.filename).toBe("local-notes.md");
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("rejects oversized local files before loading bytes", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-import-"));
    const sourcePath = path.join(sourceDir, "huge.txt");
    fs.writeFileSync(sourcePath, "tiny", "utf8");
    const baseStats = fs.lstatSync(sourcePath);
    const lstatSpy = vi.spyOn(fs, "lstatSync");
    const fstatSpy = vi.spyOn(fs, "fstatSync");
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("readFileSync should not be called for oversized files");
    });

    try {
      lstatSpy.mockReturnValue({
        ...baseStats,
        isFile: () => true,
        size: MAX_ATTACHMENT_BYTES + 1
      } as fs.Stats);
      fstatSpy.mockReturnValue({
        ...baseStats,
        isFile: () => true,
        size: MAX_ATTACHMENT_BYTES + 1
      } as fs.Stats);

      await expect(importAttachmentFromLocalFile(conversation.id, sourcePath)).rejects.toThrow(
        `Attachment exceeds ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB: huge.txt`
      );
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("caps local file reads at the attachment byte limit", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-import-"));
    const sourcePath = path.join(sourceDir, "growing.txt");
    fs.writeFileSync(sourcePath, "tiny", "utf8");
    const baseStats = fs.lstatSync(sourcePath);
    const lstatSpy = vi.spyOn(fs, "lstatSync");
    const fstatSpy = vi.spyOn(fs, "fstatSync");
    const readSpy = vi.spyOn(fs, "readSync");
    let servedBytes = 0;

    try {
      lstatSpy.mockReturnValue({
        ...baseStats,
        isFile: () => true,
        size: 1
      } as fs.Stats);
      fstatSpy.mockReturnValue({
        ...baseStats,
        isFile: () => true,
        size: 1
      } as fs.Stats);
      readSpy.mockImplementation(((
        fd: number,
        buffer: ArrayBufferView,
        offsetOrOptions?: number | object | null,
        length?: number,
        position?: number | bigint | null
      ) => {
        if (typeof offsetOrOptions !== "number" || typeof length !== "number") {
          throw new Error("Unexpected fs.readSync options overload");
        }

        const remainingBytes = MAX_ATTACHMENT_BYTES + 1 - servedBytes;

        if (remainingBytes <= 0) {
          return 0;
        }

        const bytesToServe = Math.min(length, remainingBytes);
        const targetBuffer = Buffer.isBuffer(buffer)
          ? buffer
          : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        Buffer.alloc(bytesToServe, 0x61).copy(targetBuffer, offsetOrOptions, 0, bytesToServe);
        servedBytes += bytesToServe;
        return bytesToServe;
      }) as typeof fs.readSync);

      await expect(importAttachmentFromLocalFile(conversation.id, sourcePath)).rejects.toThrow(
        `Attachment exceeds ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB: growing.txt`
      );
      expect(servedBytes).toBe(MAX_ATTACHMENT_BYTES + 1);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("rejects unsupported local file types", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-import-"));
    const sourcePath = path.join(sourceDir, "archive.zip");

    try {
      fs.writeFileSync(sourcePath, Buffer.from("zip", "utf8"));

      await expect(importAttachmentFromLocalFile(conversation.id, sourcePath)).rejects.toThrow(
        "Unsupported attachment type: archive.zip"
      );
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("rejects non-regular local file paths", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-import-"));

    try {
      await expect(importAttachmentFromLocalFile(conversation.id, sourceDir)).rejects.toThrow(
        `Source path is not a regular file: ${sourceDir}`
      );
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("refuses to delete attachments that are already bound to a message", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("hello", "utf8")
      }
    ]);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Attached"
    });

    bindAttachmentsToMessage(conversation.id, message.id, [attachment.id]);

    expect(() => deleteAttachmentById(attachment.id)).toThrow(
      "Attachment is already attached to a message"
    );
    expect(deleteAttachmentById(attachment.id, { allowAssigned: true })).toBe(true);
  });

  it("extracts text from PDF attachments", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "document.pdf",
        mimeType: "application/pdf",
        bytes: createMinimalPdfBuffer()
      }
    ]);

    expect(attachment.kind).toBe("text");
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.extractedText).toBeDefined();
    expect(typeof attachment.extractedText).toBe("string");
    expect(
      fs.existsSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath))
    ).toBe(true);
  });

  it("handles corrupted PDF gracefully with empty extracted text", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "corrupted.pdf",
        mimeType: "application/pdf",
        bytes: Buffer.from("not a real pdf content at all")
      }
    ]);

    expect(attachment.kind).toBe("text");
    expect(attachment.extractedText).toBe("");
  });

  it("imports a local PDF file and extracts text", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-pdf-import-"));
    const sourcePath = path.join(sourceDir, "report.pdf");

    try {
      fs.writeFileSync(sourcePath, createMinimalPdfBuffer());

      const attachment = await importAttachmentFromLocalFile(conversation.id, sourcePath);

      expect(attachment.filename).toBe("report.pdf");
      expect(attachment.kind).toBe("text");
      expect(attachment.mimeType).toBe("application/pdf");
      expect(attachment.extractedText).toBeDefined();
      expect(typeof attachment.extractedText).toBe("string");
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});
