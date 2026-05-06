import { describe, expect, it } from "vitest";

import { assignAttachmentsToMessage, createAttachments } from "@/lib/attachments";
import {
  createConversation,
  createMessageAction,
  createMessageTextSegment,
  createMessage,
  disableConversationShare,
  enableConversationShare,
  getConversationShare,
  getSharedConversationSnapshot
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createLocalUser } from "@/lib/users";

describe("conversation sharing", () => {
  it("creates an opaque share token and resolves a public transcript", async () => {
    const user = await createLocalUser({
      username: "share-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Shareable thread", null, {}, user.id);
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Visible prompt"
    });
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Visible answer"
    });
    createMessage({
      conversationId: conversation.id,
      role: "system",
      content: "Hidden background instruction"
    });

    const share = enableConversationShare(conversation.id, user.id);

    expect(share).not.toBeNull();
    expect(share).toEqual({
      enabled: true,
      token: expect.stringMatching(/^[A-Za-z0-9_-]{32,}$/)
    });
    expect(share!.token).not.toContain(conversation.id);
    expect(getConversationShare(conversation.id, user.id)).toEqual(share);

    const snapshot = getSharedConversationSnapshot(share!.token);
    expect(snapshot?.conversation.title).toBe("Shareable thread");
    expect(snapshot?.conversation.shareEnabled).toBe(true);
    expect(snapshot?.conversation.shareToken).toBe(share!.token);
    expect(snapshot?.messages.map((message) => message.content)).toEqual([
      "Visible prompt",
      "Visible answer"
    ]);
    expect(snapshot?.queuedMessages).toEqual([]);
  });

  it("keeps attachments, thinking, tool actions, and timeline items in public snapshots", async () => {
    const user = await createLocalUser({
      username: "share-full-transcript-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Full public transcript", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Look at this"
    });
    const [attachment] = createAttachments(conversation.id, [
      {
        filename: "receipt.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("public attachment", "utf8")
      }
    ]);
    assignAttachmentsToMessage(conversation.id, userMessage.id, [attachment.id]);
    const assistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "I checked the file.",
      thinkingContent: "Need to inspect the uploaded text."
    });
    createMessageTextSegment({
      messageId: assistantMessage.id,
      content: "I checked ",
      sortOrder: 0
    });
    const action = createMessageAction({
      messageId: assistantMessage.id,
      kind: "mcp_tool_call",
      status: "completed",
      serverId: "filesystem",
      toolName: "read_file",
      label: "Read file",
      detail: "receipt.txt",
      resultSummary: "Read public attachment",
      sortOrder: 1
    });
    createMessageTextSegment({
      messageId: assistantMessage.id,
      content: "the file.",
      sortOrder: 2
    });

    const share = enableConversationShare(conversation.id, user.id);
    expect(share).not.toBeNull();

    const snapshot = getSharedConversationSnapshot(share!.token);
    const sharedUserMessage = snapshot?.messages.find((message) => message.id === userMessage.id);
    const sharedAssistantMessage = snapshot?.messages.find((message) => message.id === assistantMessage.id);

    expect(sharedUserMessage?.attachments).toEqual([
      expect.objectContaining({
        id: attachment.id,
        filename: "receipt.txt",
        extractedText: "public attachment"
      })
    ]);
    expect(sharedAssistantMessage).toEqual(
      expect.objectContaining({
        thinkingContent: "Need to inspect the uploaded text.",
        actions: [
          expect.objectContaining({
            id: action.id,
            label: "Read file",
            resultSummary: "Read public attachment"
          })
        ],
        timeline: [
          expect.objectContaining({ timelineKind: "text", content: "I checked " }),
          expect.objectContaining({ timelineKind: "action", id: action.id, label: "Read file" }),
          expect.objectContaining({ timelineKind: "text", content: "the file." })
        ]
      })
    );
  });

  it("invalidates the public link when sharing is disabled and rotates on re-enable", async () => {
    const user = await createLocalUser({
      username: "share-rotation-owner",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Rotating share", null, {}, user.id);
    createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Previously public"
    });

    const firstShare = enableConversationShare(conversation.id, user.id);
    expect(firstShare).not.toBeNull();
    disableConversationShare(conversation.id, user.id);

    expect(getConversationShare(conversation.id, user.id)).toEqual({
      enabled: false,
      token: null
    });
    expect(getSharedConversationSnapshot(firstShare!.token)).toBeNull();

    const secondShare = enableConversationShare(conversation.id, user.id);
    expect(secondShare).not.toBeNull();
    expect(secondShare!.token).not.toBe(firstShare!.token);
    expect(getSharedConversationSnapshot(secondShare!.token)?.conversation.id).toBe(conversation.id);
  });

  it("migrates share columns onto existing conversation tables", () => {
    const columns = getDb()
      .prepare("PRAGMA table_info(conversations)")
      .all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["share_token", "share_enabled", "shared_at"])
    );
  });

  it("returns null for share operations on conversations outside the owner scope", async () => {
    const owner = await createLocalUser({
      username: "share-owner-scope",
      password: "Password123!",
      role: "user"
    });
    const otherUser = await createLocalUser({
      username: "share-other-scope",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Scoped share", null, {}, owner.id);

    expect(getConversationShare(conversation.id, otherUser.id)).toBeNull();
    expect(enableConversationShare(conversation.id, otherUser.id)).toBeNull();
    expect(disableConversationShare(conversation.id, otherUser.id)).toBeNull();
  });
});
