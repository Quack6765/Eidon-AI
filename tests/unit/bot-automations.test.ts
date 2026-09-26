import { beforeEach, describe, expect, it } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { createAutomation, getAutomationRun, listAutomationRuns } from "@/lib/automations";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { resetBotRunLimiter } from "@/lib/bot-run-limiter";
import { resetAutomationExecutionLimiterForTests } from "@/lib/automation-execution-limiter";
import { claimChatTurnStart, hasActiveChatTurn, releaseChatTurnStart } from "@/lib/chat-turn-control";
import { createConversationManager } from "@/lib/conversation-manager";
import { createMessage } from "@/lib/conversations";
import {
  DELEGATED_TURN_STALL_STOP_MS,
  beginTurnActivity,
  endTurnActivity,
  resetTurnActivityForTests,
  scanTurnActivity
} from "@/lib/turn-activity";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";
import { ACTIVE_TURN_ERROR_MESSAGE, getAssistantTurnStartPreflight } from "@/lib/chat-turn";
import type { StartChatTurn } from "@/lib/chat-turn";

type TurnOptions = Parameters<StartChatTurn>[5];

function setupProvider() {
  const [profile, routineProfile] = ["profile_bot_routine", "profile_bot_routine_alt"].map((id) =>
    createProviderProfileInput({
      id,
      name: id,
      model: "gpt-test",
      systemPrompt: "Be exact.",
      temperature: 0.2,
      maxOutputTokens: 512,
      modelContextLimit: 16384,
      freshTailCount: 12,
      visionMode: "none",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })
  );
  updateProviderCatalog({
    defaultProviderProfileId: profile.id,
    skillsEnabled: false,
    providerProfiles: [profile, routineProfile]
  });
  return profile;
}

function answerTurn(conversationId: string, content: string, answer: string, options: TurnOptions) {
  const userMessage = createMessage({ conversationId, role: "user", content });
  const assistantMessage = createMessage({ conversationId, role: "assistant", content: answer });
  options?.onMessagesCreated?.({ userMessageId: userMessage.id, assistantMessageId: assistantMessage.id });
}

function createBotRoutine(userId: string, botId: string, overrides: { prompt?: string; providerProfileId?: string } = {}) {
  return createAutomation(
    {
      name: "Routine",
      prompt: overrides.prompt ?? "run the routine",
      providerProfileId: overrides.providerProfileId ?? "profile_bot_routine",
      personaId: null,
      botId,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: [],
      enabled: false
    },
    userId
  );
}

