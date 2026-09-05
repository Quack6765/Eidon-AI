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
import { getBotRun, listRecentBotRuns, updateBotRunStatus } from "@/lib/bot-runs";
import { configureBotRunLimits, enqueueSerialTask, releaseBotUserSlot, resetBotRunLimiter, tryAcquireBotUserSlot } from "@/lib/bot-run-limiter";
import { claimChatTurnStart, hasActiveChatTurn, releaseChatTurnStart } from "@/lib/chat-turn-control";
import {
  DELEGATED_TURN_STALL_STOP_MS,
  beginTurnActivity,
  endTurnActivity,
  resetTurnActivityForTests,
  scanTurnActivity
} from "@/lib/turn-activity";
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
    resetTurnActivityForTests();
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

  it("broadcasts the delegated task as a persisted user message in the worker conversation", async () => {
    const user = await createLocalUser({ username: "workerbroadcast", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Operator" }, user.id);
    const chiefMessage = createMessage({
      conversationId: chief.homeConversationId,
      role: "assistant",
      content: "delegating"
    });

    const { getConversationManager } = await import("@/lib/ws-singleton");
    const manager = getConversationManager();
    const workerEvents: Array<Record<string, unknown>> = [];
    const workerSocket = {
      readyState: 1,
      send: vi.fn((data: string) => workerEvents.push(JSON.parse(data))),
      close: vi.fn()
    };
    manager.subscribe(worker.homeConversationId, workerSocket as never);

    startChatTurnMock.mockImplementation(
      async (
        _manager: unknown,
        conversationId: string,
        content: string,
        _attachmentIds: unknown,
        _personaId: unknown,
        options?: { onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void }
      ) => {
        if (conversationId !== worker.homeConversationId) {
          return { status: "completed" as const };
        }
        const taskMessage = createMessage({
          conversationId,
          role: "user",
          content
        });
        stubWorkerAnswer(conversationId, "Saved.");
        options?.onMessagesCreated?.({
          userMessageId: taskMessage.id,
          assistantMessageId: "msg_assistant_worker"
        });
        return { status: "completed" as const };
      }
    );

    const { context } = buildContext(user.id, chiefMessage.id, chief.homeConversationId);
    await executeMessageBot("call_wb", { bot: "operator", message: "save the overview" }, context);

    await vi.waitFor(() => {
      if (
        !workerEvents.some(
          (event) =>
            event.type === "user_message_persisted" &&
            String((event as { message?: { content?: string } }).message?.content ?? "").startsWith(
              "[Message from Chief of Staff]"
            )
        )
      ) {
        throw new Error("waiting for worker user message broadcast");
      }
    }, { timeout: 5_000, interval: 10 });

    manager.unsubscribe(worker.homeConversationId, workerSocket as never);
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

  it("waits for a free concurrency slot instead of failing the delegation", async () => {
    const user = await createLocalUser({ username: "delegatecap", password: "password-123", role: "user" as const });
    const worker = createBot({ name: "Busy" }, user.id);
    const wakeCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, content: string) => {
        if (conversationId === worker.homeConversationId) {
          stubWorkerAnswer(conversationId, "Done after waiting.");
          return { status: "completed" as const };
        }
        wakeCalls.push(content);
        return { status: "completed" as const };
      }
    );

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

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(startChatTurnMock).not.toHaveBeenCalled();
    expect(listRecentBotRuns({ userId: user.id })[0].status).toBe("queued");

    releaseBotUserSlot(user.id);

    await vi.waitFor(() => {
      if (wakeCalls.length === 0) throw new Error("waiting for wake");
    }, { timeout: 5_000, interval: 10 });

    expect(wakeCalls[0]).toContain("Done after waiting.");
    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs[0].status).toBe("completed");
    configureBotRunLimits({ maxConcurrentPerUser: 4 });
  });

  it("waits for a busy worker conversation to free up before delivering the task", async () => {
    const user = await createLocalUser({ username: "workerbusy", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Occupied" }, user.id);
    const wakeCalls: string[] = [];
    const workerCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (_manager: unknown, conversationId: string, content: string) => {
        if (conversationId === worker.homeConversationId) {
          if (hasActiveChatTurn(conversationId)) {
            return { status: "failed" as const, errorMessage: "Conversation already has an active assistant turn" };
          }
          workerCalls.push(content);
          stubWorkerAnswer(conversationId, "Picked up once free.");
          return { status: "completed" as const };
        }
        wakeCalls.push(content);
        return { status: "completed" as const };
      }
    );

    const claimed = claimChatTurnStart(worker.homeConversationId);
    expect(claimed.ok).toBe(true);

    const { context } = buildContext(user.id, undefined, chief.homeConversationId);
    await executeMessageBot("call_busy", { bot: "occupied", message: "when you can" }, context);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(workerCalls).toHaveLength(0);
    expect(wakeCalls).toHaveLength(0);

    if (claimed.ok) releaseChatTurnStart(worker.homeConversationId, claimed.control);

    await vi.waitFor(() => {
      if (wakeCalls.length === 0) throw new Error("waiting for wake");
    }, { timeout: 5_000, interval: 10 });

    expect(workerCalls).toHaveLength(1);
    expect(wakeCalls[0]).toContain("Picked up once free.");
    expect(listRecentBotRuns({ userId: user.id })[0].status).toBe("completed");
  });

  it("reports a stalled worker that the watchdog stopped as a failed task", async () => {
    const user = await createLocalUser({ username: "stallowner", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Sleeper" }, user.id);
    const wakeCalls: string[] = [];
    startChatTurnMock.mockImplementation(
      async (
        _manager: unknown,
        conversationId: string,
        content: string,
        _attachmentIds: unknown,
        _personaId: unknown,
        options?: { onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void }
      ) => {
        if (conversationId !== worker.homeConversationId) {
          wakeCalls.push(content);
          return { status: "completed" as const };
        }
        const task = createMessage({ conversationId, role: "user", content });
        options?.onMessagesCreated?.({ userMessageId: task.id, assistantMessageId: "msg_worker" });
        beginTurnActivity(conversationId);
        scanTurnActivity(Date.now() + DELEGATED_TURN_STALL_STOP_MS + 1_000);
        endTurnActivity(conversationId);
        createMessage({ conversationId, role: "assistant", content: "Started collecting…" });
        return { status: "stopped" as const };
      }
    );

    const { context } = buildContext(user.id, undefined, chief.homeConversationId);
    await executeMessageBot("call_stall", { bot: "sleeper", message: "long job" }, context);

    await vi.waitFor(() => {
      if (wakeCalls.length === 0) throw new Error("waiting for wake");
    }, { timeout: 5_000, interval: 10 });

    expect(wakeCalls[0]).toContain("The task failed: Sleeper stopped responding (no activity for 10 minutes)");
    const runs = listRecentBotRuns({ userId: user.id });
    expect(runs[0].status).toBe("failed");
    expect(runs[0].errorMessage).toContain("stopped responding");
  });

  it("delivers replies to the same recipient one after another in arrival order", async () => {
    const user = await createLocalUser({ username: "wakeorder", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const events: string[] = [];
    let releaseFirst = () => {};
    startChatTurnMock.mockImplementation(async (_manager: unknown, _conversationId: string, content: string) => {
      events.push(`start:${content}`);
      if (content === "first") {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      events.push(`end:${content}`);
      return { status: "completed" as const };
    });

    const first = deliverDelegationWake({
      recipientConversationId: chief.homeConversationId,
      ownerUserId: user.id,
      content: "first"
    });
    const second = deliverDelegationWake({
      recipientConversationId: chief.homeConversationId,
      ownerUserId: user.id,
      content: "second"
    });

    await vi.waitFor(() => {
      if (!events.includes("start:first")) throw new Error("waiting for first wake");
    });
    expect(events).toEqual(["start:first"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["start:first", "end:first", "start:second", "end:second"]);
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
      recipientConversationId: chief.homeConversationId,
      ownerUserId: user.id,
      content: buildDelegationWakeContent("Bot", { status: "completed", summary: "done" }),
      maxWaitMs: 1_000
    });

    expect(wake.status).toBe("completed");
    expect(attempts).toBe(2);
    for (const call of startChatTurnMock.mock.calls) {
      expect(call[5]).toMatchObject({
        botRun: { record: false },
        quietWhenBusy: true
      });
      expect(call[5]).not.toHaveProperty("userMessageHidden");
      expect(typeof (call[5] as { onMessagesCreated?: unknown }).onMessagesCreated).toBe("function");
    }
  });

  it("gives up the wake once the wait budget is exhausted", async () => {
    const user = await createLocalUser({ username: "wakegiveup", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);

    startChatTurnMock.mockImplementation(async () => ({
      status: "failed" as const,
      errorMessage: "Conversation already has an active assistant turn"
    }));

    const wake = await deliverDelegationWake({
      recipientConversationId: chief.homeConversationId,
      ownerUserId: user.id,
      content: "wake",
      maxWaitMs: 20
    });

    expect(wake).toEqual({ status: "failed", errorMessage: "Recipient conversation stayed busy" });
  });

  it("skips a queued delegated run that was stopped before it started", async () => {
    const user = await createLocalUser({ username: "stopqueued", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Researcher" }, user.id);

    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    void enqueueSerialTask(worker.id, () => blocker);

    startChatTurnMock.mockImplementation(async () => ({ status: "completed" as const }));

    const { context } = buildContext(user.id, undefined, chief.homeConversationId);
    const result = await executeMessageBot(
      "call_stop",
      { bot: "researcher", message: "find three sources" },
      context
    );
    expect(result.promptMessages.at(-1)?.content).toContain("Message sent to Researcher");

    const queuedRun = listRecentBotRuns({ userId: user.id, limit: 10 }).find(
      (run) => run.botId === worker.id && run.status === "queued"
    );
    expect(queuedRun).toBeTruthy();

    updateBotRunStatus(queuedRun!.id, { status: "stopped", finishedAt: new Date().toISOString() });
    releaseBlocker();

    await vi.waitFor(() => {
      expect(
        startChatTurnMock.mock.calls.some(
          ([, conversationId]) => conversationId === chief.homeConversationId
        )
      ).toBe(true);
    });

    expect(getBotRun(queuedRun!.id)?.status).toBe("stopped");
    expect(
      startChatTurnMock.mock.calls.filter(
        ([, conversationId]) => conversationId === worker.homeConversationId
      )
    ).toHaveLength(0);
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
