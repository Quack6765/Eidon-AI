import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

import {
  bindAttachmentsToMessage,
  createAttachments,
  deleteAttachmentById,
  getAttachment,
  getAttachmentDataUrl,
  importAttachmentFromLocalFile,
  resolveAbsoluteImagePathPart
} from "@/lib/attachments";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { createConversation, createMessage } from "@/lib/conversations";
import { getDb, resetDbForTests } from "@/lib/db";
import { bootstrapRuntimeState, resetRuntimeBootstrapForTests } from "@/lib/runtime-bootstrap";
import { removeOrphanedAttachmentFiles } from "@/lib/attachment-storage-recovery";
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

  it("resolves absolute image paths inside attachment storage", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "photo.png",
        mimeType: "image/png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
      }
    ]);

    const absolutePath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      attachment.relativePath
    );
    const part = resolveAbsoluteImagePathPart(absolutePath, { conversationId: conversation.id });

    expect(part.type).toBe("image");
    expect(part.mimeType).toBe("image/png");
    expect(part.filename).toBe(`${attachment.id}_${attachment.filename}`);
    expect(part.relativePath).toBe(attachment.relativePath);
    expect(part.attachmentId).toBe(attachment.id);

    const outsidePath = path.resolve(process.env.EIDON_DATA_DIR!, "outside.png");
    fs.writeFileSync(outsidePath, "png-bytes");
    expect(() =>
      resolveAbsoluteImagePathPart(outsidePath, { conversationId: conversation.id })
    ).toThrow("outside attachment storage");
    expect(() =>
      resolveAbsoluteImagePathPart(
        path.resolve(absolutePath, "..", "..", "..", "outside.png"),
        { conversationId: conversation.id }
      )
    ).toThrow("outside attachment storage");
    fs.unlinkSync(outsidePath);
  });

  it("rejects image paths that belong to a different conversation", async () => {
    const conversation = createConversation();
    const otherConversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "photo.png",
        mimeType: "image/png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
      }
    ]);
    const [otherAttachment] = await createAttachments(otherConversation.id, [
      {
        filename: "secret.png",
        mimeType: "image/png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
      }
    ]);

    const absolutePath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      attachment.relativePath
    );
    const otherAbsolutePath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      otherAttachment.relativePath
    );

    const part = resolveAbsoluteImagePathPart(absolutePath, { conversationId: conversation.id });
    expect(part.relativePath).toBe(attachment.relativePath);
    expect(() =>
      resolveAbsoluteImagePathPart(otherAbsolutePath, { conversationId: conversation.id })
    ).toThrow("Image path belongs to a different conversation");
  });

  it("rejects non-image and missing files for image analysis", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      { filename: "notes.md", mimeType: "text/markdown", bytes: Buffer.from("hello") }
    ]);

    const textPath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      attachment.relativePath
    );
    expect(() =>
      resolveAbsoluteImagePathPart(textPath, { conversationId: conversation.id })
    ).toThrow("Unsupported image type");

    const missingPath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      conversation.id,
      "missing.png"
    );
    expect(() =>
      resolveAbsoluteImagePathPart(missingPath, { conversationId: conversation.id })
    ).toThrow("does not exist");
  });

  it("fsyncs a temporary file before atomic publication and syncs its directory and root", async () => {
    const conversation = createConversation();
    const openSpy = vi.spyOn(fs, "openSync");
    const fsyncSpy = vi.spyOn(fs, "fsyncSync");
    const renameSpy = vi.spyOn(fs, "renameSync");

    try {
      const [attachment] = await createAttachments(conversation.id, [
        {
          filename: "durable.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("durable bytes", "utf8")
        }
      ]);

      expect(fsyncSpy).toHaveBeenCalledTimes(3);
      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(fsyncSpy.mock.invocationCallOrder[0]).toBeLessThan(
        renameSpy.mock.invocationCallOrder[0]
      );
      expect(renameSpy.mock.invocationCallOrder[0]).toBeLessThan(
        fsyncSpy.mock.invocationCallOrder[1]
      );
      expect(fsyncSpy.mock.invocationCallOrder[1]).toBeLessThan(
        fsyncSpy.mock.invocationCallOrder[2]
      );
      const [tempPath, finalPath] = renameSpy.mock.calls[0];
      expect(path.dirname(String(tempPath))).toBe(path.dirname(String(finalPath)));
      expect(String(tempPath)).toContain(".tmp-");
      expect(openSpy.mock.calls[1]?.[0]).toBe(path.dirname(String(finalPath)));
      expect(openSpy.mock.calls[2]?.[0]).toBe(
        path.resolve(process.env.EIDON_DATA_DIR!, "attachments")
      );
      expect(getAttachment(attachment.id)).not.toBeNull();
      expect(fs.readFileSync(String(finalPath), "utf8")).toBe("durable bytes");
    } finally {
      openSpy.mockRestore();
      fsyncSpy.mockRestore();
      renameSpy.mockRestore();
    }
  });

  it("removes partial temporary and final artifacts when a write throws", async () => {
    const conversation = createConversation();
    const originalWriteSync = fs.writeSync.bind(fs);
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(((target) => {
      if (typeof target === "number") {
        originalWriteSync(target, Buffer.from("partial", "utf8"));
      }
      throw Object.assign(new Error("disk write failed"), { code: "EIO" });
    }) as typeof fs.writeFileSync);

    try {
      await expect(
        createAttachments(conversation.id, [
          {
            filename: "partial.txt",
            mimeType: "text/plain",
            bytes: Buffer.from("complete payload", "utf8")
          }
        ])
      ).rejects.toThrow("disk write failed");
    } finally {
      writeSpy.mockRestore();
    }

    const attachmentDir = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      conversation.id
    );
    expect(fs.existsSync(attachmentDir)).toBe(false);
    expect(
      getDb()
        .prepare("SELECT COUNT(*) AS count FROM message_attachments WHERE conversation_id = ?")
        .get(conversation.id)
    ).toEqual({ count: 0 });
  });

  it("rejects publication through a symlinked conversation directory", async () => {
    const conversation = createConversation();
    const attachmentsRoot = path.resolve(process.env.EIDON_DATA_DIR!, "attachments");
    const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-outside-"));
    fs.mkdirSync(attachmentsRoot, { recursive: true });
    fs.symlinkSync(outsideDirectory, path.join(attachmentsRoot, conversation.id), "dir");

    try {
      await expect(createAttachments(conversation.id, [{
        filename: "escape.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("must stay inside", "utf8")
      }])).rejects.toThrow("unsafe directory link");
      expect(fs.readdirSync(outsideDirectory)).toEqual([]);
      expect(
        getDb()
          .prepare("SELECT COUNT(*) AS count FROM message_attachments WHERE conversation_id = ?")
          .get(conversation.id)
      ).toEqual({ count: 0 });
    } finally {
      fs.rmSync(outsideDirectory, { recursive: true, force: true });
    }
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
    const [attachment] = await createAttachments(conversation.id, [
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
      createAttachments(conversation.id, [
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

  it("commits deletion before file cleanup and removes the orphan on restart", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "orphan.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("cleanup after restart", "utf8")
      }
    ]);
    const absolutePath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      attachment.relativePath
    );
    const unlinkSpy = vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });

    expect(deleteAttachmentById(attachment.id)).toBe(true);
    expect(getAttachment(attachment.id)).toBeNull();
    expect(fs.existsSync(absolutePath)).toBe(true);

    unlinkSpy.mockRestore();
    resetDbForTests();
    getDb();
    resetRuntimeBootstrapForTests();
    bootstrapRuntimeState();

    expect(fs.existsSync(absolutePath)).toBe(false);
  });

  it("removes crash-temporary and unreferenced artifacts without touching valid files", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "valid.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("valid", "utf8")
      }
    ]);
    const validPath = path.resolve(
      process.env.EIDON_DATA_DIR!,
      "attachments",
      attachment.relativePath
    );
    const tempPath = `${validPath}.tmp-crash`;
    const orphanPath = path.resolve(path.dirname(validPath), "unreferenced.bin");
    fs.writeFileSync(tempPath, "partial", "utf8");
    fs.writeFileSync(orphanPath, "orphan", "utf8");
    const openSpy = vi.spyOn(fs, "openSync");

    let result: ReturnType<typeof removeOrphanedAttachmentFiles> | null = null;
    let validationOpen: Parameters<typeof fs.openSync> | undefined;
    try {
      result = removeOrphanedAttachmentFiles(
        getDb(),
        process.env.EIDON_DATA_DIR!
      );
      validationOpen = openSpy.mock.calls.find((call) => call[0] === validPath);
    } finally {
      openSpy.mockRestore();
    }

    expect(result).toEqual({ invalidRecords: 0, removedArtifacts: 2 });
    expect(validationOpen).toBeDefined();
    if (typeof fs.constants.O_NOFOLLOW === "number") {
      expect(Number(validationOpen?.[1]) & fs.constants.O_NOFOLLOW).toBe(
        fs.constants.O_NOFOLLOW
      );
    }
    expect(fs.existsSync(validPath)).toBe(true);
    expect(fs.existsSync(tempPath)).toBe(false);
    expect(fs.existsSync(orphanPath)).toBe(false);
    expect(getAttachment(attachment.id)).not.toBeNull();
  });

  it("removes database records for missing, truncated, corrupt, and non-regular files", async () => {
    const conversation = createConversation();
    const attachments = await createAttachments(
      conversation.id,
      [
        ["missing.txt", "missing bytes"],
        ["truncated.txt", "truncate these bytes"],
        ["corrupt.txt", "original bytes"],
        ["directory.txt", "must be a file"]
      ].map(([filename, content]) => ({
        filename,
        mimeType: "text/plain",
        bytes: Buffer.from(content, "utf8")
      }))
    );
    const absolutePaths = attachments.map((attachment) =>
      path.resolve(
        process.env.EIDON_DATA_DIR!,
        "attachments",
        attachment.relativePath
      )
    );
    fs.unlinkSync(absolutePaths[0]);
    fs.writeFileSync(absolutePaths[1], "short", "utf8");
    fs.writeFileSync(absolutePaths[2], Buffer.alloc(attachments[2].byteSize, 0x78));
    fs.unlinkSync(absolutePaths[3]);
    fs.mkdirSync(absolutePaths[3]);

    const result = removeOrphanedAttachmentFiles(
      getDb(),
      process.env.EIDON_DATA_DIR!
    );

    expect(result.invalidRecords).toBe(4);
    for (const attachment of attachments) {
      expect(getAttachment(attachment.id)).toBeNull();
    }
    for (const absolutePath of absolutePaths) {
      expect(fs.existsSync(absolutePath)).toBe(false);
    }
  });

  it("invalidates rows behind symlinked parents without traversing outside storage", async () => {
    const conversation = createConversation();
    const [attachment] = await createAttachments(conversation.id, [{
      filename: "outside.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("outside remains", "utf8")
    }]);
    const attachmentsRoot = path.resolve(process.env.EIDON_DATA_DIR!, "attachments");
    const conversationDirectory = path.join(attachmentsRoot, conversation.id);
    const outsideParent = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-recovery-outside-"));
    const outsideDirectory = path.join(outsideParent, "conversation");
    fs.renameSync(conversationDirectory, outsideDirectory);
    fs.symlinkSync(outsideDirectory, conversationDirectory, "dir");
    const outsideFile = path.join(outsideDirectory, path.basename(attachment.relativePath));

    try {
      expect(removeOrphanedAttachmentFiles(getDb(), process.env.EIDON_DATA_DIR!)).toEqual({
        invalidRecords: 1,
        removedArtifacts: 1
      });
      expect(getAttachment(attachment.id)).toBeNull();
      expect(fs.existsSync(conversationDirectory)).toBe(false);
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside remains");
    } finally {
      fs.rmSync(outsideParent, { recursive: true, force: true });
    }
  });

  it("stores unknown file types as file-kind attachments without extraction", async () => {
    const conversation = createConversation();
    const zipBytes = Buffer.from("zip", "utf8");

    const [attachment, noExtensionAttachment] = await createAttachments(conversation.id, [
      {
        filename: "archive.zip",
        mimeType: "application/zip",
        bytes: zipBytes
      },
      {
        filename: "payload",
        mimeType: "",
        bytes: Buffer.from("mystery", "utf8")
      }
    ]);

    expect(attachment.kind).toBe("file");
    expect(attachment.mimeType).toBe("application/zip");
    expect(attachment.extractedText).toBe("");
    expect(
      fs.readFileSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments", attachment.relativePath))
    ).toEqual(zipBytes);

    expect(noExtensionAttachment.kind).toBe("file");
    expect(noExtensionAttachment.mimeType).toBe("application/octet-stream");
    expect(noExtensionAttachment.extractedText).toBe("");
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

  it("imports a local binary file as a file-kind attachment", async () => {
    const conversation = createConversation();
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "eidon-attachment-import-"));
    const sourcePath = path.join(sourceDir, "archive.zip");

    try {
      fs.writeFileSync(sourcePath, Buffer.from("zip", "utf8"));

      const attachment = await importAttachmentFromLocalFile(conversation.id, sourcePath);

      expect(attachment.filename).toBe("archive.zip");
      expect(attachment.kind).toBe("file");
      expect(attachment.mimeType).toBe("application/octet-stream");
      expect(attachment.extractedText).toBe("");
      expect(getAttachment(attachment.id)?.kind).toBe("file");
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
