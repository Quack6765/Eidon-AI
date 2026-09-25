import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBot, getBot } from "@/lib/bots";
import { createConversation, getConversation } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();

  return {
    ...actual,
    requireUser: requireUserMock
  };
});

describe("reliability route hardening", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("returns a client error for malformed multipart attachment uploads", async () => {
    const user = await createLocalUser({
      username: "malformed-upload-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(
      new Request("http://localhost/api/attachments", {
        method: "POST",
        headers: { "content-type": "multipart/form-data" },
        body: "not a multipart body"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid attachment upload"
    });
  });

  it("rejects attachment batches larger than the declared native limit", async () => {
    const user = await createLocalUser({
      username: "oversized-upload-batch-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Attachment batch", null, undefined, user.id);
    requireUserMock.mockResolvedValue(user);
    const formData = new FormData();
    formData.set("conversationId", conversation.id);
    for (let index = 0; index < 101; index += 1) {
      formData.append("files", new File(["x"], `file-${index}.txt`, { type: "text/plain" }));
    }

    const { POST } = await import("@/app/api/attachments/route");
    const response = await POST(new Request("http://localhost/api/attachments", {
      method: "POST",
      body: formData
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A maximum of 100 files may be uploaded at once"
    });
  });

  it("returns a client error when env-managed account credentials are updated", async () => {
    const auth = await import("@/lib/auth");
    await auth.ensureAdminBootstrap();
    const admin = await auth.findUserByUsername("admin");
    requireUserMock.mockResolvedValue(admin!.user);

    const { PUT } = await import("@/app/api/auth/account/route");
    const response = await PUT(
      new Request("http://localhost/api/auth/account", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "admin-renamed",
          password: "new-secret-123",
          currentPassword: "changeme123"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Env-managed credentials cannot be changed in the UI"
    });
  });

  it("returns not found when deleting a missing conversation id", async () => {
    const user = await createLocalUser({
      username: "delete-missing-conversation-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await DELETE(
      new Request("http://localhost/api/conversations/conv_missing", {
        method: "DELETE"
      }),
      { params: Promise.resolve({ conversationId: "conv_missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation not found"
    });
  });

  it("still reports success when deleting an existing conversation", async () => {
    const user = await createLocalUser({
      username: "delete-existing-conversation-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Delete me", null, undefined, user.id);
    requireUserMock.mockResolvedValue(user);

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/conversations/${conversation.id}`, {
        method: "DELETE"
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deleted: true
    });
  });

  it("preserves onlyIfEmpty delete semantics for nonempty conversations", async () => {
    const user = await createLocalUser({
      username: "delete-nonempty-conversation-user",
      password: "Password123!",
      role: "user"
    });
    const conversation = createConversation("Keep me", null, undefined, user.id);
    requireUserMock.mockResolvedValue(user);

    const { createMessage } = await import("@/lib/conversations");
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Do not delete this populated conversation"
    });

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await DELETE(
      new Request(`http://localhost/api/conversations/${conversation.id}?onlyIfEmpty=1`, {
        method: "DELETE"
      }),
      { params: Promise.resolve({ conversationId: conversation.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deleted: false
    });
  });

  it("refuses to delete a bot's home conversation and keeps the bot", async () => {
    const user = await createLocalUser({
      username: "delete-bot-thread-user",
      password: "Password123!",
      role: "user"
    });
    const bot = createBot({ name: "Protected" }, user.id);
    requireUserMock.mockResolvedValue(user);

    const { DELETE } = await import("@/app/api/conversations/[conversationId]/route");
    for (const query of ["", "?onlyIfEmpty=1"]) {
      const response = await DELETE(
        new Request(`http://localhost/api/conversations/${bot.homeConversationId}${query}`, {
          method: "DELETE"
        }),
        { params: Promise.resolve({ conversationId: bot.homeConversationId }) }
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "A bot's conversation can't be deleted on its own"
      });
    }
    expect(getBot(bot.id, user.id)).not.toBeNull();
  });

  it("refuses to make a bot's home conversation temporary", async () => {
    const user = await createLocalUser({
      username: "temporary-bot-thread-user",
      password: "Password123!",
      role: "user"
    });
    const bot = createBot({ name: "Persistent" }, user.id);
    requireUserMock.mockResolvedValue(user);

    const { PATCH } = await import("@/app/api/conversations/[conversationId]/route");
    const response = await PATCH(
      new Request(`http://localhost/api/conversations/${bot.homeConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTemporary: true })
      }),
      { params: Promise.resolve({ conversationId: bot.homeConversationId }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Only regular chats can be made temporary"
    });
    expect(getConversation(bot.homeConversationId, user.id)?.isTemporary).toBe(false);
  });
});
