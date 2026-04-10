import { describe, expect, it, vi } from "vitest";

import {
  createAutomation,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  triggerAutomationNow,
  updateAutomation
} from "@/lib/automations";
import { createConversationManager } from "@/lib/conversation-manager";
import { getConversation } from "@/lib/conversations";
import type { ChatTurnResult } from "@/lib/chat-turn";
import type { ProviderProfileWithApiKey } from "@/lib/types";

function createProviderProfile(id = "profile_scheduler"): ProviderProfileWithApiKey {
  const timestamp = "2026-04-10T00:00:00.000Z";

  return {
    id,
    name: "Scheduler Test",
    apiBaseUrl: "https://api.example.com/v1",
    apiKeyEncrypted: "",
    apiKey: "sk-test",
    model: "gpt-test",
    apiMode: "responses",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium",
    reasoningSummaryEnabled: true,
    modelContextLimit: 16384,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    tokenizerModel: "gpt-tokenizer",
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "none",
    visionMcpServerId: null,
    providerKind: "openai_compatible",
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function waitForRunStatus(runId: string, status: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const run = getAutomationRun(runId);
    if (run?.status === status) {
      return run;
    }
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for automation run ${runId} to reach ${status}`);
}

describe("automation scheduler", () => {
  it("calculates the next interval and weekly calendar runs", async () => {
    const { getNextAutomationRunAt } = await import("@/lib/automation-scheduler");

    const intervalAutomation = createAutomation({
      name: "Interval automation",
      prompt: "Prompt",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const weeklyAutomation = createAutomation({
      name: "Weekly automation",
      prompt: "Prompt",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "weekly",
      timeOfDay: "09:30",
      daysOfWeek: [1, 3]
    });

    expect(getNextAutomationRunAt(intervalAutomation, "2026-04-10T10:00:00.000Z", "UTC")).toBe(
      "2026-04-10T10:15:00.000Z"
    );
    expect(
      getNextAutomationRunAt(weeklyAutomation, "2026-04-10T14:00:00.000Z", "America/Toronto")
    ).toBe("2026-04-13T13:30:00.000Z");
  });

  it("marks older overdue slots as missed and executes only the latest due run", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const startChatTurn = vi
      .fn<(
        manager: ReturnType<typeof createConversationManager>,
        conversationId: string,
        content: string,
        attachmentIds: string[],
        personaId?: string
      ) => Promise<ChatTurnResult>>()
      .mockResolvedValue({ status: "completed" });
    const manager = createConversationManager();
    const { createAutomationScheduler } = await import("@/lib/automation-scheduler");
    const scheduler = createAutomationScheduler({
      now: () => new Date("2026-04-10T10:40:00.000Z"),
      timeZone: "UTC",
      manager,
      startChatTurn
    });

    const automation = createAutomation({
      name: "Overdue automation",
      prompt: "Summarize the backlog",
      providerProfileId: "profile_scheduler",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await scheduler.runOnce();

    const runs = listAutomationRuns(automation.id);

    expect(runs).toHaveLength(3);
    expect(runs.map((run) => ({
      scheduledFor: run.scheduledFor,
      status: run.status
    }))).toEqual([
      { scheduledFor: "2026-04-10T10:30:00.000Z", status: "completed" },
      { scheduledFor: "2026-04-10T10:15:00.000Z", status: "missed" },
      { scheduledFor: "2026-04-10T10:00:00.000Z", status: "missed" }
    ]);
    expect(startChatTurn).toHaveBeenCalledTimes(1);
    expect(getAutomation(automation.id)?.nextRunAt).toBe("2026-04-10T10:45:00.000Z");
  });

  it("executes triggered runs by creating an automation conversation and updating the run", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const startChatTurn = vi
      .fn<(
        manager: ReturnType<typeof createConversationManager>,
        conversationId: string,
        content: string,
        attachmentIds: string[],
        personaId?: string
      ) => Promise<ChatTurnResult>>()
      .mockResolvedValue({ status: "completed" });
    const manager = createConversationManager();
    const { createAutomationScheduler } = await import("@/lib/automation-scheduler");
    const scheduler = createAutomationScheduler({
      now: () => new Date("2026-04-10T12:00:00.000Z"),
      timeZone: "UTC",
      manager,
      startChatTurn,
      pollIntervalMs: 60_000
    });

    scheduler.start();

    const automation = createAutomation({
      name: "Manual execution",
      prompt: "Run the shared pipeline",
      providerProfileId: "profile_scheduler",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const run = triggerAutomationNow(automation.id);
    if (!run) {
      throw new Error("Expected a queued manual run");
    }
    const completedRun = await waitForRunStatus(run.id, "completed");
    const conversation = getConversation(completedRun.conversationId!);

    scheduler.stop();

    expect(startChatTurn).toHaveBeenCalledWith(
      manager,
      completedRun.conversationId,
      "Run the shared pipeline",
      [],
      undefined
    );
    expect(conversation).toMatchObject({
      automationId: automation.id,
      automationRunId: run.id,
      conversationOrigin: "automation",
      providerProfileId: "profile_scheduler"
    });
  });
});
