import type WebSocket from "ws";
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

import type { ProviderProfileWithApiKey } from "@/lib/types";

function setupProviderProfile(): { profileId: string; profile: ProviderProfileWithApiKey } {
  const profileId = "profile_chat_test";
  const profile: ProviderProfileWithApiKey = {
    id: profileId,
    name: "Test",
    apiBaseUrl: "https://api.example.com/v1",
    apiKeyEncrypted: "",
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
    freshTailCount: 12,
    tokenizerModel: "gpt-tokenizer" as const,
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "native" as const,
    visionMcpServerId: null,
    providerKind: "openai_compatible",
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return { profileId, profile };
}

function createMockSocket(send = vi.fn()) {
  return {
    readyState: 1,
    send,
    close: vi.fn()
  } as unknown as Parameters<ReturnType<typeof import("@/lib/conversation-manager")["createConversationManager"]>["subscribe"]>[1];
}

describe("chat-turn", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("creates user and assistant messages, broadcasts deltas via manager", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();

    const mockWs = createMockSocket();
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

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        return { answer: "Hello", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const { startChatTurn, getChatEmitter } = await import("@/lib/chat-turn");
    const events: Array<{ conversationId: string; event: { type: string } }> = [];
    getChatEmitter().on("delta", (conversationId, event) =>
      events.push({ conversationId, event: event as { type: string } })
    );

    await startChatTurn(manager, conv.id, "Hi", []);

    const deltaEvents = events.filter((event) => event.event.type === "answer_delta");
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
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
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

    mockedStreamProviderResponse.mockImplementation(() => {
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
    await expect(startChatTurn(manager, "nonexistent", "Hi", [])).resolves.toEqual({
      status: "skipped",
      errorMessage: "Conversation not found"
    });
  });

  it("broadcasts error if no API key configured", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");

    const manager = createConversationManager();
    const sent: unknown[] = [];
    const mockWs = createMockSocket(vi.fn((data: string) => sent.push(JSON.parse(data))));

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

  it("persists a partial assistant message as stopped when the turn is cancelled", async () => {
    vi.useFakeTimers();
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");
    const { requestStop } = await import("@/lib/chat-turn-control");

    const manager = createConversationManager();
    const { profileId, profile } = setupProviderProfile();
    updateSettings({ defaultProviderProfileId: profileId, skillsEnabled: false, providerProfiles: [profile] });
    const conv = (await import("@/lib/conversations")).createConversation(undefined, undefined, { providerProfileId: null });

    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mockedStreamProviderResponse.mockReturnValueOnce((async function* () {
      yield { type: "answer_delta", text: "Partial" };
      await gate;
      return { answer: "Partial answer", thinking: "", usage: { outputTokens: 2 } };
    })());

    const { startChatTurn } = await import("@/lib/chat-turn");
    const run = startChatTurn(manager, conv.id, "Hi", []);

    await vi.advanceTimersByTimeAsync(120);
    requestStop(conv.id);
    release();
    await run;

    const { listVisibleMessages } = await import("@/lib/conversations");
    const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
    expect(assistant?.status).toBe("stopped");
    expect(assistant?.content).toContain("Partial");
    vi.useRealTimers();
  });

  it("flushes answer text to DB periodically during streaming", async () => {
    vi.useFakeTimers();
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
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

    mockedStreamProviderResponse.mockReturnValueOnce(
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
    expect(
      assistantMsg!.textSegments!.map((segment) => segment.content).join("")
    ).toBe("Hello world");

    vi.useRealTimers();
  });

  it("persists pending memory proposal metadata on assistant actions", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();

    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      memoriesEnabled: true,
      providerProfiles: [profile]
    });

    const conv = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );

    mockedStreamProviderResponse
      .mockReturnValueOnce(
        (async function* () {
          return {
            answer: "",
            thinking: "",
            toolCalls: [
              {
                id: "call_1",
                name: "create_memory",
                arguments: JSON.stringify({
                  content: "User name is Charles",
                  category: "personal"
                })
              }
            ],
            usage: { inputTokens: 5 }
          };
        })()
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "answer_delta", text: "Nice to meet you, Charles." };
          return {
            answer: "Nice to meet you, Charles.",
            thinking: "",
            usage: { inputTokens: 5, outputTokens: 4 }
          };
        })()
      );

    const { startChatTurn } = await import("@/lib/chat-turn");
    await startChatTurn(manager, conv.id, "Hi, my name is Charles.", []);

    const { listVisibleMessages } = await import("@/lib/conversations");
    const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
    const memoryAction = assistant?.actions?.find((action) => action.kind === "create_memory");

    expect(memoryAction).toEqual(
      expect.objectContaining({
        status: "pending",
        proposalState: "pending",
        proposalPayload: {
          operation: "create",
          targetMemoryId: null,
          proposedMemory: {
            content: "User name is Charles",
            category: "personal"
          }
        }
      })
    );
  });

  it("ensures queued dispatch runs after the turn finalizes", async () => {
    const ensureQueuedDispatch = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/queued-chat-dispatcher", () => ({
      ensureQueuedDispatch
    }));

    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
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

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        return { answer: "Hello", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    await startChatTurn(manager, conv.id, "Hi", []);

    expect(ensureQueuedDispatch).toHaveBeenCalledWith({
      manager,
      conversationId: conv.id,
      startChatTurn
    });
  });

  it("cleans up normally when onMessagesCreated throws", async () => {
    const ensureQueuedDispatch = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/queued-chat-dispatcher", () => ({
      ensureQueuedDispatch
    }));

    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();
    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conversations = await import("@/lib/conversations");
    const conv = conversations.createConversation(
      undefined,
      undefined,
      { providerProfileId: null }
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    const result = await startChatTurn(
      manager,
      conv.id,
      "Hi",
      [],
      undefined,
      {
        onMessagesCreated() {
          throw new Error("Queue callback failed");
        }
      }
    );

    expect(result).toEqual({
      status: "failed",
      errorMessage: "Queue callback failed"
    });
    expect(manager.isActive(conv.id)).toBe(false);
    expect(conversations.getConversation(conv.id)?.isActive).toBe(false);
    expect(conversations.listVisibleMessages(conv.id).find((message) => message.role === "assistant")?.status).toBe("error");
    expect(ensureQueuedDispatch).toHaveBeenCalledWith({
      manager,
      conversationId: conv.id,
      startChatTurn
    });
  });
});
