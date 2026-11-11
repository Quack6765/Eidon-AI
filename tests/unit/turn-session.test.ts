import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn(),
  callProviderText: vi.fn()
}));

vi.mock("@/lib/searxng", () => ({
  searchSearxng: vi.fn().mockResolvedValue("SearXNG parallel result")
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: vi.fn().mockResolvedValue({
    promptMessages: [],
    promptTokens: 300,
    didCompact: false
  }),
  getConversationContextUsage: vi.fn().mockReturnValue({
    contextTokens: 512,
    compactionLimit: 8192
  }),
  startBackgroundCompaction: vi.fn().mockResolvedValue({ didCompact: false })
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedConversationTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

import {
  createProviderProfileInput,
  createRuntimeProviderProfile
} from "@/tests/provider-fixtures";

function setupProviderProfile() {
  const profileId = "profile_session_test";
  const profileSettings = {
    id: profileId,
    name: "Test",
    model: "gpt-test",
    systemPrompt: "Be exact.",
    temperature: 0.4,
    maxOutputTokens: 512,
    modelContextLimit: 16384,
    freshTailCount: 12,
    visionMode: "native"
  } as const;
  const profile = createProviderProfileInput(profileSettings);
  const runtimeProfile = createRuntimeProviderProfile(profileSettings);
  return { profileId, profile, runtimeProfile };
}

function createMockSocket(send = vi.fn()) {
  return {
    readyState: 1,
    send,
    close: vi.fn()
  } as unknown as Parameters<ReturnType<typeof import("@/lib/conversation-manager")["createConversationManager"]>["subscribe"]>[1];
}

async function setupReadyConversation(
  manager: ReturnType<typeof import("@/lib/conversation-manager")["createConversationManager"]>,
  ownerUserId?: string
) {
  const { updateProviderCatalog } = await import("@/lib/settings");
  const { profileId, profile } = setupProviderProfile();
  updateProviderCatalog({
    defaultProviderProfileId: profileId,
    skillsEnabled: false,
    providerProfiles: [profile]
  });
  const conversation = (await import("@/lib/conversations")).createConversation(
    undefined,
    undefined,
    { providerProfileId: null },
    ownerUserId
  );
  const send = vi.fn();
  manager.subscribe(conversation.id, createMockSocket(send));
  return { conversation, send };
}

function sentEvents(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((call) => String(call[0]));
}

describe("turn session", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("releases the claim after a completed turn", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { runTurnFromContent } = await import("@/lib/turn-session");

    const manager = createConversationManager();
    const { conversation } = await setupReadyConversation(manager);

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        return { answer: "Hello", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const result = await runTurnFromContent(manager, conversation.id, "Hi", []);
    expect(result).toEqual({ status: "completed" });

    const reclaimed = claimChatTurnStart(conversation.id);
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) releaseChatTurnStart(conversation.id, reclaimed.control);
  });

  it("fails to claim while another turn holds the claim and broadcasts unless quiet", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { runTurnFromContent, ACTIVE_TURN_ERROR_MESSAGE } = await import("@/lib/turn-session");

    const manager = createConversationManager();
    const { conversation, send } = await setupReadyConversation(manager);

    const held = claimChatTurnStart(conversation.id);
    expect(held.ok).toBe(true);

    const loud = await runTurnFromContent(manager, conversation.id, "Hi", []);
    expect(loud).toEqual({ status: "failed", errorMessage: ACTIVE_TURN_ERROR_MESSAGE });
    expect(sentEvents(send).some((payload) => payload.includes(ACTIVE_TURN_ERROR_MESSAGE))).toBe(true);

    send.mockClear();
    const quiet = await runTurnFromContent(manager, conversation.id, "Hi", [], undefined, {
      quietWhenBusy: true
    });
    expect(quiet).toEqual({ status: "failed", errorMessage: ACTIVE_TURN_ERROR_MESSAGE });
    expect(sentEvents(send)).toEqual([]);

    if (held.ok) releaseChatTurnStart(conversation.id, held.control);
  });

  it("releases the claim when turn setup throws", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { getDb } = await import("@/lib/db");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { runTurnFromContent } = await import("@/lib/turn-session");

    const manager = createConversationManager();
    const { conversation } = await setupReadyConversation(manager);

    getDb().exec(`
      CREATE TRIGGER reject_session_assistant_message
      BEFORE INSERT ON messages
      WHEN NEW.role = 'assistant'
      BEGIN
        SELECT RAISE(ABORT, 'assistant insert failed');
      END
    `);

    await expect(
      runTurnFromContent(manager, conversation.id, "Hi", [])
    ).rejects.toThrow("assistant insert failed");

    const reclaimed = claimChatTurnStart(conversation.id);
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) releaseChatTurnStart(conversation.id, reclaimed.control);
  });

  it("releases the claim when the turn is stopped", async () => {
    const { ChatTurnStoppedError } = await import("@/lib/chat-turn-control");
    const resolveAssistantTurn = vi.fn().mockImplementation(async (input: {
      abortSignal?: AbortSignal;
    }) => {
      await new Promise<void>((resolve) => input.abortSignal?.addEventListener("abort", () => resolve(), { once: true }));
      throw new ChatTurnStoppedError();
    });
    vi.doMock("@/lib/assistant-runtime", () => ({ resolveAssistantTurn }));

    try {
      const { createConversationManager } = await import("@/lib/conversation-manager");
      const { requestStop, claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
      const { runTurnFromContent } = await import("@/lib/turn-session");

      const manager = createConversationManager();
      const { conversation } = await setupReadyConversation(manager);

      const running = runTurnFromContent(manager, conversation.id, "Hi", []);
      await vi.waitFor(() => expect(resolveAssistantTurn).toHaveBeenCalledTimes(1));
      requestStop(conversation.id);

      await expect(running).resolves.toEqual({ status: "stopped" });

      const reclaimed = claimChatTurnStart(conversation.id);
      expect(reclaimed.ok).toBe(true);
      if (reclaimed.ok) releaseChatTurnStart(conversation.id, reclaimed.control);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
    }
  });

  it("claims an existing-message turn and releases it after a completed run", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createMessage, listVisibleMessages } = await import("@/lib/conversations");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { claimExistingMessageTurn } = await import("@/lib/turn-session");

    const manager = createConversationManager();
    const { conversation } = await setupReadyConversation(manager);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Continue from here"
    });

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Resumed" };
        return { answer: "Resumed", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const claimed = claimExistingMessageTurn({
      manager,
      conversationId: conversation.id,
      messageId: userMessage.id
    });
    expect(claimed.ok).toBe(true);
    expect(claimChatTurnStart(conversation.id).ok).toBe(false);

    if (!claimed.ok) throw new Error("claim unexpectedly failed");
    const result = await claimed.run();
    expect(result).toEqual({ status: "completed" });
    expect(listVisibleMessages(conversation.id).filter((message) => message.role === "user")).toHaveLength(1);

    const reclaimed = claimChatTurnStart(conversation.id);
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) releaseChatTurnStart(conversation.id, reclaimed.control);
  });

  it("rejects an existing-message claim with 404 for missing messages and 409 while busy", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createMessage } = await import("@/lib/conversations");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { claimExistingMessageTurn, ACTIVE_TURN_ERROR_MESSAGE } = await import("@/lib/turn-session");

    const manager = createConversationManager();
    const { conversation } = await setupReadyConversation(manager);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Continue from here"
    });

    const missing = claimExistingMessageTurn({
      manager,
      conversationId: conversation.id,
      messageId: "does-not-exist"
    });
    expect(missing).toEqual({ ok: false, statusCode: 404, errorMessage: "User message not found" });

    const held = claimChatTurnStart(conversation.id);
    expect(held.ok).toBe(true);

    const busy = claimExistingMessageTurn({
      manager,
      conversationId: conversation.id,
      messageId: userMessage.id
    });
    expect(busy).toEqual({ ok: false, statusCode: 409, errorMessage: ACTIVE_TURN_ERROR_MESSAGE });

    if (held.ok) releaseChatTurnStart(conversation.id, held.control);
  });

  it("releases the existing-message claim when the run's preflight fails", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createMessage } = await import("@/lib/conversations");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { claimExistingMessageTurn } = await import("@/lib/turn-session");

    const manager = createConversationManager();
    const conversation = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Continue from here"
    });

    const claimed = claimExistingMessageTurn({
      manager,
      conversationId: conversation.id,
      messageId: userMessage.id
    });
    expect(claimed.ok).toBe(true);

    if (!claimed.ok) throw new Error("claim unexpectedly failed");
    await expect(claimed.run()).resolves.toEqual({
      status: "failed",
      errorMessage: "Set an API key in settings before starting a chat"
    });

    const reclaimed = claimChatTurnStart(conversation.id);
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) releaseChatTurnStart(conversation.id, reclaimed.control);
  });

  it("restarts a turn after a mutation and releases the claim when the turn ends", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createMessage, listVisibleMessages } = await import("@/lib/conversations");
    const { hasActiveChatTurn } = await import("@/lib/chat-turn-control");
    const { restartTurnAfterMutation } = await import("@/lib/turn-session");
    const { createLocalUser } = await import("@/lib/users");

    const manager = createConversationManager();
    const user = await createLocalUser({
      username: "turn-session-restart",
      password: "Password123!",
      role: "user"
    });
    const { conversation } = await setupReadyConversation(manager, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Restart me"
    });

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Restarted" };
        return { answer: "Restarted", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    let capturedSnapshot: unknown = null;
    const restarted = restartTurnAfterMutation({
      conversationId: conversation.id,
      userId: user.id,
      userMessageId: userMessage.id,
      busyErrorMessage: "Wait for the current turn to finish",
      logTag: "turn-session-test",
      mutate: ({ snapshot }) => {
        capturedSnapshot = snapshot;
        return "mutation-result";
      }
    });
    expect(restarted).not.toBeInstanceOf(Response);
    expect(restarted).toBe("mutation-result");
    expect(capturedSnapshot).toMatchObject({ conversation: expect.objectContaining({ id: conversation.id }) });

    await vi.waitFor(() => expect(hasActiveChatTurn(conversation.id)).toBe(false));
    expect(listVisibleMessages(conversation.id).at(-1)).toMatchObject({
      role: "assistant",
      status: "completed"
    });
  });

  it("returns a busy response from restart-after-mutation while another turn holds the claim", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createMessage } = await import("@/lib/conversations");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { restartTurnAfterMutation } = await import("@/lib/turn-session");
    const { createLocalUser } = await import("@/lib/users");

    const manager = createConversationManager();
    const user = await createLocalUser({
      username: "turn-session-busy",
      password: "Password123!",
      role: "user"
    });
    const { conversation } = await setupReadyConversation(manager, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Restart me"
    });

    const held = claimChatTurnStart(conversation.id);
    expect(held.ok).toBe(true);

    const mutate = vi.fn(() => "mutation-result");
    const restarted = restartTurnAfterMutation({
      conversationId: conversation.id,
      userId: user.id,
      userMessageId: userMessage.id,
      busyErrorMessage: "Wait for the current turn to finish",
      logTag: "turn-session-test",
      mutate
    });
    expect(restarted).toBeInstanceOf(Response);
    expect((restarted as Response).status).toBe(409);
    expect(mutate).not.toHaveBeenCalled();

    if (held.ok) releaseChatTurnStart(conversation.id, held.control);
  });

  it("releases the claim and rethrows when the mutation fails", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createMessage } = await import("@/lib/conversations");
    const { claimChatTurnStart, releaseChatTurnStart } = await import("@/lib/chat-turn-control");
    const { restartTurnAfterMutation } = await import("@/lib/turn-session");
    const { createLocalUser } = await import("@/lib/users");

    const manager = createConversationManager();
    const user = await createLocalUser({
      username: "turn-session-mutation-failure",
      password: "Password123!",
      role: "user"
    });
    const { conversation } = await setupReadyConversation(manager, user.id);
    const userMessage = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Restart me"
    });

    expect(() =>
      restartTurnAfterMutation({
        conversationId: conversation.id,
        userId: user.id,
        userMessageId: userMessage.id,
        busyErrorMessage: "Wait for the current turn to finish",
        logTag: "turn-session-test",
        mutate: () => {
          throw new Error("mutation exploded");
        }
      })
    ).toThrow("mutation exploded");

    const reclaimed = claimChatTurnStart(conversation.id);
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) releaseChatTurnStart(conversation.id, reclaimed.control);
  });
});
