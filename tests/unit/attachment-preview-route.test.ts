import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAttachments } from "@/lib/attachments";
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
});
