import { beforeEach, describe, expect, it, vi } from "vitest";

const { startChatTurnMock } = vi.hoisted(() => ({
  startChatTurnMock: vi.fn()
}));

vi.mock("@/lib/chat-turn", () => ({
  startChatTurn: startChatTurnMock
}));

import { createLocalUser } from "@/lib/users";
import { createBot, ensureChiefBot, getBot, listBots, MAX_BOTS_PER_USER } from "@/lib/bots";
import { createMessage } from "@/lib/conversations";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { resetBotRunLimiter } from "@/lib/bot-run-limiter";
import {
  buildDelegationWakeContent,
  deliverDelegationWake,
  executeCreateBotTool,
  executeMessageBot,
  executeUpdateBotTool
} from "@/lib/bot-delegation";
import type { PromptMessage } from "@/lib/types";

function buildContext(memoryUserId: string | null, assistantMessageId?: string, conversationId = "conv_chief") {
  const calls: Array<{ label: string; kind: string }> = [];
  const completions: Array<string | undefined> = [];
  const errors: Array<string | undefined> = [];
  return {
    context: {
      input: {
        memoryUserId,
        conversationId,
        assistantMessageId: assistantMessageId ?? undefined,
        onActionStart: async (action: { label: string; kind: string }) => {
          calls.push({ label: action.label, kind: action.kind });
          return "action_1";
        },
        onActionComplete: async (_handle: string | undefined, patch: { resultSummary?: string }) => {
          completions.push(patch.resultSummary);
        },
        onActionError: async (_handle: string | undefined, patch: { resultSummary?: string }) => {
          errors.push(patch.resultSummary);
        }
      },
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    },
    calls,
    completions,
    errors
  };
}

function stubWorkerAnswer(conversationId: string, answer: string) {
  createMessage({ conversationId, role: "user", content: "task" });
  createMessage({ conversationId, role: "assistant", content: answer });
}

