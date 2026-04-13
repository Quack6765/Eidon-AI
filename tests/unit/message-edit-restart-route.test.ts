import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, getMessage, setConversationActive } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

const { startAssistantTurnFromExistingUserMessageMock } = vi.hoisted(() => ({
  startAssistantTurnFromExistingUserMessageMock: vi.fn()
}));

const { getAssistantTurnStartPreflightMock } = vi.hoisted(() => ({
  getAssistantTurnStartPreflightMock: vi.fn()
}));

const claimTurnControl = { id: "claim-control" };

const { claimChatTurnStartMock, releaseChatTurnStartMock } = vi.hoisted(() => ({
  claimChatTurnStartMock: vi.fn(),
  releaseChatTurnStartMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/chat-turn", () => ({
  startAssistantTurnFromExistingUserMessage: startAssistantTurnFromExistingUserMessageMock,
  getAssistantTurnStartPreflight: getAssistantTurnStartPreflightMock
}));

vi.mock("@/lib/chat-turn-control", () => ({
  claimChatTurnStart: claimChatTurnStartMock,
  releaseChatTurnStart: releaseChatTurnStartMock
}));

describe("message edit restart route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockResolvedValue({ status: "completed" });
    getAssistantTurnStartPreflightMock.mockReset();
    getAssistantTurnStartPreflightMock.mockReturnValue({
      ok: true,
      context: {}
    });
    claimChatTurnStartMock.mockReset();
    claimChatTurnStartMock.mockReturnValue({
      ok: true,
      control: claimTurnControl
    });
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
    expect(startAssistantTurnFromExistingUserMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      conversation.id,
      message.id,
      undefined,
      {
        control: claimTurnControl,
        preflight: {
          ok: true,
          context: {}
        }
      }
    );
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
    setConversationActive(conversation.id, true);

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
    await expect(response.json()).resolves.toEqual({
      error: "Wait for the current assistant response to finish before editing this conversation"
    });
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
    getAssistantTurnStartPreflightMock.mockReturnValue({
      ok: false,
      status: "failed",
      statusCode: 400,
      errorMessage: "No provider profile configured"
    });

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
    await expect(response.json()).resolves.toEqual({ error: "No provider profile configured" });
    expect(getMessage(message.id)?.content).toBe("Old content");
    expect(startAssistantTurnFromExistingUserMessageMock).not.toHaveBeenCalled();
    expect(claimChatTurnStartMock).not.toHaveBeenCalled();
  });

  it("returns the rewritten snapshot without waiting for assistant completion", async () => {
    const user = await createLocalUser({
      username: "edit-route-restart-fail",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    startAssistantTurnFromExistingUserMessageMock.mockRejectedValue(
      new Error("Chat stream failed")
    );

    const conversation = createConversation("Restart failure", null, {}, user.id);
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
    await Promise.resolve();
    expect(releaseChatTurnStartMock).toHaveBeenCalledWith(conversation.id, claimTurnControl);
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
    claimChatTurnStartMock.mockReturnValue({
      ok: false
    });

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
    await expect(response.json()).resolves.toEqual({
      error: "Wait for the current assistant response to finish before editing this conversation"
    });
    expect(getMessage(message.id)?.content).toBe("Old content");
    expect(startAssistantTurnFromExistingUserMessageMock).not.toHaveBeenCalled();
  });
});
