import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, getMessage } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

const { startManipulationTurnMock } = vi.hoisted(() => ({
  startManipulationTurnMock: vi.fn()
}));

const { prepareMessageManipulationTurnMock } = vi.hoisted(() => ({
  prepareMessageManipulationTurnMock: vi.fn()
}));

const claimTurnControl = { id: "claim-control" };

const { releaseChatTurnStartMock } = vi.hoisted(() => ({
  releaseChatTurnStartMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/chat-turn", () => ({
  prepareMessageManipulationTurn: prepareMessageManipulationTurnMock,
  startManipulationTurn: startManipulationTurnMock
}));

vi.mock("@/lib/chat-turn-control", () => ({
  releaseChatTurnStart: releaseChatTurnStartMock
}));

describe("message edit restart route", () => {
  const defaultPreflight = { ok: true as const, context: {} };
  const defaultTurnContext = {
    snapshot: null as any,
    preflight: defaultPreflight,
    control: claimTurnControl
  };

  beforeEach(() => {
    requireUserMock.mockReset();
    startManipulationTurnMock.mockReset();
    prepareMessageManipulationTurnMock.mockReset();
    prepareMessageManipulationTurnMock.mockReturnValue(defaultTurnContext);
    releaseChatTurnStartMock.mockReset();
  });

  it("rewrites the message and starts a new assistant turn", async () => {
    const user = await createLocalUser({
      username: "edit-route-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Restart me", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Old content"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "New content" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        conversation: expect.objectContaining({ id: conversation.id }),
        messages: [
          expect.objectContaining({
            id: message.id,
            role: "user",
            content: "New content"
          })
        ]
      })
    );
    expect(startManipulationTurnMock).toHaveBeenCalledWith({
      conversationId: conversation.id,
      userMessageId: message.id,
      preflight: defaultPreflight,
      control: claimTurnControl,
      logTag: "message-edit-restart-route"
    });
  });

  it("rejects assistant messages", async () => {
    const user = await createLocalUser({
      username: "edit-route-assistant",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("No assistant edits", null, {}, user.id);
    const assistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Immutable"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${assistant.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Changed" })
      }),
      { params: Promise.resolve({ messageId: assistant.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Only user messages can be edited" });
  });

  it("rejects active conversations with 409", async () => {
    const user = await createLocalUser({
      username: "edit-route-active",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Busy conversation", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Retry this"
    });

    prepareMessageManipulationTurnMock.mockReturnValue(
      new Response(JSON.stringify({ error: "Wait for the current assistant response to finish before editing this conversation" }), { status: 409 })
    );

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Retry this with edits" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(409);
  });

  it("returns 400 for malformed json bodies", async () => {
    const user = await createLocalUser({
      username: "edit-route-bad-json",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Malformed body", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Original"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid message update" });
  });

  it("does not rewrite when assistant-start preflight fails", async () => {
    const user = await createLocalUser({
      username: "edit-route-preflight-fail",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    prepareMessageManipulationTurnMock.mockReturnValue(
      new Response(JSON.stringify({ error: "No provider profile configured" }), { status: 400 })
    );

    const conversation = createConversation("Preflight failure", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Old content"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "New content" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(400);
    expect(getMessage(message.id)?.content).toBe("Old content");
    expect(startManipulationTurnMock).not.toHaveBeenCalled();
  });

  it("returns the rewritten snapshot without waiting for assistant completion", async () => {
    const user = await createLocalUser({
      username: "edit-route-no-wait",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("No wait", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Old content"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "New content" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        conversation: expect.objectContaining({ id: conversation.id }),
        messages: [
          expect.objectContaining({
            id: message.id,
            role: "user",
            content: "New content"
          })
        ]
      })
    );
    expect(getMessage(message.id)?.content).toBe("New content");
  });

  it("returns 404 when the message does not exist", async () => {
    const user = await createLocalUser({
      username: "edit-route-missing-message",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request("http://localhost/api/messages/missing/edit-restart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "New content" })
      }),
      { params: Promise.resolve({ messageId: "missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Message not found" });
  });

  it("returns 409 when the conversation is already claimed for another turn", async () => {
    const user = await createLocalUser({
      username: "edit-route-claimed",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    prepareMessageManipulationTurnMock.mockReturnValue(
      new Response(JSON.stringify({ error: "Wait for the current assistant response to finish before editing this conversation" }), { status: 409 })
    );

    const conversation = createConversation("Claimed conversation", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Old content"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "New content" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(409);
    expect(getMessage(message.id)?.content).toBe("Old content");
    expect(startManipulationTurnMock).not.toHaveBeenCalled();
  });
});
