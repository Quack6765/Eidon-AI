import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureCompactedContextMock, streamProviderResponseMock } = vi.hoisted(() => ({
  ensureCompactedContextMock: vi.fn(),
  streamProviderResponseMock: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: streamProviderResponseMock,
  callProviderText: vi.fn()
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: ensureCompactedContextMock,
  getConversationContextUsage: vi.fn().mockReturnValue({
    contextTokens: 512,
    compactionLimit: 8192
  })
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedConversationTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

import { createLocalUser } from "@/lib/users";
import { createBot, ensureChiefBot } from "@/lib/bots";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { createConversationManager } from "@/lib/conversation-manager";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";

function setupProvider() {
  const profile = createProviderProfileInput({
    id: "profile_bot_chat",
    name: "Bot Chat",
    model: "gpt-test",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    modelContextLimit: 16384,
    freshTailCount: 12,
    visionMode: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  updateProviderCatalog({
    defaultProviderProfileId: profile.id,
    skillsEnabled: false,
    providerProfiles: [profile]
  });
}

function stubStream(answer = "Done.") {
  streamProviderResponseMock.mockReturnValue(
    (async function* () {
      yield { type: "answer_delta", text: answer };
      return { answer, thinking: "", usage: { outputTokens: 1 } };
    })()
  );
}

async function captureTools() {
  const calls = streamProviderResponseMock.mock.calls;
  const lastCall = calls[calls.length - 1];
  const tools = (lastCall?.[0] as { tools?: Array<{ function: { name: string; description?: string } }> })
    ?.tools;
  return tools ?? [];
}

describe("bot chat turns", () => {
  beforeEach(async () => {
    ensureCompactedContextMock.mockReset();
    streamProviderResponseMock.mockReset();
    ensureCompactedContextMock.mockResolvedValue({
      promptMessages: [{ role: "user", content: "Hi" }],
      promptTokens: 16,
      compactionLimit: 8192,
      didCompact: false
    });
    setupProvider();
  });

  it("uses the bot system prompt and records a dm run", async () => {
    const user = await createLocalUser({ username: "dmowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Keeper", title: "Records" }, user.id);
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const manager = createConversationManager();
    const result = await startChatTurn(manager, bot.homeConversationId, "Hi", []);

    expect(result.status).toBe("completed");
    expect(ensureCompactedContextMock).toHaveBeenCalled();
    const overrideArg = ensureCompactedContextMock.mock.calls.at(-1)?.[7];
    expect(overrideArg).toContain("Keeper");
    expect(overrideArg).toContain("specialist bot");

    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs).toHaveLength(1);
    expect(runs[0].triggerSource).toBe("dm");
    expect(runs[0].status).toBe("completed");
    expect(runs[0].conversationId).toBe(bot.homeConversationId);
  });

  it("gives every bot the message_bot tool; management tools stay chief-only", async () => {
    const user = await createLocalUser({ username: "chieftools", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    createBot({ name: "Researcher", title: "Web research" }, user.id);
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const manager = createConversationManager();
    await startChatTurn(manager, chief.homeConversationId, "plan my week", []);

    const tools = await captureTools();
    const names = tools.map((tool) => tool.function.name);
    expect(names).toContain("message_bot");
    expect(names).toContain("create_bot");
    expect(names).toContain("update_bot");
    expect(names).not.toContain("delegate_task");
    const messageTool = tools.find((tool) => tool.function.name === "message_bot");
    expect(messageTool?.function.description).toContain("Researcher");
    expect(messageTool?.function.description).toContain("Web research");
    const createBotTool = tools.find((tool) => tool.function.name === "create_bot");
    expect(createBotTool?.function.description).toContain("explicitly confirmed");
  });

  it("exposes message_bot to workers but not create or update tools", async () => {
    const user = await createLocalUser({ username: "workertools", password: "password-123", role: "user" as const });
    ensureChiefBot(user.id);
    const worker = createBot({ name: "Solo" }, user.id);
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversation } = await import("@/lib/conversations");
    const manager = createConversationManager();

    await startChatTurn(manager, worker.homeConversationId, "Hi", []);
    const workerTools = (await captureTools()).map((tool) => tool.function.name);
    expect(workerTools).toContain("message_bot");
    expect(workerTools).not.toContain("create_bot");
    expect(workerTools).not.toContain("update_bot");
    expect(workerTools).not.toContain("delegate_task");

    const plain = createConversation("Plain", null, {}, user.id);
    streamProviderResponseMock.mockClear();
    await startChatTurn(manager, plain.id, "Hi", []);
    expect((await captureTools()).map((tool) => tool.function.name)).not.toContain("message_bot");

    expect(listRecentBotRuns({ userId: user.id }).map((run) => run.conversationId)).toEqual([
      worker.homeConversationId
    ]);
  });

  it("delivers a wake turn that broadcasts into the conversation and grounds the reply", async () => {
    const user = await createLocalUser({ username: "hiddenwake", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { listMessages, listVisibleMessages } = await import("@/lib/conversations");
    const manager = createConversationManager();
    const sentEvents: Array<{ type: string; bot?: { id: string; status: string } }> = [];
    const socket = {
      readyState: 1,
      send: (data: string) => {
        sentEvents.push(JSON.parse(data));
      },
      close: vi.fn()
    } as unknown as import("ws").WebSocket;
    manager.addConnection(socket, user.id);

    const result = await startChatTurn(
      manager,
      chief.homeConversationId,
      "[Message from Researcher]\nFound 3 sources.\n---\n(Automated delivery)",
      [],
      undefined,
      { botRun: { record: false } }
    );

    expect(result.status).toBe("completed");
    const wake = listMessages(chief.homeConversationId).find((message) => message.role === "user");
    expect(wake?.content).toContain("Found 3 sources.");
    expect(
      listVisibleMessages(chief.homeConversationId).map((message) => message.role)
    ).toEqual(["user", "assistant"]);

    const chiefUpdates = sentEvents.filter(
      (event) => event.type === "bot_updated" && event.bot?.id === chief.id
    );
    expect(chiefUpdates.some((event) => event.bot?.status === "running")).toBe(true);
    expect(chiefUpdates.at(-1)?.bot?.status).toBe("idle");
  });
});
