import { describe, expect, it } from "vitest";

import { bindAttachmentsToMessage, createAttachments } from "@/lib/attachments";
import { createConversation, createMessage, createMessageAction, enableConversationShare } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

describe("public shared conversation route", () => {
  it("returns a sanitized shared view without requiring auth", async () => {
    const user = await createLocalUser({
      username: "public-share-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Public route", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Public answer",
      thinkingContent: "Private reasoning trace"
    });
    createMessageAction({
      messageId: message.id,
      kind: "mcp_tool_call",
      status: "completed",
      serverId: "filesystem",
      toolName: "run_shell",
      label: "Run shell",
      detail: "whoami",
      arguments: { command: "whoami" },
      resultSummary: "internal-hostname",
      sortOrder: 0
    });
    const attachmentBody = "secret attachment body";
    const [attachment] = await createAttachments(conversation.id, [
      {
        filename: "notes.txt",
        mimeType: "text/plain",
        bytes: Buffer.from(attachmentBody, "utf8")
      }
    ]);
    bindAttachmentsToMessage(conversation.id, message.id, [attachment.id]);
    const share = enableConversationShare(conversation.id, user.id);
    expect(share).not.toBeNull();

    const { GET } = await import("@/app/api/share/[shareToken]/route");
    const response = await GET(new Request(`http://localhost/api/share/${share!.token}`), {
      params: Promise.resolve({ shareToken: share!.token })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(["conversation", "messages"]);
    expect(payload.conversation).toEqual({
      id: conversation.id,
      title: "Public route",
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    });
    expect(payload.messages).toEqual([
      {
        id: message.id,
        role: "assistant",
        content: "Public answer",
        status: expect.any(String),
        createdAt: expect.any(String),
        textSegments: [],
        attachments: [
          {
            id: attachment.id,
            filename: "notes.txt",
            mimeType: "text/plain",
            kind: "text",
            byteSize: Buffer.byteLength(attachmentBody, "utf8"),
            createdAt: expect.any(String)
          }
        ]
      }
    ]);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("queuedMessages");
    expect(serialized).not.toContain("thinkingContent");
    expect(serialized).not.toContain("Private reasoning trace");
    expect(serialized).not.toContain("actions");
    expect(serialized).not.toContain("resultSummary");
    expect(serialized).not.toContain("internal-hostname");
    expect(serialized).not.toContain("timeline");
    expect(serialized).not.toContain("relativePath");
    expect(serialized).not.toContain("sha256");
    expect(serialized).not.toContain("extractedText");
    expect(serialized).not.toContain(attachmentBody);
  });

  it("returns not found for disabled or malformed share tokens", async () => {
    const user = await createLocalUser({
      username: "public-share-disabled-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Disabled public route", null, {}, user.id);
    const share = enableConversationShare(conversation.id, user.id);
    expect(share).not.toBeNull();

    const { disableConversationShare } = await import("@/lib/conversations");
    disableConversationShare(conversation.id, user.id);

    const { GET } = await import("@/app/api/share/[shareToken]/route");
    const disabled = await GET(new Request(`http://localhost/api/share/${share!.token}`), {
      params: Promise.resolve({ shareToken: share!.token })
    });
    expect(disabled.status).toBe(404);

    const malformed = await GET(new Request("http://localhost/api/share/short"), {
      params: Promise.resolve({ shareToken: "short" })
    });
    expect(malformed.status).toBe(404);
  });
});