describe("bot-delegation", () => {
  beforeEach(() => {
    startChatTurnMock.mockReset();
    resetBotRunLimiter();
  });

  it("messages asynchronously, attributing the sender, and reports the send immediately", async () => {
    const user = await createLocalUser({ username: "delegateowner", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const chiefMessage = createMessage({
      conversationId: chief.homeConversationId,
      role: "assistant",
      content: "delegating"
    });
    const worker = createBot({ name: "Researcher" }, user.id);
    const wakeCalls: string[] = [];
    const workerCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, content: string) => {
        if (conversationId === worker.homeConversationId) {
          workerCalls.push(content);
          stubWorkerAnswer(conversationId, "Found 3 sources.");
          return { status: "completed" as const };
        }
        wakeCalls.push(content);
        return { status: "completed" as const };
      }
    );

    const { context, calls } = buildContext(user.id, chiefMessage.id, chief.homeConversationId);
    const result = await executeMessageBot(
      "call_1",
      { bot: "researcher", message: "find three sources" },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(true);
    const toolMessage = result.promptMessages.at(-1);
    expect(toolMessage?.content).toContain("Message sent to Researcher");
    expect(toolMessage?.content).toContain("Say right away");
    expect(calls[0]).toEqual({ label: "Messaged Researcher", kind: "message_bot" });

    await vi.waitFor(() => {
      if (wakeCalls.length === 0 || workerCalls.length === 0) throw new Error("waiting for wake");
    }, { timeout: 5_000, interval: 10 });
    expect(workerCalls[0].startsWith("[Message from Chief of Staff]")).toBe(true);
    expect(workerCalls[0]).toContain("find three sources");
    expect(wakeCalls[0]).toContain("[Message from Researcher]");
    expect(wakeCalls[0]).toContain("Found 3 sources.");
    expect(wakeCalls[0]).toContain("Automated delivery");
    expect(wakeCalls[0]).toContain("report the outcome to the user");

    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].triggerSource).toBe("delegated");
    expect(runs[0].parentMessageId).toBe(chiefMessage.id);
  });

  it("rejects messaging unknown bots or itself without creating runs", async () => {
    const user = await createLocalUser({ username: "delegatereject", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Selfish" }, user.id);

    const unknown = buildContext(user.id);
    const unknownResult = await executeMessageBot(
      "call_3",
      { bot: "ghost", message: "anything" },
      unknown.context
    );
    expect((unknownResult as { toolSucceeded?: boolean }).toolSucceeded).toBeUndefined();
    expect(unknownResult.promptMessages.at(-1)?.content).toContain("no other bot");

    const selfResult = await executeMessageBot(
      "call_4",
      { bot: worker.id, message: "anything" },
      buildContext(user.id, undefined, worker.homeConversationId).context
    );
    expect(selfResult.promptMessages.at(-1)?.content).toContain("no other bot");

    expect(listRecentBotRuns({ userId: user.id })).toHaveLength(0);
    expect(startChatTurnMock).not.toHaveBeenCalled();
    expect(chief).toBeTruthy();
  });

  it("lets a worker message the chief and wakes the worker with the reply", async () => {
    const user = await createLocalUser({ username: "workertochief", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Field Agent" }, user.id);
    const chiefCalls: string[] = [];
    const workerWakeCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, content: string) => {
        if (conversationId === chief.homeConversationId) {
          chiefCalls.push(content);
          stubWorkerAnswer(conversationId, "Chief has handled it.");
          return { status: "completed" as const };
        }
        workerWakeCalls.push(content);
        return { status: "completed" as const };
      }
    );

    const { context } = buildContext(user.id, undefined, worker.homeConversationId);
    const result = await executeMessageBot(
      "call_wc",
      { bot: chief.id, message: "the user needs a status summary" },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(true);

    await vi.waitFor(() => {
      if (workerWakeCalls.length === 0 || chiefCalls.length === 0) throw new Error("waiting");
    }, { timeout: 5_000, interval: 10 });
    expect(chiefCalls[0].startsWith("[Message from Field Agent]")).toBe(true);
    expect(workerWakeCalls[0]).toContain("[Message from Chief of Staff]");
    expect(workerWakeCalls[0]).toContain("Chief has handled it.");

    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs[0].botId).toBe(chief.id);
    expect(runs[0].status).toBe("completed");
  });

  it("rejects echoing the sender's own last reply back to a bot", async () => {
    const user = await createLocalUser({ username: "echoguard", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Echo" }, user.id);
    createMessage({ conversationId: chief.homeConversationId, role: "user", content: "go" });
    createMessage({
      conversationId: chief.homeConversationId,
      role: "assistant",
      content: "The Researcher found 3 sources."
    });

    const { context } = buildContext(user.id, undefined, chief.homeConversationId);
    const result = await executeMessageBot(
      "call_echo",
      { bot: "Echo", message: "The Researcher found 3 sources." },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBeUndefined();
    expect(result.promptMessages.at(-1)?.content).toContain("duplicates the reply");
    expect(result.promptMessages.at(-1)?.content).toContain("Report Echo's reply to the user");
    expect(listRecentBotRuns({ userId: user.id })).toHaveLength(0);
    expect(startChatTurnMock).not.toHaveBeenCalled();
  });

  it("reports cap exhaustion through the wake when slots are full", async () => {
    const user = await createLocalUser({ username: "delegatecap", password: "password-123", role: "user" as const });
    const worker = createBot({ name: "Busy" }, user.id);
    const wakeCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, content: string) => {
        wakeCalls.push(content);
        return { status: "completed" as const };
      }
    );

    const { configureBotRunLimits, tryAcquireBotUserSlot } = await import("@/lib/bot-run-limiter");
    configureBotRunLimits({ maxConcurrentPerUser: 1 });
    expect(tryAcquireBotUserSlot(user.id)).toBe(true);

    const { context } = buildContext(user.id);
    const result = await executeMessageBot(
      "call_cap",
      { bot: worker.id, message: "queue me" },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(true);
    expect(result.promptMessages.at(-1)?.content).toContain("Message sent to Busy");

    await vi.waitFor(() => {
      if (wakeCalls.length === 0) throw new Error("waiting for wake");
    }, { timeout: 5_000, interval: 10 });

    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorMessage).toContain("Too many concurrent bot runs");
  });

  it("requires an owner and complete arguments", async () => {
    const noOwner = buildContext(null);
    const noOwnerResult = await executeMessageBot("call_n1", { bot: "x", message: "y" }, noOwner.context);
    expect(noOwnerResult.promptMessages.at(-1)?.content).toContain("not available");

    const user = await createLocalUser({ username: "argguard", password: "password-123", role: "user" as const });
    const missingArgs = await executeMessageBot("call_n2", { bot: "" }, buildContext(user.id).context);
    expect(missingArgs.promptMessages.at(-1)?.content).toContain("bot and message are required");
  });

  it("delegates asynchronously: returns immediately, then wakes the chief when the bot replies", async () => {
    const user = await createLocalUser({ username: "asyncowner", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Slowpoke" }, user.id);

    let workerStarted = false;
    const chiefWakeCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, content: string) => {
        if (conversationId === worker.homeConversationId) {
          workerStarted = true;
          await new Promise((resolve) => setTimeout(resolve, 20));
          stubWorkerAnswer(conversationId, "Async result.");
          return { status: "completed" as const };
        }
        chiefWakeCalls.push(content);
        return { status: "completed" as const };
      }
    );

    const { context, calls } = buildContext(user.id);
    const settled = vi.waitFor(() => {
      if (!workerStarted || chiefWakeCalls.length === 0) {
        throw new Error("not settled yet");
      }
    }, { timeout: 5_000, interval: 10 });

    const result = await executeMessageBot(
      "call_async",
      { bot: "Slowpoke", message: "take your time" },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(true);
    expect(result.promptMessages.at(-1)?.content).toContain("Message sent to Slowpoke");
    expect(calls[0]).toEqual({ label: "Messaged Slowpoke", kind: "message_bot" });

    await settled;

    expect(chiefWakeCalls[0]).toContain("[Message from Slowpoke]");
    expect(chiefWakeCalls[0]).toContain("Async result.");

    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs[0].status).toBe("completed");
    expect(runs[0].triggerSource).toBe("delegated");
  });

  it("wakes the chief with a failure notice when an async delegation fails", async () => {
    const user = await createLocalUser({ username: "asyncfail", password: "password-123", role: "user" as const });
    ensureChiefBot(user.id);
    const worker = createBot({ name: "Crashy" }, user.id);

    const chiefWakeCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string) => {
        if (conversationId === worker.homeConversationId) {
          return { status: "failed" as const, errorMessage: "provider down" };
        }
        chiefWakeCalls.push("wake");
        return { status: "completed" as const };
      }
    );

    const { context } = buildContext(user.id);
    await executeMessageBot("call_asyncfail", { bot: "Crashy", message: "anything" }, context);

    await vi.waitFor(() => {
      if (chiefWakeCalls.length === 0) throw new Error("waiting for wake");
    }, { timeout: 5_000, interval: 10 });

    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorMessage).toBe("provider down");
  });

  it("retries the wake while the chief conversation is busy", async () => {
    const user = await createLocalUser({ username: "wakeretry", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);

    let attempts = 0;
    startChatTurnMock.mockImplementation(async () => {
      attempts += 1;
      if (attempts === 1) {
        return { status: "failed" as const, errorMessage: "Conversation already has an active assistant turn" };
      }
      return { status: "completed" as const };
    });

    const wake = await deliverDelegationWake({
      chiefConversationId: chief.homeConversationId,
      ownerUserId: user.id,
      content: buildDelegationWakeContent("Bot", { status: "completed", summary: "done" }),
      maxAttempts: 3,
      retryDelayMs: 5
    });

    expect(wake.status).toBe("completed");
    expect(attempts).toBe(2);
    for (const call of startChatTurnMock.mock.calls) {
      expect(call[5]).toMatchObject({
        botRun: { record: false }
      });
      expect(call[5]).not.toHaveProperty("userMessageHidden");
      expect(typeof (call[5] as { onMessagesCreated?: unknown }).onMessagesCreated).toBe("function");
    }
  });

  it("gives up the wake after the retry budget", async () => {
    const user = await createLocalUser({ username: "wakegiveup", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);

    startChatTurnMock.mockImplementation(async () => ({
      status: "failed" as const,
      errorMessage: "Conversation already has an active assistant turn"
    }));

    const wake = await deliverDelegationWake({
      chiefConversationId: chief.homeConversationId,
      ownerUserId: user.id,
      content: "wake",
      maxAttempts: 2,
      retryDelayMs: 5
    });

    expect(wake.status).toBe("failed");
  });

  it("creates a bot via the create_bot tool and reports it", async () => {
    const user = await createLocalUser({ username: "createbotowner", password: "password-123", role: "user" as const });

    const { context, calls, completions } = buildContext(user.id);
    const result = await executeCreateBotTool(
      "call_5",
      { name: "Scout", title: "Lookout", description: "Watches for changes." },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(true);
    expect(calls[0]).toEqual({ label: "Create bot", kind: "create_bot" });
    expect(completions[0]).toContain("Scout");
    const created = listBots(user.id).find((bot) => bot.name === "Scout");
    expect(created).toBeTruthy();
    expect(created?.title).toBe("Lookout");
    expect(result.promptMessages.at(-1)?.content).toContain("Scout");
  });

  it("updates and renames a bot via the update_bot tool", async () => {
    const user = await createLocalUser({ username: "updatebotowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Scout" }, user.id);

    const { context, calls, completions, errors } = buildContext(user.id);
    const result = await executeUpdateBotTool(
      "call_u1",
      { bot: "scout", name: "Lookout", description: "Watches the perimeter." },
      context
    );

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(true);
    expect(calls[0]).toEqual({ label: "Rename Scout to Lookout", kind: "update_bot" });
    expect(completions[0]).toContain("Lookout");
    expect(errors).toHaveLength(0);

    const { listBots, getBot } = await import("@/lib/bots");
    const updated = getBot(bot.id, user.id);
    expect(updated?.name).toBe("Lookout");
    expect(updated?.description).toBe("Watches the perimeter.");
    expect(listBots(user.id).some((entry) => entry.name === "Scout")).toBe(false);

    const toolMessage = result.promptMessages.at(-1);
    expect(toolMessage?.content).toContain("renamed to \"Lookout\"");
  });

  it("rejects update_bot without a target, fields, or for the chief", async () => {
    const user = await createLocalUser({ username: "updatebotguard", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const bot = createBot({ name: "Keeper" }, user.id);

    const noFields = await executeUpdateBotTool("call_u2", { bot: bot.id }, buildContext(user.id).context);
    expect(noFields.promptMessages.at(-1)?.content).toContain("at least one of");

    const chiefTarget = await executeUpdateBotTool(
      "call_u3",
      { bot: chief.id, name: "Usurper" },
      buildContext(user.id).context
    );
    expect(chiefTarget.promptMessages.at(-1)?.content).toContain("no specialist bot");

    const unknown = await executeUpdateBotTool(
      "call_u4",
      { bot: "ghost", name: "Whatever" },
      buildContext(user.id).context
    );
    expect(unknown.promptMessages.at(-1)?.content).toContain("no specialist bot");
  });

  it("surfaces bot cap errors from the create_bot tool", async () => {
    const user = await createLocalUser({ username: "createbotcap", password: "password-123", role: "user" as const });
    ensureChiefBot(user.id);
    for (let index = 0; index < MAX_BOTS_PER_USER - 1; index += 1) {
      createBot({ name: `Filler ${index}` }, user.id);
    }

    const { context, errors } = buildContext(user.id);
    const result = await executeCreateBotTool("call_6", { name: "Overflow" }, context);

    expect((result as { toolSucceeded?: boolean }).toolSucceeded).toBe(false);
    expect(result.promptMessages.at(-1)?.content).toContain("limit reached");
    expect(errors).toHaveLength(1);
    expect(getBot("missing", user.id)).toBeNull();
  });
});
