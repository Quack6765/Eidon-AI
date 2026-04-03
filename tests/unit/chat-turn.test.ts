import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn()
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: vi.fn().mockResolvedValue({
    promptMessages: [],
    compactionNoticeEvent: null
  })
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedConversationTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

function setupProviderProfile() {
  const profileId = "profile_chat_test";
  const profile = {
    id: profileId,
    name: "Test",
    apiBaseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-test",
    apiMode: "responses" as const,
    systemPrompt: "Be exact.",
    temperature: 0.4,
    maxOutputTokens: 512,
    reasoningEffort: "medium" as const,
    reasoningSummaryEnabled: true,
    modelContextLimit: 16384,
    compactionThreshold: 0.8,
    freshTailCount: 12
  };
  return { profileId, profile };
}

describe("chat-turn", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("creates user and assistant messages, broadcasts deltas via manager", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();

    const mockWs = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn()
    } as unknown as WebSocket;
    manager.subscribe("conv-1", mockWs);

    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conv = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );

    streamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        return { answer: "Hello", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const { startChatTurn, getChatEmitter } = await import("@/lib/chat-turn");
    const events: unknown[] = [];
    getChatEmitter().on("delta", (conversationId, event) => events.push({ conversationId, event }));

    await startChatTurn(manager, conv.id, "Hi", []);

    const deltaEvents = events.filter(
      (e) => (e.event as { type: string }).type === "answer_delta"
    );
    expect(deltaEvents.length).toBeGreaterThan(0);

    const { listVisibleMessages } = await import("@/lib/conversations");
    const messages = listVisibleMessages(conv.id);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].status).toBe("completed");
  });

  it("marks the assistant message as error on provider failure", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();

    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conv = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );

    streamProviderResponse.mockImplementation(() => {
      throw new Error("API key invalid");
    });

    const { startChatTurn } = await import("@/lib/chat-turn");
    await startChatTurn(manager, conv.id, "Hi", []);

    const { listVisibleMessages } = await import("@/lib/conversations");
    const messages = listVisibleMessages(conv.id);
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.status).toBe("error");
  });

  it("does nothing if conversation not found", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();

    const { startChatTurn } = await import("@/lib/chat-turn");
    await expect(startChatTurn(manager, "nonexistent", "Hi", [])).resolves.toBeUndefined();
  });

  it("broadcasts error if no API key configured", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");

    const manager = createConversationManager();
    const sent: unknown[] = [];
    const mockWs = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(JSON.parse(data))),
      close: vi.fn()
    } as unknown as WebSocket;

    const conv = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );

    manager.subscribe(conv.id, mockWs);

    const { startChatTurn } = await import("@/lib/chat-turn");
    await startChatTurn(manager, conv.id, "Hi", []);

    const errorMsg = sent.find((s: unknown) => (s as { type: string }).type === "error");
    expect(errorMsg).toBeDefined();
  });

  it("flushes answer text to DB periodically during streaming", async () => {
    vi.useFakeTimers();
    const { streamProviderResponse } = await import("@/lib/provider");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();

    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conv = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );

    let resolveStream: () => void;
    const gate = new Promise<void>((resolve) => { resolveStream = resolve; });

    streamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        yield { type: "answer_delta", text: " world" };
        await gate;
        return { answer: "Hello world", thinking: "", usage: { outputTokens: 2 } };
      })()
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    const pending = startChatTurn(manager, conv.id, "Hi", []);

    await vi.advanceTimersByTimeAsync(200);
    resolveStream!();
    await pending;

    const { getConversationSnapshot } = await import("@/lib/conversations");
    const snapshot = getConversationSnapshot(conv.id);
    const assistantMsg = snapshot!.messages.find((m) => m.role === "assistant");

    expect(assistantMsg!.textSegments!.length).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});