describe("bot routines (automation run-as-bot)", () => {
  beforeEach(() => {
    resetBotRunLimiter();
    resetTurnActivityForTests();
    resetAutomationExecutionLimiterForTests();
  });

  it("runs a bot-bound automation in the bot's home thread and records a bot run", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routineowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Monitor" }, user.id);

    const automation = createAutomation(
      {
        name: "Morning check",
        prompt: "run the morning check",
        providerProfileId: "profile_bot_routine",
        personaId: null,
        botId: bot.id,
        scheduleKind: "interval",
        intervalMinutes: 30,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        enabled: false
      },
      user.id
    );

    const seenConversations: string[] = [];
    const startChatTurnStub = (async (
      _manager: unknown,
      conversationId: string,
      content: string,
      _attachments: string[],
      _personaId?: string,
      options?: { botRun?: { record?: false } }
    ) => {
      seenConversations.push(conversationId);
      expect(content).toBe("run the morning check");
      expect(options?.botRun).toEqual({ record: false });
      return { status: "completed" as const };
    }) as StartChatTurn;

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const manager = createConversationManager();
    const run = await runAutomationNow(automation.id, user.id, {
      manager,
      startChatTurn: startChatTurnStub
    });

    expect(run?.status).toBe("completed");
    expect(run?.conversationId).toBe(bot.homeConversationId);
    expect(seenConversations).toEqual([bot.homeConversationId]);

    const botRuns = listRecentBotRuns({ userId: user.id });
    expect(botRuns).toHaveLength(1);
    expect(botRuns[0].botId).toBe(bot.id);
    expect(botRuns[0].triggerSource).toBe("routine");
    expect(botRuns[0].status).toBe("completed");
  });

  it("pauses a routine on a tool approval without letting its deadline expire", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routineapproval", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Watcher" }, user.id);
    const automation = createAutomation(
      {
        name: "Deploy check",
        prompt: "check the deploy",
        providerProfileId: "profile_bot_routine",
        personaId: null,
        botId: bot.id,
        scheduleKind: "interval",
        intervalMinutes: 30,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        enabled: false
      },
      user.id
    );

    const observed: Record<string, unknown> = {};
    const startChatTurnStub = (async (
      _manager: unknown,
      conversationId: string,
      content: string,
      _attachments: string[],
      _personaId?: string,
      options?: TurnOptions
    ) => {
      answerTurn(conversationId, content, "Deploy looks fine.", options);
      observed.unattended = options?.unattended;
      await options?.onApprovalWait?.(true);
      observed.waitingStatus = listRecentBotRuns({ userId: user.id })[0].status;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await options?.onApprovalWait?.(false);
      observed.resumedStatus = listRecentBotRuns({ userId: user.id })[0].status;
      return { status: "completed" as const };
    }) as StartChatTurn;

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const run = await runAutomationNow(automation.id, user.id, {
      manager: createConversationManager(),
      startChatTurn: startChatTurnStub,
      runTimeoutMs: 60
    });

    expect(run?.status).toBe("completed");
    expect(observed).toEqual({ unattended: true, waitingStatus: "waiting_approval", resumedStatus: "running" });
    expect(listRecentBotRuns({ userId: user.id })[0].status).toBe("completed");
  });

  it("waits for a chat with the bot to finish, then runs with the routine's provider", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routinebusy", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Chatty" }, user.id);
    const automation = createBotRoutine(user.id, bot.id, { providerProfileId: "profile_bot_routine_alt" });

    const chat = claimChatTurnStart(bot.homeConversationId);
    if (!chat.ok) throw new Error("Expected to claim the bot conversation");

    const providers: Array<string | undefined> = [];
    const startChatTurnStub = (async (
      _manager: unknown,
      conversationId: string,
      content: string,
      _attachments: string[],
      _personaId?: string,
      options?: TurnOptions
    ) => {
      if (hasActiveChatTurn(conversationId)) {
        return { status: "failed" as const, errorMessage: ACTIVE_TURN_ERROR_MESSAGE };
      }
      providers.push(options?.providerProfileId);
      answerTurn(conversationId, content, "Routine done.", options);
      return { status: "completed" as const };
    }) as StartChatTurn;

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const pending = runAutomationNow(automation.id, user.id, {
      manager: createConversationManager(),
      startChatTurn: startChatTurnStub
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(providers).toEqual([]);
    expect(chat.control.abortController.signal.aborted).toBe(false);

    releaseChatTurnStart(bot.homeConversationId, chat.control);
    const run = await pending;

    expect(run?.status).toBe("completed");
    expect(providers).toEqual(["profile_bot_routine_alt"]);
    expect(listRecentBotRuns({ userId: user.id })[0].status).toBe("completed");
  });

  it("runs the bot's turn on the provider the routine asks for", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routineprovider", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Pinned" }, user.id);

    const followsBot = getAssistantTurnStartPreflight(bot.homeConversationId);
    const followsRoutine = getAssistantTurnStartPreflight(bot.homeConversationId, "profile_bot_routine_alt");

    expect(followsBot.ok && followsBot.settings.id).toBe("profile_bot_routine");
    expect(followsRoutine.ok && followsRoutine.settings.id).toBe("profile_bot_routine_alt");
  });

  it("fills {{last_result}} with the routine's previous output, not the bot's latest chat reply", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routineresult", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Reporter" }, user.id);
    const automation = createBotRoutine(user.id, bot.id, { prompt: "Previous: {{last_result}}" });

    const prompts: string[] = [];
    const startChatTurnStub = (async (
      _manager: unknown,
      conversationId: string,
      content: string,
      _attachments: string[],
      _personaId?: string,
      options?: TurnOptions
    ) => {
      prompts.push(content);
      answerTurn(conversationId, content, `Routine output ${prompts.length}`, options);
      return { status: "completed" as const };
    }) as StartChatTurn;

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const dependencies = { manager: createConversationManager(), startChatTurn: startChatTurnStub };
    await runAutomationNow(automation.id, user.id, dependencies);
    createMessage({ conversationId: bot.homeConversationId, role: "user", content: "How are you?" });
    createMessage({ conversationId: bot.homeConversationId, role: "assistant", content: "Chat reply" });
    await runAutomationNow(automation.id, user.id, dependencies);

    expect(prompts).toEqual(["Previous: ", "Previous: Routine output 1"]);
  });

  it("stops a stalled routine and reports it as failed", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routinestall", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Dozer" }, user.id);
    const automation = createBotRoutine(user.id, bot.id);

    const startChatTurnStub = (async (
      _manager: unknown,
      conversationId: string,
      content: string,
      _attachments: string[],
      _personaId?: string,
      options?: TurnOptions
    ) => {
      answerTurn(conversationId, content, "Started…", options);
      beginTurnActivity(conversationId);
      scanTurnActivity(Date.now() + DELEGATED_TURN_STALL_STOP_MS + 1_000);
      endTurnActivity(conversationId);
      return { status: "stopped" as const };
    }) as StartChatTurn;

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const run = await runAutomationNow(automation.id, user.id, {
      manager: createConversationManager(),
      startChatTurn: startChatTurnStub
    });

    expect(run?.status).toBe("failed");
    expect(run?.errorMessage).toContain("Dozer stopped responding");
    const botRun = listRecentBotRuns({ userId: user.id })[0];
    expect(botRun.status).toBe("failed");
    expect(botRun.errorMessage).toContain("stopped responding");
  });

  it("fails a routine that overruns its deadline and stops only its own turn", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "routinedeadline", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Slowpoke" }, user.id);
    const automation = createBotRoutine(user.id, bot.id);

    let settled = false;
    const startChatTurnStub = (async (
      _manager: unknown,
      conversationId: string,
      content: string,
      _attachments: string[],
      _personaId?: string,
      options?: TurnOptions
    ) => {
      const claimed = claimChatTurnStart(conversationId);
      if (!claimed.ok) throw new Error("Expected an idle bot conversation");
      answerTurn(conversationId, content, "Still working…", options);
      await new Promise((resolve) =>
        claimed.control.abortController.signal.addEventListener("abort", resolve, { once: true })
      );
      releaseChatTurnStart(conversationId, claimed.control);
      settled = true;
      return { status: "stopped" as const };
    }) as StartChatTurn;

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const run = await runAutomationNow(automation.id, user.id, {
      manager: createConversationManager(),
      startChatTurn: startChatTurnStub,
      runTimeoutMs: 30
    });

    expect(run?.status).toBe("failed");
    expect(run?.errorMessage).toBe("Automation run exceeded its execution deadline");
    expect(listRecentBotRuns({ userId: user.id })[0].status).toBe("failed");
    await expect.poll(() => settled).toBe(true);
    expect(hasActiveChatTurn(bot.homeConversationId)).toBe(false);
  });

  it("keeps regular automations unchanged (fresh conversation, no bot run)", async () => {
    setupProvider();
    const user = await createLocalUser({ username: "plainowner", password: "password-123", role: "user" as const });

    const automation = createAutomation(
      {
        name: "Plain routine",
        prompt: "do the plain thing",
        providerProfileId: "profile_bot_routine",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 30,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: [],
        enabled: false
      },
      user.id
    );

    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const manager = createConversationManager();
    const run = await runAutomationNow(automation.id, user.id, {
      manager,
      startChatTurn: (async (_manager: unknown, _conversationId: string) => ({
        status: "completed" as const
      })) as StartChatTurn
    });

    expect(run?.status).toBe("completed");
    expect(run?.conversationId).not.toBeNull();
    expect(listRecentBotRuns({ userId: user.id })).toHaveLength(0);
    expect(listAutomationRuns(automation.id, user.id).length).toBe(1);
    expect(getAutomationRun(run!.id, user.id)?.status).toBe("completed");
  });
});
