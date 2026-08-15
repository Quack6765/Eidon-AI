import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createConversation,
  createMessage,
  getMessage
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
  startManipulationTurn: startManipulationTurnMock,
  restartAssistantTurnAfterMutation: (input: {
    conversationId: string;
    userMessageId: string;
    turn: { preflight: unknown; control: unknown };
    logTag: string;
    mutate: () => unknown;
  }) => {
    const result = input.mutate();
    startManipulationTurnMock({
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      preflight: input.turn.preflight,
      control: input.turn.control,
      logTag: input.logTag
    });
    return result;
  }
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

  it("deletes every assistant message after the user message and starts a new turn", async () => {
    const user = await createLocalUser({
      username: "regen-route-multi-assistant",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Regenerate multi", null, {}, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Hello"
    });
    const firstAssistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "First answer"
    });
    const secondAssistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Second answer"
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
    expect(getMessage(firstAssistantMessage.id)).toBeNull();
    expect(getMessage(secondAssistantMessage.id)).toBeNull();
    expect(startManipulationTurnMock).toHaveBeenCalledWith({
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      preflight: defaultPreflight,
      control: claimTurnControl,
      logTag: "message-regenerate-route"
    });
  });

  it("rejects mid-history user messages with 409 and deletes nothing", async () => {
    const user = await createLocalUser({
      username: "regen-route-mid-history",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Mid history regenerate", null, {}, user.id);
    const firstUserMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "First question"
    });
    const firstAssistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "First answer"
    });
    const lastUserMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Second question"
    });
    const lastAssistantMessage = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Second answer"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${firstUserMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: firstUserMessage.id }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Only the latest user message can be regenerated"
    });
    expect(getMessage(firstUserMessage.id)).not.toBeNull();
    expect(getMessage(firstAssistantMessage.id)).not.toBeNull();
    expect(getMessage(lastUserMessage.id)).not.toBeNull();
    expect(getMessage(lastAssistantMessage.id)).not.toBeNull();
    expect(startManipulationTurnMock).not.toHaveBeenCalled();
  });

  it("returns 404 when regenerating another user's message", async () => {
    const owner = await createLocalUser({
      username: "regen-route-owner",
      password: "Password123!",
      role: "user"
    });
    const intruder = await createLocalUser({
      username: "regen-route-intruder",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(intruder);

    const conversation = createConversation("Owned conversation", null, {}, owner.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Not yours"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/regenerate/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${userMessage.id}/regenerate`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: userMessage.id }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Message not found" });
    expect(getMessage(userMessage.id)).not.toBeNull();
    expect(startManipulationTurnMock).not.toHaveBeenCalled();
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
