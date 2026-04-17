import fs from "node:fs";
import path from "node:path";
import type WebSocket from "ws";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
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
import { createLocalUser } from "@/lib/users";

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
    providerPresetId: null,
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
    requireUserMock.mockReset();
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

  it("marks started actions as error when the runtime fails after starting them", async () => {
    const resolveAssistantTurn = vi.fn().mockImplementation(async (input: {
      onActionStart?: (action: {
        kind: "image_generation";
        label: string;
        detail?: string;
      }) => Promise<string | void> | string | void;
    }) => {
      await input.onActionStart?.({
        kind: "image_generation",
        label: "Generate image",
        detail: "Generate an image of a red square"
      });
      throw new Error("runtime failed");
    });
    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn
    }));
    try {
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

      const { startChatTurn } = await import("@/lib/chat-turn");
      const result = await startChatTurn(manager, conv.id, "Generate an image of a red square", []);

      expect(result).toEqual({
        status: "failed",
        errorMessage: "runtime failed"
      });

      const { listVisibleMessages } = await import("@/lib/conversations");
      const assistantMsg = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
      expect(assistantMsg?.status).toBe("error");
      expect(assistantMsg?.actions).toEqual([
        expect.objectContaining({
          label: "Generate image",
          status: "error",
          resultSummary: "runtime failed"
        })
      ]);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
      vi.resetModules();
    }
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
    await expect(startChatTurn(manager, conv.id, "Hi", [])).resolves.toEqual({
      status: "failed",
      errorMessage: "Set an API key in settings before starting a chat"
    });

    const errorMsg = sent.find((s: unknown) => (s as { type: string }).type === "error");
    expect(errorMsg).toBeDefined();
    const { listVisibleMessages } = await import("@/lib/conversations");
    expect(listVisibleMessages(conv.id)).toHaveLength(0);
  });

  it("injects the selected user's built-in web search MCP server into tool discovery", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { gatherAllMcpTools } = await import("@/lib/mcp-client");
    const mockedGatherAllMcpTools = vi.mocked(gatherAllMcpTools);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings, updateGeneralSettingsForUser } = await import("@/lib/settings");

    const user = await createLocalUser({
      username: "web-search-owner",
      password: "changeme123",
      role: "user"
    });
    const manager = createConversationManager();
    const { profileId, profile } = setupProviderProfile();

    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });
    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "tavily",
      tavilyApiKey: "tvly-user-key"
    });

    const conv = (await import("@/lib/conversations")).createConversation(
      undefined,
      undefined,
      { providerProfileId: null },
      user.id
    );

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        return { answer: "Hello", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    await startChatTurn(manager, conv.id, "Hi", []);

    expect(mockedGatherAllMcpTools).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "builtin_web_search_tavily",
          name: "Tavily"
        })
      ])
    );
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

  it("sanitizes buffered local-file markdown before persisting stopped text segments", async () => {
    vi.useFakeTimers();
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");
    const { requestStop } = await import("@/lib/chat-turn-control");
    const { listVisibleMessages } = await import("@/lib/conversations");

    const manager = createConversationManager();
    const { profileId, profile } = setupProviderProfile();
    updateSettings({ defaultProviderProfileId: profileId, skillsEnabled: false, providerProfiles: [profile] });
    const conversation = (await import("@/lib/conversations")).createConversation(undefined, undefined, { providerProfileId: null });

    const tempDir = fs.mkdtempSync(path.join("/tmp", "chat-turn-stop-local-file-"));
    const reportPath = path.join(tempDir, "report.txt");
    fs.writeFileSync(reportPath, "report body", "utf8");

    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });

    try {
      mockedStreamProviderResponse.mockReturnValueOnce((async function* () {
        yield { type: "answer_delta", text: `Saved the output.\n\n[report](${reportPath})` };
        await gate;
        return { answer: `Saved the output.\n\n[report](${reportPath})`, thinking: "", usage: { outputTokens: 2 } };
      })());

      const { startChatTurn } = await import("@/lib/chat-turn");
      const run = startChatTurn(manager, conversation.id, "Save the report", []);

      await vi.advanceTimersByTimeAsync(120);
      requestStop(conversation.id);
      release();
      await run;

      const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("stopped");
      expect(assistant?.content).toBe("Saved the output.");
      expect((assistant?.textSegments ?? []).map((segment) => segment.content)).toEqual(["Saved the output."]);
      expect(JSON.stringify(assistant?.textSegments ?? [])).not.toContain(reportPath);
      expect(assistant?.attachments).toEqual([
        expect.objectContaining({
          filename: "report.txt",
          messageId: assistant?.id
        })
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      vi.useRealTimers();
    }
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

  it("drops streamed attachment-style markdown image deltas once a real image attachment exists", async () => {
    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn: vi.fn(async (input: {
        conversationId?: string;
        assistantMessageId?: string;
        onEvent?: (event: { type: string; text: string }) => void;
      }) => {
        const { createAttachments, assignAttachmentsToMessage } = await import("@/lib/attachments");
        const attachments = createAttachments(input.conversationId!, [
          {
            filename: "generated-inline.jpeg",
            mimeType: "image/jpeg",
            bytes: Buffer.from([1, 2, 3])
          }
        ]);
        assignAttachmentsToMessage(
          input.conversationId!,
          input.assistantMessageId!,
          attachments.map((attachment) => attachment.id)
        );

        input.onEvent?.({
          type: "answer_delta",
          text: "![Generated Image](generated-inline.jpeg)"
        });

        return {
          answer: "![Generated Image](generated-inline.jpeg)",
          thinking: "",
          usage: {}
        };
      })
    }));

    try {
      const { createConversationManager } = await import("@/lib/conversation-manager");
      const { updateSettings } = await import("@/lib/settings");
      const { listVisibleMessages } = await import("@/lib/conversations");
      const { startChatTurn } = await import("@/lib/chat-turn");

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

      await expect(startChatTurn(manager, conv.id, "Generate an image", [])).resolves.toEqual({
        status: "completed"
      });

      const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
      expect(assistant?.content).toBe("");
      expect(assistant?.textSegments ?? []).toHaveLength(0);
      expect(assistant?.attachments).toHaveLength(1);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
    }
  });

  it("drops assistant text segments that are only local markdown image embeds after image attachment assignment", async () => {
    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn: vi.fn(async (input: {
        conversationId?: string;
        assistantMessageId?: string;
        onAnswerSegment?: (segment: string) => void;
      }) => {
        const { createAttachments, assignAttachmentsToMessage } = await import("@/lib/attachments");
        const attachments = createAttachments(input.conversationId!, [
          {
            filename: "generated-segment.jpeg",
            mimeType: "image/jpeg",
            bytes: Buffer.from([1, 2, 3])
          }
        ]);
        assignAttachmentsToMessage(
          input.conversationId!,
          input.assistantMessageId!,
          attachments.map((attachment) => attachment.id)
        );

        input.onAnswerSegment?.("![Generated Image](generated-segment.jpeg)");

        return {
          answer: "![Generated Image](generated-segment.jpeg)",
          thinking: "",
          usage: {}
        };
      })
    }));

    try {
      const { createConversationManager } = await import("@/lib/conversation-manager");
      const { updateSettings } = await import("@/lib/settings");
      const { getConversationSnapshot, listVisibleMessages } = await import("@/lib/conversations");
      const { startChatTurn } = await import("@/lib/chat-turn");

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

      await expect(startChatTurn(manager, conv.id, "Generate an image", [])).resolves.toEqual({
        status: "completed"
      });

      const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
      const snapshot = getConversationSnapshot(conv.id);
      const assistantSnapshot = snapshot?.messages.find((message) => message.role === "assistant");

      expect(assistant?.content).toBe("");
      expect(assistantSnapshot?.textSegments ?? []).toHaveLength(0);
      expect(assistant?.attachments).toHaveLength(1);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
    }
  });

  it("persists salvaged data images as attachments and strips raw base64 from final assistant content", async () => {
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
        return {
          answer:
            "Here is the capture:\n\n![Inline](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2p8L8AAAAASUVORK5CYII=)",
          thinking: "",
          usage: { outputTokens: 1 }
        };
      })()
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    await expect(startChatTurn(manager, conv.id, "Show me the capture", [])).resolves.toEqual({
      status: "completed"
    });

    const { listVisibleMessages } = await import("@/lib/conversations");
    const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");

    expect(assistant?.content).toBe("Here is the capture:");
    expect(assistant?.attachments).toHaveLength(1);
    expect(assistant?.attachments?.[0]?.kind).toBe("image");
    expect(assistant?.content).not.toContain("data:image/png;base64");
    expect((assistant?.textSegments ?? []).map((segment) => segment.content)).toEqual(["Here is the capture:"]);
  });

  it("binds successful agent-browser screenshots as assistant attachments even when the answer only mentions them in prose", async () => {
    const tempDir = fs.mkdtempSync(path.join("/tmp", "chat-turn-browser-screenshot-"));
    const screenshotPath = path.join(tempDir, "atlantis_ninja.png");
    fs.writeFileSync(screenshotPath, Buffer.from([137, 80, 78, 71]));

    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn: vi.fn(async (input: {
        onActionStart?: (action: {
          kind: "shell_command";
          label: string;
          detail?: string;
          arguments?: Record<string, unknown>;
        }) => Promise<string | void> | string | void;
        onActionComplete?: (
          handle: string | undefined,
          patch: { detail?: string; resultSummary?: string }
        ) => Promise<void> | void;
      }) => {
        const command = `agent-browser screenshot ${screenshotPath} --full`;
        const handle = await input.onActionStart?.({
          kind: "shell_command",
          label: "Web browser",
          detail: command,
          arguments: { command }
        });
        await input.onActionComplete?.(typeof handle === "string" ? handle : undefined, {
          detail: command,
          resultSummary: `Screenshot saved to ${screenshotPath}`
        });

        return {
          answer: "I've captured the full-page screenshot and attached it for you.",
          thinking: "",
          usage: {}
        };
      })
    }));

    try {
      const { createConversationManager } = await import("@/lib/conversation-manager");
      const { updateSettings } = await import("@/lib/settings");
      const { listVisibleMessages } = await import("@/lib/conversations");
      const { startChatTurn } = await import("@/lib/chat-turn");

      const manager = createConversationManager();
      const { profileId, profile } = setupProviderProfile();
      updateSettings({
        defaultProviderProfileId: profileId,
        skillsEnabled: false,
        providerProfiles: [profile]
      });

      const conversation = (await import("@/lib/conversations")).createConversation(
        undefined,
        undefined,
        { providerProfileId: null }
      );

      await expect(startChatTurn(manager, conversation.id, "Capture the site", [])).resolves.toEqual({
        status: "completed"
      });

      const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistant?.content).toBe("I've captured the full-page screenshot and attached it for you.");
      expect(assistant?.attachments).toEqual([
        expect.objectContaining({
          filename: "atlantis_ninja.png",
          kind: "image",
          messageId: assistant?.id
        })
      ]);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not duplicate agent-browser screenshot attachments when the assistant also references the same local image in markdown", async () => {
    const tempDir = fs.mkdtempSync(path.join("/tmp", "chat-turn-browser-screenshot-dedupe-"));
    const screenshotPath = path.join(tempDir, "atlantis_ninja.png");
    fs.writeFileSync(screenshotPath, Buffer.from([137, 80, 78, 71]));

    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn: vi.fn(async (input: {
        onActionStart?: (action: {
          kind: "shell_command";
          label: string;
          detail?: string;
          arguments?: Record<string, unknown>;
        }) => Promise<string | void> | string | void;
        onActionComplete?: (
          handle: string | undefined,
          patch: { detail?: string; resultSummary?: string }
        ) => Promise<void> | void;
      }) => {
        const command = `agent-browser screenshot ${screenshotPath} --full`;
        const handle = await input.onActionStart?.({
          kind: "shell_command",
          label: "Web browser",
          detail: command,
          arguments: { command }
        });
        await input.onActionComplete?.(typeof handle === "string" ? handle : undefined, {
          detail: command,
          resultSummary: `Screenshot saved to ${screenshotPath}`
        });

        return {
          answer: `Here is the screenshot:\n\n![Atlantis Ninja Screenshot](${screenshotPath})`,
          thinking: "",
          usage: {}
        };
      })
    }));

    try {
      const { createConversationManager } = await import("@/lib/conversation-manager");
      const { updateSettings } = await import("@/lib/settings");
      const { listVisibleMessages } = await import("@/lib/conversations");
      const { startChatTurn } = await import("@/lib/chat-turn");

      const manager = createConversationManager();
      const { profileId, profile } = setupProviderProfile();
      updateSettings({
        defaultProviderProfileId: profileId,
        skillsEnabled: false,
        providerProfiles: [profile]
      });

      const conversation = (await import("@/lib/conversations")).createConversation(
        undefined,
        undefined,
        { providerProfileId: null }
      );

      await expect(startChatTurn(manager, conversation.id, "Capture the site", [])).resolves.toEqual({
        status: "completed"
      });

      const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistant?.content).toBe("Here is the screenshot:");
      expect(assistant?.attachments).toHaveLength(1);
      expect(assistant?.attachments?.[0]?.filename).toBe("atlantis_ninja.png");
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("adds runtime guidance not to base64 screenshot files or embed data image URLs", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { profile } = setupProviderProfile();

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Acknowledged." };
        return {
          answer: "Acknowledged.",
          thinking: "",
          usage: { outputTokens: 1 }
        };
      })()
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    await expect(
      resolveAssistantTurn({
        settings: profile,
        promptMessages: [{ role: "user", content: "Take a screenshot and share it" }],
        skills: [],
        mcpServers: [],
        mcpToolSets: []
      })
    ).resolves.toMatchObject({
      answer: "Acknowledged."
    });

    const providerCall = mockedStreamProviderResponse.mock.calls.at(-1)?.[0];
    const systemPrompt = providerCall?.promptMessages.find(
      (message: { role: string; content: unknown }) => message.role === "system"
    )?.content;

    expect(systemPrompt).toEqual(expect.any(String));
    expect(systemPrompt).toContain("Do not run base64 on screenshot/image files");
    expect(systemPrompt).toContain("Do not embed data: image URLs");
  });

  it("does not add the inline attachment directive when the user explicitly asks for base64 image output", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { profile } = setupProviderProfile();

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Acknowledged." };
        return {
          answer: "Acknowledged.",
          thinking: "",
          usage: { outputTokens: 1 }
        };
      })()
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    await expect(
      resolveAssistantTurn({
        settings: profile,
        promptMessages: [{ role: "user", content: "Give me the screenshot as a data:image/png;base64 URL" }],
        skills: [],
        mcpServers: [],
        mcpToolSets: []
      })
    ).resolves.toMatchObject({
      answer: "Acknowledged.",
      thinking: "",
      usage: {
        outputTokens: 1
      }
    });

    const providerCall = mockedStreamProviderResponse.mock.calls.at(-1)?.[0];
    const systemPrompt = providerCall?.promptMessages.find(
      (message: { role: string; content: unknown }) => message.role === "system"
    )?.content;

    expect(systemPrompt).toBeUndefined();
  });

  it("keeps the inline attachment directive when the user explicitly says not to send base64 or a data URL", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { profile } = setupProviderProfile();

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Acknowledged." };
        return {
          answer: "Acknowledged.",
          thinking: "",
          usage: { outputTokens: 1 }
        };
      })()
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    await expect(
      resolveAssistantTurn({
        settings: profile,
        promptMessages: [
          {
            role: "user",
            content: "Take a screenshot and attach it normally. Do not send base64 or a data URL."
          }
        ],
        skills: [],
        mcpServers: [],
        mcpToolSets: []
      })
    ).resolves.toMatchObject({
      answer: "Acknowledged."
    });

    const providerCall = mockedStreamProviderResponse.mock.calls.at(-1)?.[0];
    const systemPrompt = providerCall?.promptMessages.find(
      (message: { role: string; content: unknown }) => message.role === "system"
    )?.content;

    expect(systemPrompt).toEqual(expect.any(String));
    expect(systemPrompt).toContain("Do not run base64 on screenshot/image files");
    expect(systemPrompt).toContain("Do not embed data: image URLs");
  });

  it("does not add the inline attachment directive when the user wants only image bytes without markdown", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { profile } = setupProviderProfile();

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Acknowledged." };
        return {
          answer: "Acknowledged.",
          thinking: "",
          usage: { outputTokens: 1 }
        };
      })()
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    await expect(
      resolveAssistantTurn({
        settings: profile,
        promptMessages: [{ role: "user", content: "Give me no markdown, just the image bytes." }],
        skills: [],
        mcpServers: [],
        mcpToolSets: []
      })
    ).resolves.toMatchObject({
      answer: "Acknowledged."
    });

    const providerCall = mockedStreamProviderResponse.mock.calls.at(-1)?.[0];
    const systemPrompt = providerCall?.promptMessages.find(
      (message: { role: string; content: unknown }) => message.role === "system"
    )?.content;

    expect(systemPrompt).toBeUndefined();
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
    await vi.dynamicImportSettled();

    expect(ensureQueuedDispatch).toHaveBeenCalledWith({
      manager,
      conversationId: conv.id,
      startChatTurn
    });
  });

  it("continues from an existing user message without creating a duplicate user row", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { updateSettings } = await import("@/lib/settings");
    const { createConversation, createMessage, listVisibleMessages } = await import("@/lib/conversations");
    const { startAssistantTurnFromExistingUserMessage } = await import("@/lib/chat-turn");
    const { getConversationManager } = await import("@/lib/ws-singleton");

    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Restarted answer" };
        return {
          answer: "Restarted answer",
          thinking: "",
          usage: { outputTokens: 2 }
        };
      })()
    );

    const conversation = createConversation("Restart conversation");
    const existingUser = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Edited prompt"
    });

    const result = await startAssistantTurnFromExistingUserMessage(
      getConversationManager(),
      conversation.id,
      existingUser.id
    );

    expect(result).toEqual({ status: "completed" });
    const messages = listVisibleMessages(conversation.id);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(messages[0]?.id).toBe(existingUser.id);
    expect(messages.at(-1)?.role).toBe("assistant");
    expect(messages.at(-1)?.status).toBe("completed");
    expect(messages.at(-1)?.content).toBe("Restarted answer");
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
    await vi.dynamicImportSettled();
    expect(manager.isActive(conv.id)).toBe(false);
    expect(conversations.getConversation(conv.id)?.isActive).toBe(false);
    expect(conversations.listVisibleMessages(conv.id).find((message) => message.role === "assistant")?.status).toBe("error");
    expect(ensureQueuedDispatch).toHaveBeenCalledWith({
      manager,
      conversationId: conv.id,
      startChatTurn
    });
  });

  it("does not create an assistant placeholder when continuation preflight fails", async () => {
    const { createConversation, createMessage, listVisibleMessages } = await import("@/lib/conversations");
    const { startAssistantTurnFromExistingUserMessage } = await import("@/lib/chat-turn");
    const { getConversationManager } = await import("@/lib/ws-singleton");

    const conversation = createConversation("Restart conversation");
    const existingUser = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Edited prompt"
    });

    await expect(
      startAssistantTurnFromExistingUserMessage(
        getConversationManager(),
        conversation.id,
        existingUser.id
      )
    ).resolves.toEqual({
      status: "failed",
      errorMessage: "Set an API key in settings before starting a chat"
    });

    const messages = listVisibleMessages(conversation.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(existingUser.id);
    expect(messages[0]?.role).toBe("user");
  });

  it("preserves the turn result when queued dispatch throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const ensureQueuedDispatch = vi.fn().mockRejectedValue(new Error("dispatcher failed"));
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

    const conversations = await import("@/lib/conversations");
    const conv = conversations.createConversation(
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
    const result = await startChatTurn(manager, conv.id, "Hi", []);
    await vi.dynamicImportSettled();

    expect(result).toEqual({ status: "completed" });
    expect(ensureQueuedDispatch).toHaveBeenCalledWith({
      manager,
      conversationId: conv.id,
      startChatTurn
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("rejects a concurrent chat start without persisting another user row", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversation, listVisibleMessages } = await import("@/lib/conversations");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");
    const { startChatTurn } = await import("@/lib/chat-turn");

    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const manager = createConversationManager();
    const conversation = createConversation("Concurrent start");

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "First answer" };
        await gate;
        return {
          answer: "First answer",
          thinking: "",
          usage: { outputTokens: 2 }
        };
      })()
    );

    const firstStart = startChatTurn(manager, conversation.id, "First prompt", []);
    const secondResult = await startChatTurn(manager, conversation.id, "Second prompt", []);

    expect(secondResult).toEqual({
      status: "failed",
      errorMessage: "Conversation already has an active assistant turn"
    });
    expect(listVisibleMessages(conversation.id).filter((message) => message.role === "user")).toHaveLength(1);

    release();
    await expect(firstStart).resolves.toEqual({ status: "completed" });
  });

  it("completes a turn that triggers image generation via the agentic tool system", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);

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

    mockedStreamProviderResponse.mockReturnValueOnce((async function* () {
      return { answer: "Here is the image you requested.", thinking: "", usage: {} };
    })());

    const { startChatTurn } = await import("@/lib/chat-turn");
    const result = await startChatTurn(manager, conv.id, "Generate an image of Seoul at dusk", []);

    expect(result).toEqual({ status: "completed" });
  });

  it("binds inferred local attachments to the completed assistant message and sanitizes persisted content", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversation, listVisibleMessages } = await import("@/lib/conversations");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();
    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conversation = createConversation("Assistant attachments");
    const tempDir = fs.mkdtempSync(path.join("/tmp", "chat-turn-attachments-"));
    const reportPath = path.join(tempDir, "report.txt");
    fs.writeFileSync(reportPath, "report body", "utf8");

    try {
      mockedStreamProviderResponse.mockReturnValueOnce(
        (async function* () {
          yield { type: "answer_delta", text: "Saved the output to a local file." };
          return {
            answer: `Saved the output to a local file.\n\n[report](${reportPath})`,
            thinking: "",
            usage: { outputTokens: 8 }
          };
        })()
      );

      const { startChatTurn } = await import("@/lib/chat-turn");
      await expect(startChatTurn(manager, conversation.id, "Save a report", [])).resolves.toEqual({
        status: "completed"
      });

      const assistantMessage = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistantMessage?.status).toBe("completed");
      expect(assistantMessage?.content).toBe("Saved the output to a local file.");
      expect(assistantMessage?.attachments).toEqual([
        expect.objectContaining({
          filename: "report.txt",
          messageId: assistantMessage?.id
        })
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("appends assistant local attachment failure notes without aborting the turn", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const mockedStreamProviderResponse = vi.mocked(streamProviderResponse);
    const { createConversation, listVisibleMessages } = await import("@/lib/conversations");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { updateSettings } = await import("@/lib/settings");

    const manager = createConversationManager();
    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conversation = createConversation("Assistant attachment failures");

    mockedStreamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "I saved the file locally." };
        return {
          answer: "I saved the file locally.\n\n[hosts](/etc/hosts)",
          thinking: "",
          usage: { outputTokens: 6 }
        };
      })()
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    await expect(startChatTurn(manager, conversation.id, "Save a restricted file", [])).resolves.toEqual({
      status: "completed"
    });

    const assistantMessage = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
    expect(assistantMessage?.status).toBe("completed");
    expect(assistantMessage?.attachments).toEqual([]);
    expect(assistantMessage?.content).toBe(
      "I saved the file locally.\n\nNote: I couldn't attach `hosts` because only workspace files and /tmp are allowed."
    );
  });

  it("sanitizes local-file markdown segments in the SSE route before persistence", async () => {
    const { createLocalUser: createRouteUser } = await import("@/lib/users");
    const user = await createRouteUser({
      username: "route-user",
      password: "route-secret-123",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { updateSettings } = await import("@/lib/settings");
    const { createConversation, listVisibleMessages } = await import("@/lib/conversations");
    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conversation = createConversation("Route local attachments", null, { providerProfileId: null }, user.id);
    const tempDir = fs.mkdtempSync(path.join("/tmp", "chat-route-local-file-"));
    const reportPath = path.join(tempDir, "route-report.txt");
    fs.writeFileSync(reportPath, "report body", "utf8");

    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn: vi.fn(async (input: { onAnswerSegment?: (segment: string) => void }) => {
        input.onAnswerSegment?.(`Saved the output.\n\n[report](${reportPath})`);
        return {
          answer: `Saved the output.\n\n[report](${reportPath})`,
          thinking: "",
          usage: {}
        };
      })
    }));

    try {
      const { POST } = await import("@/app/api/conversations/[conversationId]/chat/route");
      const response = await POST(
        new Request(`http://localhost/api/conversations/${conversation.id}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Save the report", attachmentIds: [] })
        }),
        { params: Promise.resolve({ conversationId: conversation.id }) }
      );

      expect(response.status).toBe(200);
      await response.text();

      const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("completed");
      expect(assistant?.content).toBe("Saved the output.");
      expect((assistant?.textSegments ?? []).map((segment) => segment.content)).toEqual(["Saved the output."]);
      expect(JSON.stringify(assistant?.textSegments ?? [])).not.toContain(reportPath);
      expect(assistant?.attachments).toEqual([
        expect.objectContaining({
          filename: "route-report.txt",
          messageId: assistant?.id
        })
      ]);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not double-count route final content when a stopped turn flushes segmented text after a tool step", async () => {
    const { createLocalUser: createRouteUser } = await import("@/lib/users");
    const user = await createRouteUser({
      username: "route-stop-user",
      password: "route-stop-secret-123",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const { updateSettings } = await import("@/lib/settings");
    const { createConversation, listVisibleMessages } = await import("@/lib/conversations");
    const { profileId, profile } = setupProviderProfile();
    updateSettings({
      defaultProviderProfileId: profileId,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const conversation = createConversation("Route stop dedupe", null, { providerProfileId: null }, user.id);

    vi.doMock("@/lib/assistant-runtime", () => ({
      resolveAssistantTurn: vi.fn(async (input: {
        onEvent?: (event: { type: string; text: string }) => void;
        onAnswerSegment?: (segment: string) => void;
        onActionStart?: (action: {
          kind: "skill_load";
          label: string;
          detail?: string;
        }) => string | void;
      }) => {
        input.onActionStart?.({
          kind: "skill_load",
          label: "Load skill",
          detail: "Preparing route response"
        });
        input.onEvent?.({ type: "answer_delta", text: "Saved the output." });
        input.onAnswerSegment?.("Saved the output.");
        const { ChatTurnStoppedError } = await import("@/lib/chat-turn-control");
        throw new ChatTurnStoppedError();
      })
    }));

    try {
      const { POST } = await import("@/app/api/conversations/[conversationId]/chat/route");
      const response = await POST(
        new Request(`http://localhost/api/conversations/${conversation.id}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Save the report", attachmentIds: [] })
        }),
        { params: Promise.resolve({ conversationId: conversation.id }) }
      );

      expect(response.status).toBe(200);
      await response.text();

      const assistant = listVisibleMessages(conversation.id).find((message) => message.role === "assistant");
      expect(assistant?.status).toBe("stopped");
      expect(assistant?.content).toBe("Saved the output.");
      expect((assistant?.textSegments ?? []).map((segment) => segment.content)).toEqual(["Saved the output."]);
      expect(assistant?.actions).toEqual([
        expect.objectContaining({
          kind: "skill_load",
          label: "Load skill",
          status: "stopped"
        })
      ]);
    } finally {
      vi.doUnmock("@/lib/assistant-runtime");
    }
  });

});
