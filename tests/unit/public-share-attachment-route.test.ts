import { describe, expect, it } from "vitest";

import { assignAttachmentsToMessage, createAttachments } from "@/lib/attachments";
import { createConversation, createMessage, enableConversationShare } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

describe("public shared attachment route", () => {
  it("returns text previews for attachments that belong to a shared transcript", async () => {
    const user = await createLocalUser({
      username: "public-share-attachment-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Shared attachment", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Attached"
    });
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("shared notes", "utf8")
      }
    ]);
    assignAttachmentsToMessage(conversation.id, message.id, [attachment.id]);
    const share = enableConversationShare(conversation.id, user.id);
    expect(share).not.toBeNull();

    const { GET } = await import("@/app/api/share/[shareToken]/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/share/${share!.token}/attachments/${attachment.id}?format=text`),
      {
        params: Promise.resolve({
          shareToken: share!.token,
          attachmentId: attachment.id
        })
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: attachment.id,
      filename: "notes.txt",
      mimeType: "text/plain",
      content: "shared notes"
    });
  });

  it("does not expose attachments outside the shared transcript", async () => {
    const user = await createLocalUser({
      username: "public-share-attachment-scope-owner",
      password: "Password123!",
      role: "user"
    });
    const sharedConversation = createConversation("Shared scope", null, {}, user.id);
    createMessage({
      conversationId: sharedConversation.id,
      role: "assistant",
      content: "Visible"
    });
    const privateConversation = createConversation("Private scope", null, {}, user.id);
    const [privateAttachment] = createAttachments(privateConversation.id, [
      {
        filename: "private.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("private notes", "utf8")
      }
    ]);
    const share = enableConversationShare(sharedConversation.id, user.id);
    expect(share).not.toBeNull();

    const { GET } = await import("@/app/api/share/[shareToken]/attachments/[attachmentId]/route");
    const response = await GET(
      new Request(`http://localhost/api/share/${share!.token}/attachments/${privateAttachment.id}?format=text`),
      {
        params: Promise.resolve({
          shareToken: share!.token,
          attachmentId: privateAttachment.id
        })
      }
    );

    expect(response.status).toBe(404);
  });
});
