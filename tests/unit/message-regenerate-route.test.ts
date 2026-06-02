import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConversation,
  createMessage,
  getMessage,
  listMessages,
  setConversationActive
} from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

const { startAssistantTurnFromExistingUserMessageMock, startManipulationTurnMock } = vi.hoisted(() => ({
  startAssistantTurnFromExistingUserMessageMock: vi.fn(),
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
  startAssistantTurnFromExistingUserMessage: startAssistantTurnFromExistingUserMessageMock,
  prepareMessageManipulationTurn: prepareMessageManipulationTurnMock,
  startManipulationTurn: startManipulationTurnMock
}));

vi.mock("@/lib/chat-turn-control", () => ({
  releaseChatTurnStart: releaseChatTurnStartMock
}));

describe("message regenerate route", () => {
  const defaultPreflight = { ok: true as const, context: {} };
  const defaultTurnContext = {
    snapshot: null as any,
    preflight: defaultPreflight,
    control: claimTurnControl
  };

  beforeEach(() => {
    requireUserMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockResolvedValue({ status: "completed" });
    startManipulationTurnMock.mockReset();
    prepareMessageManipulationTurnMock.mockReset();
    prepareMessageManipulationTurnMock.mockReturnValue(defaultTurnContext);
    releaseChatTurnStartMock.mockReset();
  });

  it("deletes the next assistant message and starts a new turn", async () => {
    const user = await createLocalUser({
      username: "regen-route-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Regenerate me", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Hello"
    });
    const assistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Hi there"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        conversation: expect.objectContaining({ id: conversation.id }),
        messages: [
          expect.objectContaining({
            id: userMessage.id,
            role: "user",
            content: "Hello"
          })
        ]
      })
    );
    expect(getMessage(assistantMessage.id)).toBeNull();
    expect(startManipulationTurnMock).toHaveBeenCalledWith({
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      preflight: defaultPreflight,
      control: claimTurnControl,
      logTag: "message-regenerate-route"
    });
  });

  it("starts a new turn even when no assistant message exists after the user message", async () => {
    const user = await createLocalUser({
      username: "regen-no-assistant",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("No assistant yet", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Just sent"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(200);
    expect(startManipulationTurnMock).toHaveBeenCalledWith({
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      preflight: defaultPreflight,
      control: claimTurnControl,
      logTag: "message-regenerate-route"
    });
  });

  it("rejects assistant messages with 400", async () => {
    const user = await createLocalUser({
      username: "regen-assistant-reject",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Assistant regen", null, {}, user.id);
    const assistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Cannot regenerate this"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${assistant.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: assistant.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Only user messages can be regenerated" });
  });

  it("rejects active conversations with 409", async () => {
    const user = await createLocalUser({
      username: "regen-active-conv",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Busy conversation", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Regenerate this"
    });

    prepareMessageManipulationTurnMock.mockReturnValue(
      new Response(JSON.stringify({ error: "Wait for the current assistant response to finish before regenerating" }), { status: 409 })
    );

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(409);
  });

  it("returns 404 when the message does not exist", async () => {
    const user = await createLocalUser({
      username: "regen-missing-msg",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request("http://localhost/api/messages/missing/regenerate", {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: "missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Message not found" });
  });

  it("does not regenerate when assistant-start preflight fails", async () => {
    const user = await createLocalUser({
      username: "regen-preflight-fail",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    prepareMessageManipulationTurnMock.mockReturnValue(
      new Response(JSON.stringify({ error: "No provider profile configured" }), { status: 400 })
    );

    const conversation = createConversation("Preflight failure", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Hello"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(400);
    expect(startManipulationTurnMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the turn is already claimed", async () => {
    const user = await createLocalUser({
      username: "regen-claimed",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);
    prepareMessageManipulationTurnMock.mockReturnValue(
      new Response(JSON.stringify({ error: "Wait for the current assistant response to finish before regenerating" }), { status: 409 })
    );

    const conversation = createConversation("Claimed conversation", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Hello"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(409);
    expect(startManipulationTurnMock).not.toHaveBeenCalled();
  });

});
