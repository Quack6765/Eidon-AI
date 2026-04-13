import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, setConversationActive } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

const { startAssistantTurnFromExistingUserMessageMock } = vi.hoisted(() => ({
  startAssistantTurnFromExistingUserMessageMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/chat-turn", () => ({
  startAssistantTurnFromExistingUserMessage: startAssistantTurnFromExistingUserMessageMock
}));

describe("message edit restart route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockResolvedValue({ status: "completed" });
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
    expect(startAssistantTurnFromExistingUserMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      conversation.id,
      message.id,
      undefined
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
});
