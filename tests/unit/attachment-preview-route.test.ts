import fs from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAttachments, resolveAttachmentPath } from "@/lib/attachments";
import { createConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("attachment preview route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    vi.restoreAllMocks();
  });

  it("returns text preview JSON for supported text attachment types accepted by uploads", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-csv-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Attachment csv preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "data.csv",
        mimeType: "text/csv",
        bytes: Buffer.from("name,value\npreview,1", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: attachment.id,
      filename: "data.csv",
      mimeType: "text/csv",
      content: "name,value\npreview,1"
    });
  });

  it("returns text preview JSON for supported text attachments", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Attachment preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Notes\nHello preview", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: attachment.id,
      filename: "notes.md",
      mimeType: "text/markdown",
      content: "# Notes\nHello preview"
    });
  });

  it("falls back to stored extracted text when the text attachment file is missing", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-missing-file-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Missing attachment file preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "fallback.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Missing file\nRecovered from extracted text", "utf8")
      }
    ]);
    const absolutePath = resolveAttachmentPath(attachment);

    fs.unlinkSync(absolutePath);
    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: attachment.id,
      filename: "fallback.md",
      mimeType: "text/markdown",
      content: "# Missing file\nRecovered from extracted text"
    });
  });

  it("returns empty text preview content when the stored fallback is empty and the file is missing", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-empty-fallback-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Empty fallback preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "blank.md",
        mimeType: "text/markdown",
        bytes: Buffer.from(" \n\t", "utf8")
      }
    ]);

    fs.unlinkSync(resolveAttachmentPath(attachment));
    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: attachment.id,
      filename: "blank.md",
      mimeType: "text/markdown",
      content: ""
    });
  });

  it("keeps text preview requests in text mode when preview reading fails unexpectedly", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-read-error-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Attachment preview read error", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "read-error.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Read error\nStill text", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);
    const attachmentsModule = await import("@/lib/attachments");
    vi.spyOn(attachmentsModule, "readAttachmentText").mockImplementation(() => {
      throw new Error("unexpected preview failure");
    });

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).not.toBe("text/markdown");
    await expect(response.text()).resolves.toContain("Internal server error");
  });

  it("rejects inline text preview for image attachments", async () => {
    const user = await createLocalUser({
      username: "attachment-preview-image-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Image preview", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "photo.png",
        mimeType: "image/png",
        bytes: Buffer.from("png-binary", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?format=text`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(415);
    await expect(response.text()).resolves.toContain("Attachment cannot be previewed as text");
  });

  it("keeps the default response path as raw attachment bytes", async () => {
    const user = await createLocalUser({
      username: "attachment-raw-response-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Raw attachment response", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Notes\nRaw body", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="notes.md"');
    await expect(response.text()).resolves.toBe("# Notes\nRaw body");
  });

  it("switches the binary response into download mode when requested", async () => {
    const user = await createLocalUser({
      username: "attachment-download-response-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Download attachment response", null, undefined, user.id);
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# Notes\nDownload body", "utf8")
      }
    ]);

    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/attachments/${attachment.id}?download=1`),
      { params: Promise.resolve({ attachmentId: attachment.id }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="notes.md"');
    await expect(response.text()).resolves.toBe("# Notes\nDownload body");
  });

  it("requires authentication for text preview access", async () => {
    requireUserMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/attachments/[attachmentId]/route");
    const response = await GET(new Request("http://localhost/api/attachments/att_missing?format=text"), {
      params: Promise.resolve({ attachmentId: "att_missing" })
    });

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toContain("Authentication required");
  });
});
