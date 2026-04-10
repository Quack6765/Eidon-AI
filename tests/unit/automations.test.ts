import { getDb } from "@/lib/db";
import {
  attachConversationToRun,
  createAutomation,
  createAutomationRun,
  getAutomation,
  listDueAutomations,
  listAutomationRuns,
  listAutomations,
  updateAutomationRunStatus,
  updateAutomation
} from "@/lib/automations";

describe("automations schema", () => {
  it("creates automations tables and automation conversation columns", () => {
    const db = getDb();

    const automationCols = db.prepare("PRAGMA table_info(automations)").all() as Array<{
      name: string;
    }>;
    const runCols = db.prepare("PRAGMA table_info(automation_runs)").all() as Array<{
      name: string;
    }>;
    const conversationCols = db.prepare("PRAGMA table_info(conversations)").all() as Array<{
      name: string;
    }>;

    expect(automationCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["prompt", "schedule_kind", "next_run_at", "enabled"])
    );
    expect(runCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["automation_id", "conversation_id", "scheduled_for", "status"])
    );
    expect(conversationCols.map((col) => col.name)).toEqual(
      expect.arrayContaining(["automation_id", "automation_run_id", "conversation_origin"])
    );
  });
});

describe("automations storage", () => {
  it("creates interval automations with a minimum of 5 minutes", () => {
    expect(() =>
      createAutomation({
        name: "Too fast",
        prompt: "Ping",
        providerProfileId: "profile_default",
        personaId: null,
        scheduleKind: "interval",
        intervalMinutes: 4,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: []
      })
    ).toThrow("Interval automations must be at least 5 minutes");
  });

  it("creates an automation and a linked run record", () => {
    const automation = createAutomation({
      name: "Morning summary",
      prompt: "Summarize priorities",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T13:00:00.000Z",
      triggerSource: "schedule"
    });

    expect(listAutomations()[0]?.name).toBe("Morning summary");
    expect(listAutomationRuns(automation.id)[0]?.id).toBe(run.id);
  });

  it("updates automation schedule fields and persists them", () => {
    const automation = createAutomation({
      name: "Weekly sync",
      prompt: "Prepare agenda",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "weekly",
      timeOfDay: "09:30",
      daysOfWeek: [1, 3]
    });

    const updated = updateAutomation(automation.id, {
      name: "Weekly leadership sync",
      timeOfDay: "10:15",
      daysOfWeek: [2, 4],
      nextRunAt: "2026-04-10T14:15:00.000Z",
      enabled: false
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("Weekly leadership sync");
    expect(updated?.timeOfDay).toBe("10:15");
    expect(updated?.daysOfWeek).toEqual([2, 4]);
    expect(updated?.nextRunAt).toBe("2026-04-10T14:15:00.000Z");
    expect(updated?.enabled).toBe(false);
  });

  it("requires weekly calendar automations to define weekdays and a time", () => {
    expect(() =>
      createAutomation({
        name: "Weekly without time",
        prompt: "Prompt",
        providerProfileId: "profile_default",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "weekly",
        timeOfDay: null,
        daysOfWeek: [1]
      })
    ).toThrow("Calendar automations require a time of day");

    expect(() =>
      createAutomation({
        name: "Weekly without days",
        prompt: "Prompt",
        providerProfileId: "profile_default",
        personaId: null,
        scheduleKind: "calendar",
        intervalMinutes: null,
        calendarFrequency: "weekly",
        timeOfDay: "09:00",
        daysOfWeek: []
      })
    ).toThrow("Weekly automations require at least one weekday");
  });

  it("lists due automations and updates run lifecycle records", () => {
    const db = getDb();
    db.prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run("conv_test", "Automation conversation", "2026-04-09T12:00:00.000Z", "2026-04-09T12:00:00.000Z");

    const dueAutomation = createAutomation({
      name: "Due automation",
      prompt: "Run now",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 10,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    const laterAutomation = createAutomation({
      name: "Later automation",
      prompt: "Run later",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 30,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    updateAutomation(dueAutomation.id, { nextRunAt: "2026-04-09T12:00:00.000Z" });
    updateAutomation(laterAutomation.id, { nextRunAt: "2026-04-09T14:00:00.000Z" });

    const run = createAutomationRun({
      automationId: dueAutomation.id,
      scheduledFor: "2026-04-09T12:00:00.000Z",
      triggerSource: "manual_run"
    });

    attachConversationToRun(run.id, "conv_test");
    updateAutomationRunStatus(run.id, {
      status: "completed",
      startedAt: "2026-04-09T12:00:10.000Z",
      finishedAt: "2026-04-09T12:01:00.000Z"
    });

    expect(listDueAutomations("2026-04-09T13:00:00.000Z").map((automation) => automation.id)).toEqual([
      dueAutomation.id
    ]);

    const updatedAutomation = getAutomation(dueAutomation.id);
    const updatedRun = listAutomationRuns(dueAutomation.id)[0];

    expect(updatedRun?.conversationId).toBe("conv_test");
    expect(updatedRun?.status).toBe("completed");
    expect(updatedRun?.startedAt).toBe("2026-04-09T12:00:10.000Z");
    expect(updatedRun?.finishedAt).toBe("2026-04-09T12:01:00.000Z");
    expect(updatedAutomation?.lastStatus).toBe("completed");
    expect(updatedAutomation?.lastStartedAt).toBe("2026-04-09T12:00:10.000Z");
    expect(updatedAutomation?.lastFinishedAt).toBe("2026-04-09T12:01:00.000Z");
  });

  it("does not let older run updates regress the parent automation summary", () => {
    const automation = createAutomation({
      name: "Out of order runs",
      prompt: "Prompt",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const olderRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T12:00:00.000Z",
      triggerSource: "schedule"
    });
    const newerRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T13:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(newerRun.id, {
      status: "completed",
      startedAt: "2026-04-09T13:00:05.000Z",
      finishedAt: "2026-04-09T13:01:00.000Z"
    });
    updateAutomationRunStatus(olderRun.id, {
      status: "failed",
      startedAt: "2026-04-09T12:00:05.000Z",
      finishedAt: "2026-04-09T12:01:00.000Z",
      errorMessage: "older run failed"
    });

    const updatedAutomation = getAutomation(automation.id);

    expect(updatedAutomation?.lastScheduledFor).toBe("2026-04-09T13:00:00.000Z");
    expect(updatedAutomation?.lastStatus).toBe("completed");
    expect(updatedAutomation?.lastStartedAt).toBe("2026-04-09T13:00:05.000Z");
    expect(updatedAutomation?.lastFinishedAt).toBe("2026-04-09T13:01:00.000Z");
  });

  it("preserves an existing run error message unless null is passed explicitly", () => {
    const automation = createAutomation({
      name: "Preserve error",
      prompt: "Prompt",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 15,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });

    const run = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T13:00:00.000Z",
      triggerSource: "schedule"
    });

    updateAutomationRunStatus(run.id, {
      status: "failed",
      errorMessage: "network timeout"
    });
    updateAutomationRunStatus(run.id, {
      status: "running",
      startedAt: "2026-04-09T13:00:05.000Z"
    });

    expect(listAutomationRuns(automation.id)[0]?.errorMessage).toBe("network timeout");

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-04-09T13:01:00.000Z",
      errorMessage: null
    });

    expect(listAutomationRuns(automation.id)[0]?.errorMessage).toBeNull();
  });

  it("clears incompatible schedule fields when changing schedule kinds", () => {
    const automation = createAutomation({
      name: "Schedule transitions",
      prompt: "Prompt",
      providerProfileId: "profile_default",
      personaId: null,
      scheduleKind: "calendar",
      intervalMinutes: null,
      calendarFrequency: "weekly",
      timeOfDay: "08:30",
      daysOfWeek: [1, 4]
    });

    const intervalAutomation = updateAutomation(automation.id, {
      scheduleKind: "interval",
      intervalMinutes: 20
    });

    expect(intervalAutomation?.scheduleKind).toBe("interval");
    expect(intervalAutomation?.intervalMinutes).toBe(20);
    expect(intervalAutomation?.calendarFrequency).toBeNull();
    expect(intervalAutomation?.timeOfDay).toBeNull();
    expect(intervalAutomation?.daysOfWeek).toEqual([]);

    const dailyAutomation = updateAutomation(automation.id, {
      scheduleKind: "calendar",
      calendarFrequency: "daily",
      timeOfDay: "10:45"
    });

    expect(dailyAutomation?.scheduleKind).toBe("calendar");
    expect(dailyAutomation?.calendarFrequency).toBe("daily");
    expect(dailyAutomation?.timeOfDay).toBe("10:45");
    expect(dailyAutomation?.intervalMinutes).toBeNull();
    expect(dailyAutomation?.daysOfWeek).toEqual([]);
  });
});
