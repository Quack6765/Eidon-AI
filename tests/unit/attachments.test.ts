import fs from "node:fs";
import path from "node:path";

import {
  createAttachments,
  deleteAttachmentById,
  getAttachment,
  getAttachmentDataUrl
} from "@/lib/attachments";
import { bindAttachmentsToMessage, createConversation, createMessage } from "@/lib/conversations";

describe("attachment helpers", () => {
  it("stores attachments on disk and returns metadata", () => {
    const conversation = createConversation();
    const [attachment] = createAttachments(conversation.id, [
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
      fs.existsSync(path.resolve(process.env.HERMES_DATA_DIR!, "attachments", attachment.relativePath))
    ).toBe(true);
  });

  it("builds data urls for image attachments", () => {
    const conversation = createConversation();
    const [attachment] = createAttachments(conversation.id, [
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

  it("deletes attachments even when the backing file is already missing", () => {
    const conversation = createConversation();
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("hello", "utf8")
      }
    ]);
    const absolutePath = path.resolve(process.env.HERMES_DATA_DIR!, "attachments", attachment.relativePath);

    fs.unlinkSync(absolutePath);

    expect(deleteAttachmentById(attachment.id)).toBe(true);
    expect(getAttachment(attachment.id)).toBeNull();
  });

  it("rejects unsupported file types", () => {
    const conversation = createConversation();

    expect(() =>
      createAttachments(conversation.id, [
        {
          filename: "archive.zip",
          mimeType: "application/zip",
          bytes: Buffer.from("zip", "utf8")
        }
      ])
    ).toThrow("Unsupported attachment type: archive.zip");
  });

  it("refuses to delete attachments that are already bound to a message", () => {
    const conversation = createConversation();
    const [attachment] = createAttachments(conversation.id, [
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
});
