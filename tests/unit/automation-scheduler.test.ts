import { describe, expect, it, vi } from "vitest";

import {
  createAutomation,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  triggerAutomationNow,
  updateAutomation,
  updateAutomationRunStatus
} from "@/lib/automations";
import { createConversationManager } from "@/lib/conversation-manager";
import { getConversation } from "@/lib/conversations";
import { createPersona } from "@/lib/personas";
import { createLocalUser } from "@/lib/users";
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

  it("calculates the next daily run and rejects invalid schedules", async () => {
    const { getNextAutomationRunAt } = await import("@/lib/automation-scheduler");

    expect(
      getNextAutomationRunAt(
        {
          scheduleKind: "calendar",
          intervalMinutes: null,
          calendarFrequency: "daily",
          timeOfDay: "09:30",
          daysOfWeek: []
        },
        "2026-04-10T10:00:00.000Z",
        "UTC"
      )
    ).toBe("2026-04-11T09:30:00.000Z");

    expect(() =>
      getNextAutomationRunAt(
        {
          scheduleKind: "interval",
          intervalMinutes: null,
          calendarFrequency: null,
          timeOfDay: null,
          daysOfWeek: []
        },
        "2026-04-10T10:00:00.000Z",
        "UTC"
      )
    ).toThrow("Interval automations require interval minutes");

    expect(() =>
      getNextAutomationRunAt(
        {
          scheduleKind: "calendar",
          intervalMinutes: null,
          calendarFrequency: "daily",
          timeOfDay: null,
          daysOfWeek: []
        },
        "2026-04-10T10:00:00.000Z",
        "UTC"
      )
    ).toThrow("Calendar automations require a time of day");
  });

  it("skips the current weekday when a weekly run time has already passed", async () => {
    const { getNextAutomationRunAt } = await import("@/lib/automation-scheduler");

    expect(
      getNextAutomationRunAt(
        {
          scheduleKind: "calendar",
          intervalMinutes: null,
          calendarFrequency: "weekly",
          timeOfDay: "09:30",
          daysOfWeek: [1, 3]
        },
        "2026-04-13T14:00:00.000Z",
        "America/Toronto"
      )
    ).toBe("2026-04-15T13:30:00.000Z");
  });

  it("throws when a weekly schedule has no eligible weekdays", async () => {
    const { getNextAutomationRunAt } = await import("@/lib/automation-scheduler");

    expect(() =>
      getNextAutomationRunAt(
        {
          scheduleKind: "calendar",
          intervalMinutes: null,
          calendarFrequency: "weekly",
          timeOfDay: "09:30",
          daysOfWeek: []
        },
        "2026-04-10T10:00:00.000Z",
        "UTC"
      )
    ).toThrow("Unable to compute next weekly automation run");
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

  it("creates manual automation conversations for the owning user", async () => {
    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });
    const userA = await createLocalUser({
      username: "scheduler-owner-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "scheduler-owner-b",
      password: "Password123!",
      role: "user"
    });

    const automation = createAutomation(
      {
        name: "Owned automation",
        prompt: "Run privately",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 15,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: []
      },
      userA.id
    );

    const completedRun = await runAutomationNow(automation.id, {
      manager: createConversationManager(),
      startChatTurn: vi.fn().mockResolvedValue({ status: "completed" })
    });
    if (!completedRun?.conversationId) {
      throw new Error("Expected a manual run with a conversation");
    }

    expect(getConversation(completedRun.conversationId!, userA.id)?.conversationOrigin).toBe("automation");
    expect(getConversation(completedRun.conversationId!, userB.id)).toBeNull();
  });

  it("reuses the same in-flight run cycle for concurrent runOnce calls", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const control: { releaseRun: (() => void) | null } = { releaseRun: null };
    const startChatTurn = vi
      .fn<(
        manager: ReturnType<typeof createConversationManager>,
        conversationId: string,
        content: string,
        attachmentIds: string[],
        personaId?: string
        ) => Promise<ChatTurnResult>>()
      .mockImplementation(
        () =>
          new Promise<ChatTurnResult>((resolve) => {
            control.releaseRun = () => resolve({ status: "completed" });
          })
      );
    const manager = createConversationManager();
    const { createAutomationScheduler } = await import("@/lib/automation-scheduler");
    const scheduler = createAutomationScheduler({
      now: () => new Date("2026-04-10T12:00:00.000Z"),
      timeZone: "UTC",
      manager,
      startChatTurn
    });

    const automation = createAutomation({
      name: "Concurrent cycle",
      prompt: "Run once",
      providerProfileId: "profile_scheduler",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    updateAutomation(automation.id, { nextRunAt: "2026-04-10T12:00:00.000Z" });

    const firstRun = scheduler.runOnce();
    const secondRun = scheduler.runOnce();

    expect(startChatTurn).toHaveBeenCalledTimes(1);
    if (!control.releaseRun) {
      throw new Error("Expected the run to block before completion");
    }
    control.releaseRun();

    await Promise.all([firstRun, secondRun]);
    expect(listAutomationRuns(automation.id)[0]?.status).toBe("completed");
  });

  it("wakes at the exact next due time instead of waiting for the full poll interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T13:04:00.000Z"));
    let scheduler: { start: () => void; stop: () => void } | null = null;

    try {
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
      scheduler = createAutomationScheduler({
        now: () => new Date(),
        timeZone: "America/Toronto",
        manager,
        startChatTurn,
        pollIntervalMs: 5 * 60_000
      });

      scheduler.start();

      createAutomation({
        name: "Morning summary",
        prompt: "Summarize priorities",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "daily",
        timeOfDay: "09:05",
        daysOfWeek: []
      });

      await vi.runAllTicks();
      expect(startChatTurn).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);

      expect(startChatTurn).toHaveBeenCalledTimes(1);
    } finally {
      scheduler?.stop();
      vi.useRealTimers();
    }
  });

  it("resyncs future next-run timestamps to the scheduler timezone without touching overdue or disabled work", async () => {
    const previousTz = process.env.TZ;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T13:04:00.000Z"));

    try {
      const { updateSettings } = await import("@/lib/settings");
      updateSettings({
        defaultProviderProfileId: "profile_scheduler",
        skillsEnabled: false,
        providerProfiles: [createProviderProfile()]
      });

      process.env.TZ = "UTC";
      const futureMismatch = createAutomation({
        name: "Future mismatch",
        prompt: "Summarize priorities",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "daily",
        timeOfDay: "09:05",
        daysOfWeek: []
      });

      process.env.TZ = "America/Toronto";
      const futureAligned = createAutomation({
        name: "Future aligned",
        prompt: "Summarize priorities",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "daily",
        timeOfDay: "09:05",
        daysOfWeek: []
      });

      const overdue = createAutomation({
        name: "Overdue run",
        prompt: "Summarize priorities",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 5,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: []
      });

      const disabled = createAutomation({
        name: "Disabled run",
        prompt: "Summarize priorities",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "daily",
        timeOfDay: "09:05",
        daysOfWeek: [],
        enabled: false
      });

      updateAutomation(overdue.id, { nextRunAt: "2026-04-10T13:00:00.000Z" });

      const expectedTorontoRun = "2026-04-10T13:05:00.000Z";
      expect(getAutomation(futureMismatch.id)?.nextRunAt).not.toBe(expectedTorontoRun);
      expect(getAutomation(futureAligned.id)?.nextRunAt).toBe(expectedTorontoRun);
      expect(getAutomation(disabled.id)?.nextRunAt).toBeNull();

      const { createAutomationScheduler } = await import("@/lib/automation-scheduler");
      const scheduler = createAutomationScheduler({
        now: () => new Date("2026-04-10T13:04:00.000Z"),
        timeZone: "America/Toronto",
        manager: createConversationManager(),
        startChatTurn: vi.fn().mockResolvedValue({ status: "completed" })
      });

      await scheduler.runOnce();

      expect(getAutomation(futureMismatch.id)?.nextRunAt).toBe(expectedTorontoRun);
      expect(getAutomation(futureAligned.id)?.nextRunAt).toBe(expectedTorontoRun);
      expect(
        listAutomationRuns(overdue.id).some((run) => run.scheduledFor === "2026-04-10T13:00:00.000Z")
      ).toBe(true);
      expect(getAutomation(disabled.id)?.nextRunAt).toBeNull();
    } finally {
      vi.useRealTimers();
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it("does not schedule another timer after being stopped mid-cycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T13:04:00.000Z"));

    const control: { releaseRun: (() => void) | null } = { releaseRun: null };
    let scheduler: { start: () => void; stop: () => void } | null = null;

    try {
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
        .mockImplementation(
          () =>
            new Promise<ChatTurnResult>((resolve) => {
              control.releaseRun = () => resolve({ status: "completed" });
            })
        );
      const manager = createConversationManager();
      const { createAutomationScheduler } = await import("@/lib/automation-scheduler");
      scheduler = createAutomationScheduler({
        now: () => new Date(),
        timeZone: "America/Toronto",
        manager,
        startChatTurn,
        pollIntervalMs: 5 * 60_000
      });

      scheduler.start();

      createAutomation({
        name: "Stop mid-cycle",
        prompt: "Summarize priorities",
        providerProfileId: "profile_scheduler",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "daily",
        timeOfDay: "09:05",
        daysOfWeek: []
      });

      await vi.advanceTimersByTimeAsync(60_000);
      expect(startChatTurn).toHaveBeenCalledTimes(1);

      scheduler.stop();
      if (!control.releaseRun) {
        throw new Error("Expected the in-flight run to wait for release");
      }
      control.releaseRun();
      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(startChatTurn).toHaveBeenCalledTimes(1);
    } finally {
      scheduler?.stop();
      vi.useRealTimers();
    }
  });

  it("returns null when manually running a missing automation or retrying a missing run", async () => {
    const { retryAutomationRunNow, runAutomationNow } = await import("@/lib/automation-scheduler");

    await expect(runAutomationNow("auto_missing")).resolves.toBeNull();
    await expect(retryAutomationRunNow("run_missing")).resolves.toBeNull();
  });

  it("fails manual runs when the provider profile is missing", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const startChatTurn = vi.fn();
    const manager = createConversationManager();
    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const automation = createAutomation({
      name: "Missing provider",
      prompt: "Use the missing provider",
      providerProfileId: "profile_missing",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const run = await runAutomationNow(automation.id, {
      now: () => new Date("2026-04-10T12:00:00.000Z"),
      manager,
      startChatTurn
    });

    expect(run).toMatchObject({
      status: "failed",
      errorMessage: "Provider profile not found"
    });
    expect(startChatTurn).not.toHaveBeenCalled();
  });

  it("fails manual runs when the configured persona is missing", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const startChatTurn = vi.fn();
    const manager = createConversationManager();
    const { runAutomationNow } = await import("@/lib/automation-scheduler");
    const persona = createPersona({ name: "Ops", content: "Be exact." });
    const automation = createAutomation({
      name: "Missing persona",
      prompt: "Use the missing persona",
      providerProfileId: "profile_scheduler",
      personaId: persona.id,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    updateAutomation(automation.id, { personaId: "persona_missing" });

    const run = await runAutomationNow(automation.id, {
      now: () => new Date("2026-04-10T12:00:00.000Z"),
      manager,
      startChatTurn
    });

    expect(run).toMatchObject({
      status: "failed",
      errorMessage: "Persona not found"
    });
    expect(startChatTurn).not.toHaveBeenCalled();
  });

  it("fails queued work when another run is already active and marks due slots missed", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const startChatTurn = vi.fn();
    const manager = createConversationManager();
    const { createAutomationScheduler, runAutomationNow } = await import("@/lib/automation-scheduler");
    const scheduler = createAutomationScheduler({
      now: () => new Date("2026-04-10T10:40:00.000Z"),
      timeZone: "UTC",
      manager,
      startChatTurn
    });

    const automation = createAutomation({
      name: "Overlap automation",
      prompt: "Process the queue",
      providerProfileId: "profile_scheduler",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const runningRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-10T09:55:00.000Z",
      triggerSource: "manual_run"
    });
    updateAutomationRunStatus(runningRun.id, {
      status: "running",
      startedAt: "2026-04-10T09:55:30.000Z"
    });

    const manualRun = await runAutomationNow(automation.id, {
      now: () => new Date("2026-04-10T10:40:00.000Z"),
      manager,
      startChatTurn
    });

    expect(manualRun).toMatchObject({
      status: "failed",
      errorMessage: "Automation already has a running job"
    });

    updateAutomation(automation.id, { nextRunAt: "2026-04-10T10:00:00.000Z" });

    await scheduler.runOnce();

    expect(startChatTurn).not.toHaveBeenCalled();
    expect(getAutomation(automation.id)?.nextRunAt).toBe("2026-04-10T10:45:00.000Z");
    expect(listAutomationRuns(automation.id).map((run) => ({
      scheduledFor: run.scheduledFor,
      status: run.status
    }))).toEqual([
      { scheduledFor: "2026-04-10T10:40:00.000Z", status: "failed" },
      { scheduledFor: "2026-04-10T10:30:00.000Z", status: "missed" },
      { scheduledFor: "2026-04-10T10:15:00.000Z", status: "missed" },
      { scheduledFor: "2026-04-10T10:00:00.000Z", status: "missed" },
      { scheduledFor: "2026-04-10T09:55:00.000Z", status: "running" }
    ]);
  });

  it("records stopped, thrown, and manual retry runs", async () => {
    const { updateSettings } = await import("@/lib/settings");
    updateSettings({
      defaultProviderProfileId: "profile_scheduler",
      skillsEnabled: false,
      providerProfiles: [createProviderProfile()]
    });

    const manager = createConversationManager();
    const { retryAutomationRunNow, runAutomationNow } = await import("@/lib/automation-scheduler");
    const automation = createAutomation({
      name: "Retry automation",
      prompt: "Run the pipeline",
      providerProfileId: "profile_scheduler",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const stoppedRun = await runAutomationNow(automation.id, {
      now: () => new Date("2026-04-10T12:00:00.000Z"),
      manager,
      startChatTurn: vi.fn().mockResolvedValue({ status: "stopped" })
    });

    const failedRun = await runAutomationNow(automation.id, {
      now: () => new Date("2026-04-10T12:05:00.000Z"),
      manager,
      startChatTurn: vi.fn().mockRejectedValue(new Error("scheduler exploded"))
    });

    const retriedRun = await retryAutomationRunNow(failedRun!.id, {
      now: () => new Date("2026-04-10T12:10:00.000Z"),
      manager,
      startChatTurn: vi.fn().mockResolvedValue({ status: "completed" })
    });

    expect(stoppedRun).toMatchObject({ status: "stopped" });
    expect(failedRun).toMatchObject({
      status: "failed",
      errorMessage: "scheduler exploded"
    });
    expect(retriedRun).toMatchObject({
      status: "completed",
      triggerSource: "manual_retry"
    });
  });
});
