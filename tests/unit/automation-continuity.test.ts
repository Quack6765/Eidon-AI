import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAutomation,
  getAutomationRun,
  listAutomationRuns,
  updateAutomation
} from "@/lib/automations";
import { createConversationManager } from "@/lib/conversation-manager";
import { createMessage } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { updateProviderCatalog } from "@/lib/settings";
import { resetAutomationExecutionLimiterForTests } from "@/lib/automation-execution-limiter";
import type { ChatTurnResult } from "@/lib/chat-turn";
import { createProviderProfileInput } from "@/tests/provider-fixtures";

const PROVIDER_PROFILE_ID = "profile_continuity";

function registerProviderProfile() {
  updateProviderCatalog({
    defaultProviderProfileId: PROVIDER_PROFILE_ID,
    skillsEnabled: false,
    providerProfiles: [
      createProviderProfileInput({
        id: PROVIDER_PROFILE_ID,
        name: "Continuity Test",
        model: "gpt-test",
        systemPrompt: "Be exact.",
        temperature: 0.2,
        maxOutputTokens: 512,
        modelContextLimit: 16384,
        freshTailCount: 12,
        visionMode: "none",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      })
    ]
  });
}

async function waitForRunStatus(runId: string, status: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const run = getAutomationRun(runId);
    if (run?.status === status) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out waiting for automation run ${runId} to reach ${status}`);
}

type SchedulerHarness = {
  runOnce: () => Promise<void>;
  setNow: (iso: string) => void;
  startChatTurn: ReturnType<typeof vi.fn>;
};

async function createHarness(): Promise<SchedulerHarness> {
  let currentNow = new Date("2026-04-10T10:40:00.000Z");
  const startChatTurn = vi.fn().mockResolvedValue({ status: "completed" } as ChatTurnResult);
  const { createAutomationScheduler } = await import("@/lib/automation-scheduler");
  const scheduler = createAutomationScheduler({
    get now() {
      return () => currentNow;
    },
    timeZone: "UTC",
    manager: createConversationManager(),
    startChatTurn
  } as never);

  return {
    runOnce: () => scheduler.runOnce(),
    setNow: (iso: string) => {
      currentNow = new Date(iso);
    },
    startChatTurn
  };
}

describe("automation run continuity and templating", () => {
  beforeEach(() => {
    resetAutomationExecutionLimiterForTests();
    registerProviderProfile();
  });

  it("reuses the previous run's conversation when the flag is set", async () => {
    const harness = await createHarness();
    const automation = createAutomation({
      name: "Continuity brief",
      prompt: "Run {{run_number}} on {{date}}.",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: [],
      continuePreviousConversation: true
    });
    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await harness.runOnce();
    const firstRun = (await waitForRunStatus(
      listAutomationRuns(automation.id)[0].id,
      "completed"
    ))!;

    harness.setNow("2026-04-10T10:46:00.000Z");
    await harness.runOnce();
    const runs = listAutomationRuns(automation.id).filter((run) => run.status === "completed");
    expect(runs).toHaveLength(2);
    const secondRun = runs.find((run) => run.id !== firstRun.id)!;

    expect(secondRun.conversationId).toBe(firstRun.conversationId);
    expect(firstRun.conversationId).toBeTruthy();
    expect(harness.startChatTurn).toHaveBeenCalledTimes(2);

    const firstPrompt = harness.startChatTurn.mock.calls[0][2] as string;
    const secondPrompt = harness.startChatTurn.mock.calls[1][2] as string;
    expect(firstPrompt).toBe("Run 1 on 2026-04-10.");
    expect(secondPrompt).toBe("Run 2 on 2026-04-10.");
  });

  it("interpolates {{last_result}} from the previous completed run's answer", async () => {
    const harness = await createHarness();
    const automation = createAutomation({
      name: "Digest brief",
      prompt: "Previous: {{last_result}}",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: [],
      continuePreviousConversation: true
    });
    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await harness.runOnce();
    const firstRun = (await waitForRunStatus(
      listAutomationRuns(automation.id)[0].id,
      "completed"
    ))!;

    createMessage({
      conversationId: firstRun.conversationId!,
      role: "assistant",
      content: "Everything is calm.",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 4
    });

    harness.setNow("2026-04-10T10:46:00.000Z");
    await harness.runOnce();

    const secondPrompt = harness.startChatTurn.mock.calls[1][2] as string;
    expect(secondPrompt).toBe("Previous: Everything is calm.");
  });

  it("falls back to a fresh conversation when the prior conversation was deleted", async () => {
    const harness = await createHarness();
    const automation = createAutomation({
      name: "Resilient brief",
      prompt: "Run.",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: [],
      continuePreviousConversation: true
    });
    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await harness.runOnce();
    const firstRun = (await waitForRunStatus(
      listAutomationRuns(automation.id)[0].id,
      "completed"
    ))!;

    getDb()
      .prepare("DELETE FROM conversations WHERE id = ?")
      .run(firstRun.conversationId!);

    harness.setNow("2026-04-10T10:46:00.000Z");
    await harness.runOnce();
    const runs = listAutomationRuns(automation.id).filter((run) => run.status === "completed");
    const secondRun = runs.find((run) => run.id !== firstRun.id)!;

    expect(secondRun.conversationId).toBeTruthy();
    expect(secondRun.conversationId).not.toBe(firstRun.conversationId);
  });

  it("keeps a fresh conversation per run when the flag is unset", async () => {
    const harness = await createHarness();
    const automation = createAutomation({
      name: "Cold brief",
      prompt: "Run.",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await harness.runOnce();
    await waitForRunStatus(listAutomationRuns(automation.id)[0].id, "completed");

    harness.setNow("2026-04-10T10:46:00.000Z");
    await harness.runOnce();
    const runs = listAutomationRuns(automation.id).filter((run) => run.status === "completed");

    expect(runs).toHaveLength(2);
    expect(runs[0].conversationId).not.toBe(runs[1].conversationId);
    expect(runs[0].conversationId).toBeTruthy();
    expect(runs[1].conversationId).toBeTruthy();
  });

  it("leaves prompts without tokens unchanged", async () => {
    const harness = await createHarness();
    const automation = createAutomation({
      name: "Plain brief",
      prompt: "Static prompt {{unknown}}.",
      providerProfileId: PROVIDER_PROFILE_ID,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await harness.runOnce();
    await waitForRunStatus(listAutomationRuns(automation.id)[0].id, "completed");

    expect(harness.startChatTurn.mock.calls[0][2]).toBe("Static prompt {{unknown}}.");
  });
});
