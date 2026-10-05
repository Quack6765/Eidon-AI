import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveAssistantTurnMock } = vi.hoisted(() => ({
  resolveAssistantTurnMock: vi.fn()
}));

vi.mock("@/lib/assistant-runtime", () => ({
  resolveAssistantTurn: resolveAssistantTurnMock
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: vi.fn().mockResolvedValue({
    promptMessages: [{ role: "user", content: "Hi" }],
    promptTokens: 16,
    compactionLimit: 8192,
    didCompact: false
  }),
  getConversationContextUsage: vi.fn().mockReturnValue(null)
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
import { createBot, getBot, toBotSummary } from "@/lib/bots";
import {
  createBotRunRecord,
  getBotRun,
  listRecentBotRuns,
  stopBotRun,
  stopBotWork,
  stopConversationWork,
  updateBotRunStatus
} from "@/lib/bot-runs";
import {
  createConversation,
  createMessage,
  createMessageAction,
  getMessage,
  listMessages,
  listQueuedMessages
} from "@/lib/conversations";
import { createConversationManager } from "@/lib/conversation-manager";
import { startChatTurn } from "@/lib/chat-turn";
import {
  ChatTurnStoppedError,
  claimChatTurnStart,
  getActiveChatTurn,
  releaseChatTurnStart
} from "@/lib/chat-turn-control";
import { queueFollowUpMessage, sendQueuedMessageNow } from "@/lib/queued-chat-dispatcher";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";

type RedirectResult = { content: string; assistantMessageId: string } | null;

type TurnInput = {
  conversationId: string;
  assistantMessageId: string;
  abortSignal: AbortSignal;
  takeRedirect: () => Promise<RedirectResult>;
  onAnswerSegment: (segment: string) => Promise<void>;
};

function setupProvider() {
  const profile = createProviderProfileInput({
    id: "profile_bot_attention",
    name: "Bot Attention",
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

function recordingManager() {
  const manager = createConversationManager();
  const events: string[] = [];
  const broadcast = manager.broadcast.bind(manager);
  manager.broadcast = (conversationId, message) => {
    if (message.type === "delta" && (message.event.type === "done" || message.event.type === "message_start")) {
      events.push(`${message.event.type}:${message.event.messageId}`);
    } else if (message.type === "user_message_persisted") {
      events.push(`user:${message.message.content}`);
    }
    broadcast(conversationId, message);
  };
  return { manager, events };
}

describe("bot attention and control", () => {
  beforeEach(() => {
    resolveAssistantTurnMock.mockReset();
    setupProvider();
  });

  it("redirects a running bot turn with a message sent mid-run, splitting the reply around it", async () => {
    const user = await createLocalUser({ username: "redirectbot", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Scout" }, user.id);
    const { manager, events } = recordingManager();
    const observed: Record<string, unknown> = {};

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      observed.beforeRequest = await input.takeRedirect();
      await input.onAnswerSegment("Looking at France.");
      queueFollowUpMessage({ conversationId: bot.homeConversationId, content: "Focus on Canada instead" });
      const redirect = await input.takeRedirect();
      observed.redirect = redirect;
      observed.firstAssistantId = input.assistantMessageId;
      observed.queueAfterRedirect = listQueuedMessages(bot.homeConversationId).length;
      return { answer: "Canada it is.", thinking: "", usage: {} };
    });

    const created: Array<{ userMessageId: string; assistantMessageId: string }> = [];
    const result = await startChatTurn(manager, bot.homeConversationId, "Research markets", [], undefined, {
      onMessagesCreated: (payload) => created.push(payload)
    });

    expect(result.status).toBe("completed");
    expect(observed.beforeRequest).toBeNull();
    expect(observed.queueAfterRedirect).toBe(0);
    const redirect = observed.redirect as NonNullable<RedirectResult>;
    expect(redirect.content).toBe("Focus on Canada instead");

    const messages = listMessages(bot.homeConversationId).map((message) => ({
      role: message.role,
      content: message.content,
      status: message.status
    }));
    expect(messages).toEqual([
      { role: "user", content: "Research markets", status: "completed" },
      { role: "assistant", content: "Looking at France.", status: "completed" },
      { role: "user", content: "Focus on Canada instead", status: "completed" },
      { role: "assistant", content: "Canada it is.", status: "completed" }
    ]);
    expect(created.map((payload) => payload.assistantMessageId)).toEqual([
      observed.firstAssistantId,
      redirect.assistantMessageId
    ]);
    expect(events).toEqual([
      `message_start:${observed.firstAssistantId}`,
      `done:${observed.firstAssistantId}`,
      "user:Focus on Canada instead",
      `message_start:${redirect.assistantMessageId}`,
      `done:${redirect.assistantMessageId}`
    ]);

    const runs = listRecentBotRuns({ userId: user.id, botId: bot.id });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", triggerSource: "dm" });
    expect(toBotSummary(getBot(bot.id)!).unread).toBe(true);
  });

  it("queues follow-ups in regular chats until Send now asks to redirect the running turn", async () => {
    const user = await createLocalUser({ username: "redirectchat", password: "password-123", role: "user" as const });
    const conversation = createConversation(undefined, undefined, undefined, user.id);
    const observed: Record<string, unknown> = {};

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      const queued = queueFollowUpMessage({ conversationId: conversation.id, content: "Also check the tests" });
      observed.queuedOnly = await input.takeRedirect();
      expect(sendQueuedMessageNow({ conversationId: conversation.id, queuedMessageId: queued.id })).toBe(true);
      observed.redirected = await input.takeRedirect();
      return { answer: "Checked.", thinking: "", usage: {} };
    });

    const result = await startChatTurn(createConversationManager(), conversation.id, "Review the diff", []);

    expect(result.status).toBe("completed");
    expect(observed.queuedOnly).toBeNull();
    expect(observed.redirected).toMatchObject({ content: "Also check the tests" });
    expect(sendQueuedMessageNow({ conversationId: conversation.id, queuedMessageId: "queue-missing" })).toBe(false);
  });

  it("stops a DM run from its run record without recording an unread result", async () => {
    const user = await createLocalUser({ username: "stopdmrun", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Stopper" }, user.id);
    const observed: Record<string, unknown> = {};

    resolveAssistantTurnMock.mockImplementation(async (input: TurnInput) => {
      const [run] = listRecentBotRuns({ userId: user.id, botId: bot.id });
      observed.taggedRun = getActiveChatTurn(bot.homeConversationId)?.botRunId === run.id;
      expect(stopBotRun(run.id)?.status).toBe("stopped");
      observed.aborted = input.abortSignal.aborted;
      throw new ChatTurnStoppedError();
    });

    const result = await startChatTurn(createConversationManager(), bot.homeConversationId, "Long task", []);

    expect(result.status).toBe("stopped");
    expect(observed).toEqual({ taggedRun: true, aborted: true });
    expect(listRecentBotRuns({ userId: user.id, botId: bot.id })[0].status).toBe("stopped");
    expect(toBotSummary(getBot(bot.id)!).unread).toBe(false);
  });

  it("lists a bot's own and handed-off runs, attributed to the requesting bot, beyond the global top runs", async () => {
    const user = await createLocalUser({ username: "perbotruns", password: "password-123", role: "user" as const });
    const chief = createBot({ name: "Lead" }, user.id);
    const worker = createBot({ name: "Helper" }, user.id);
    const busy = createBot({ name: "Busy" }, user.id);

    const handoff = createMessage({ conversationId: chief.homeConversationId, role: "assistant", content: "" });
    const delegated = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: handoff.id
    });
    const own = createBotRunRecord({ botId: chief.id, conversationId: chief.homeConversationId, triggerSource: "dm" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let index = 0; index < 25; index += 1) {
      createBotRunRecord({ botId: busy.id, conversationId: busy.homeConversationId, triggerSource: "routine" });
    }

    expect(delegated.requestedByBotId).toBe(chief.id);
    expect(listRecentBotRuns({ userId: user.id, botId: chief.id }).map((run) => run.id).sort()).toEqual(
      [delegated.id, own.id].sort()
    );
    expect(listRecentBotRuns({ userId: user.id, botId: worker.id })).toEqual([
      expect.objectContaining({ id: delegated.id, requestedByBotId: chief.id })
    ]);
    expect(listRecentBotRuns({ userId: user.id, limit: 20 }).some((run) => run.id === delegated.id)).toBe(false);
  });

  it("stops a conversation's outstanding hand-offs down the chain, and a bot's queued runs", async () => {
    const user = await createLocalUser({ username: "cascadestop", password: "password-123", role: "user" as const });
    const chief = createBot({ name: "Boss" }, user.id);
    const worker = createBot({ name: "Middle" }, user.id);
    const leaf = createBot({ name: "Leaf" }, user.id);

    const chiefMessage = createMessage({ conversationId: chief.homeConversationId, role: "assistant", content: "" });
    const workerRun = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: chiefMessage.id
    });
    updateBotRunStatus(workerRun.id, { status: "running", startedAt: new Date().toISOString() });
    const workerTurn = claimChatTurnStart(worker.homeConversationId);
    if (!workerTurn.ok) throw new Error("worker turn not claimed");
    workerTurn.control.botRunId = workerRun.id;

    const workerMessage = createMessage({ conversationId: worker.homeConversationId, role: "assistant", content: "" });
    const leafRun = createBotRunRecord({
      botId: leaf.id,
      conversationId: leaf.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: workerMessage.id
    });
    const finished = createBotRunRecord({
      botId: leaf.id,
      conversationId: leaf.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: chiefMessage.id
    });
    updateBotRunStatus(finished.id, { status: "completed", finishedAt: new Date().toISOString() });

    try {
      stopConversationWork(chief.homeConversationId);

      expect(getBotRun(workerRun.id)?.status).toBe("stopped");
      expect(workerTurn.control.stopped).toBe(true);
      expect(getBotRun(leafRun.id)?.status).toBe("stopped");
      expect(getBotRun(finished.id)?.status).toBe("completed");
    } finally {
      releaseChatTurnStart(worker.homeConversationId, workerTurn.control);
    }

    const queued = createBotRunRecord({ botId: leaf.id, conversationId: leaf.homeConversationId, triggerSource: "routine" });
    const waitingForThread = createBotRunRecord({
      botId: leaf.id,
      conversationId: leaf.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: chiefMessage.id
    });
    updateBotRunStatus(waitingForThread.id, { status: "running", startedAt: new Date().toISOString() });
    stopBotWork(getBot(leaf.id)!);
    expect(getBotRun(queued.id)?.status).toBe("stopped");
    expect(getBotRun(waitingForThread.id)?.status).toBe("stopped");
    expect(stopBotRun("botrun-missing")).toBeNull();
    expect(stopBotRun(finished.id)?.status).toBe("completed");
  });

  it("marks the sender's hand-off line stopped as soon as a queued hand-off is stopped", async () => {
    const user = await createLocalUser({ username: "stophandoffline", password: "password-123", role: "user" as const });
    const chief = createBot({ name: "Sender" }, user.id);
    const worker = createBot({ name: "Receiver" }, user.id);
    const handoff = createMessage({ conversationId: chief.homeConversationId, role: "assistant", content: "" });
    const action = createMessageAction({
      messageId: handoff.id,
      kind: "message_bot",
      status: "pending",
      label: "Messaged Receiver",
      toolName: "message_bot"
    });
    const run = createBotRunRecord({
      botId: worker.id,
      conversationId: worker.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: handoff.id,
      prompt: "Do the thing",
      replyConversationId: chief.homeConversationId,
      replyActionId: action.id
    });

    expect(stopBotRun(run.id)?.status).toBe("stopped");

    const updated = getMessage(handoff.id)?.actions?.find((entry) => entry.id === action.id);
    expect(updated).toMatchObject({ status: "stopped", resultSummary: "Stopped by you before it finished." });
  });
});
