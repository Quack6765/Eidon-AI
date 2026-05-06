import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation } from "@/lib/conversations";
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
          password: "new-secret-123"
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
});
