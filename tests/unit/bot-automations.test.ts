import { describe, expect, it } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { createAutomation, getAutomationRun, listAutomationRuns } from "@/lib/automations";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { createConversationManager } from "@/lib/conversation-manager";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";
import type { StartChatTurn } from "@/lib/chat-turn";

function setupProvider() {
  const profile = createProviderProfileInput({
    id: "profile_bot_routine",
    name: "Bot Routine",
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
  return profile;
}

describe("bot routines (automation run-as-bot)", () => {
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
