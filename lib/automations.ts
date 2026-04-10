import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type {
  Automation,
  AutomationCalendarFrequency,
  AutomationRun,
  AutomationRunStatus,
  AutomationScheduleKind,
  AutomationTriggerSource
} from "@/lib/types";

type AutomationRow = {
  id: string;
  name: string;
  prompt: string;
  provider_profile_id: string;
  persona_id: string | null;
  schedule_kind: AutomationScheduleKind;
  interval_minutes: number | null;
  calendar_frequency: AutomationCalendarFrequency | null;
  time_of_day: string | null;
  days_of_week: string;
  enabled: number;
  next_run_at: string | null;
  last_scheduled_for: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_status: Automation["lastStatus"];
  created_at: string;
  updated_at: string;
};

type AutomationRunRow = {
  id: string;
  automation_id: string;
  conversation_id: string | null;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  status: AutomationRunStatus;
  error_message: string | null;
  trigger_source: AutomationTriggerSource;
  created_at: string;
};

type ScheduleInput = {
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
};

type CreateAutomationInput = Omit<
  Automation,
  | "id"
  | "enabled"
  | "nextRunAt"
  | "lastScheduledFor"
  | "lastStartedAt"
  | "lastFinishedAt"
  | "lastStatus"
  | "createdAt"
  | "updatedAt"
>;

type UpdateAutomationInput = Partial<
  Omit<Automation, "id" | "createdAt" | "updatedAt">
>;

type UpdateAutomationRunStatusInput = {
  status: AutomationRunStatus;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function parseDaysOfWeek(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((day): day is number => Number.isInteger(day));
  } catch {
    return [];
  }
}

function normalizeDaysOfWeek(daysOfWeek: number[]) {
  return [...new Set(daysOfWeek)].sort((left, right) => left - right);
}

function assertValidTimeOfDay(timeOfDay: string | null) {
  if (!timeOfDay) {
    throw new Error("Calendar automations require a time of day");
  }

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
    throw new Error("Calendar automations require time in HH:MM format");
  }
}

function assertValidDaysOfWeek(daysOfWeek: number[]) {
  if (daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Weekly automations require weekdays between 0 and 6");
  }
}

function assertValidSchedule(input: ScheduleInput) {
  const daysOfWeek = normalizeDaysOfWeek(input.daysOfWeek);

  if (input.scheduleKind === "interval") {
    if (!input.intervalMinutes || input.intervalMinutes < 5) {
      throw new Error("Interval automations must be at least 5 minutes");
    }

    return;
  }

  assertValidTimeOfDay(input.timeOfDay);

  if (!input.calendarFrequency) {
    throw new Error("Calendar automations require a calendar frequency");
  }

  if (input.calendarFrequency === "weekly") {
    assertValidDaysOfWeek(daysOfWeek);

    if (daysOfWeek.length === 0) {
      throw new Error("Weekly automations require at least one weekday");
    }
  }
}

function rowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    providerProfileId: row.provider_profile_id,
    personaId: row.persona_id,
    scheduleKind: row.schedule_kind,
    intervalMinutes: row.interval_minutes,
    calendarFrequency: row.calendar_frequency,
    timeOfDay: row.time_of_day,
    daysOfWeek: parseDaysOfWeek(row.days_of_week),
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at,
    lastScheduledFor: row.last_scheduled_for,
    lastStartedAt: row.last_started_at,
    lastFinishedAt: row.last_finished_at,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToAutomationRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    conversationId: row.conversation_id,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    errorMessage: row.error_message,
    triggerSource: row.trigger_source,
    createdAt: row.created_at
  };
}

function getAutomationRun(runId: string) {
  const row = getDb()
    .prepare(
      `SELECT
        id,
        automation_id,
        conversation_id,
        scheduled_for,
        started_at,
        finished_at,
        status,
        error_message,
        trigger_source,
        created_at
       FROM automation_runs
       WHERE id = ?`
    )
    .get(runId) as AutomationRunRow | undefined;

  return row ? rowToAutomationRun(row) : null;
}

export function createAutomation(input: CreateAutomationInput) {
  const daysOfWeek = normalizeDaysOfWeek(input.daysOfWeek);

  assertValidSchedule({
    scheduleKind: input.scheduleKind,
    intervalMinutes: input.intervalMinutes,
    calendarFrequency: input.calendarFrequency,
    timeOfDay: input.timeOfDay,
    daysOfWeek
  });

  const timestamp = nowIso();
  const automation: Automation = {
    id: createId("auto"),
    name: input.name.trim(),
    prompt: input.prompt,
    providerProfileId: input.providerProfileId,
    personaId: input.personaId,
    scheduleKind: input.scheduleKind,
    intervalMinutes: input.intervalMinutes,
    calendarFrequency: input.calendarFrequency,
    timeOfDay: input.timeOfDay,
    daysOfWeek,
    enabled: true,
    nextRunAt: null,
    lastScheduledFor: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO automations (
        id,
        name,
        prompt,
        provider_profile_id,
        persona_id,
        schedule_kind,
        interval_minutes,
        calendar_frequency,
        time_of_day,
        days_of_week,
        enabled,
        next_run_at,
        last_scheduled_for,
        last_started_at,
        last_finished_at,
        last_status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      automation.id,
      automation.name,
      automation.prompt,
      automation.providerProfileId,
      automation.personaId,
      automation.scheduleKind,
      automation.intervalMinutes,
      automation.calendarFrequency,
      automation.timeOfDay,
      JSON.stringify(automation.daysOfWeek),
      automation.enabled ? 1 : 0,
      automation.nextRunAt,
      automation.lastScheduledFor,
      automation.lastStartedAt,
      automation.lastFinishedAt,
      automation.lastStatus,
      automation.createdAt,
      automation.updatedAt
    );

  return automation;
}

export function createAutomationRun(input: {
  automationId: string;
  scheduledFor: string;
  triggerSource: AutomationTriggerSource;
}) {
  const run: AutomationRun = {
    id: createId("run"),
    automationId: input.automationId,
    conversationId: null,
    scheduledFor: input.scheduledFor,
    startedAt: null,
    finishedAt: null,
    status: "queued",
    errorMessage: null,
    triggerSource: input.triggerSource,
    createdAt: nowIso()
  };

  getDb()
    .prepare(
      `INSERT INTO automation_runs (
        id,
        automation_id,
        conversation_id,
        scheduled_for,
        started_at,
        finished_at,
        status,
        error_message,
        trigger_source,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      run.id,
      run.automationId,
      run.conversationId,
      run.scheduledFor,
      run.startedAt,
      run.finishedAt,
      run.status,
      run.errorMessage,
      run.triggerSource,
      run.createdAt
    );

  getDb()
    .prepare(
      `UPDATE automations
       SET last_scheduled_for = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(run.scheduledFor, run.createdAt, run.automationId);

  return run;
}

export function listAutomations(): Automation[] {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        name,
        prompt,
        provider_profile_id,
        persona_id,
        schedule_kind,
        interval_minutes,
        calendar_frequency,
        time_of_day,
        days_of_week,
        enabled,
        next_run_at,
        last_scheduled_for,
        last_started_at,
        last_finished_at,
        last_status,
        created_at,
        updated_at
       FROM automations
       ORDER BY updated_at DESC, id DESC`
    )
    .all() as AutomationRow[];

  return rows.map(rowToAutomation);
}

export function getAutomation(id: string) {
  const row = getDb()
    .prepare(
      `SELECT
        id,
        name,
        prompt,
        provider_profile_id,
        persona_id,
        schedule_kind,
        interval_minutes,
        calendar_frequency,
        time_of_day,
        days_of_week,
        enabled,
        next_run_at,
        last_scheduled_for,
        last_started_at,
        last_finished_at,
        last_status,
        created_at,
        updated_at
       FROM automations
       WHERE id = ?`
    )
    .get(id) as AutomationRow | undefined;

  return row ? rowToAutomation(row) : null;
}

export function updateAutomation(id: string, patch: UpdateAutomationInput) {
  const current = getAutomation(id);
  if (!current) return null;

  const next: Automation = {
    ...current,
    ...patch,
    name: patch.name?.trim() ?? current.name,
    daysOfWeek: patch.daysOfWeek ? normalizeDaysOfWeek(patch.daysOfWeek) : current.daysOfWeek,
    updatedAt: nowIso()
  };

  assertValidSchedule({
    scheduleKind: next.scheduleKind,
    intervalMinutes: next.intervalMinutes,
    calendarFrequency: next.calendarFrequency,
    timeOfDay: next.timeOfDay,
    daysOfWeek: next.daysOfWeek
  });

  getDb()
    .prepare(
      `UPDATE automations
       SET name = ?,
           prompt = ?,
           provider_profile_id = ?,
           persona_id = ?,
           schedule_kind = ?,
           interval_minutes = ?,
           calendar_frequency = ?,
           time_of_day = ?,
           days_of_week = ?,
           enabled = ?,
           next_run_at = ?,
           last_scheduled_for = ?,
           last_started_at = ?,
           last_finished_at = ?,
           last_status = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.name,
      next.prompt,
      next.providerProfileId,
      next.personaId,
      next.scheduleKind,
      next.intervalMinutes,
      next.calendarFrequency,
      next.timeOfDay,
      JSON.stringify(next.daysOfWeek),
      next.enabled ? 1 : 0,
      next.nextRunAt,
      next.lastScheduledFor,
      next.lastStartedAt,
      next.lastFinishedAt,
      next.lastStatus,
      next.updatedAt,
      id
    );

  return getAutomation(id);
}

export function listAutomationRuns(automationId: string): AutomationRun[] {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        automation_id,
        conversation_id,
        scheduled_for,
        started_at,
        finished_at,
        status,
        error_message,
        trigger_source,
        created_at
       FROM automation_runs
       WHERE automation_id = ?
       ORDER BY scheduled_for DESC, created_at DESC, id DESC`
    )
    .all(automationId) as AutomationRunRow[];

  return rows.map(rowToAutomationRun);
}

export function attachConversationToRun(runId: string, conversationId: string) {
  getDb()
    .prepare(
      `UPDATE automation_runs
       SET conversation_id = ?
       WHERE id = ?`
    )
    .run(conversationId, runId);
}

export function updateAutomationRunStatus(runId: string, input: UpdateAutomationRunStatusInput) {
  const currentRun = getAutomationRun(runId);
  if (!currentRun) return null;

  const nextStartedAt = input.startedAt ?? currentRun.startedAt;
  const nextFinishedAt = input.finishedAt ?? currentRun.finishedAt;
  const nextErrorMessage = input.errorMessage ?? null;
  const updatedAt = nowIso();

  const updateRun = getDb().prepare(
    `UPDATE automation_runs
     SET status = ?,
         error_message = ?,
         started_at = ?,
         finished_at = ?
     WHERE id = ?`
  );
  const updateAutomationStmt = getDb().prepare(
    `UPDATE automations
     SET last_started_at = ?,
         last_finished_at = ?,
         last_status = ?,
         updated_at = ?
     WHERE id = ?`
  );

  getDb().transaction(() => {
    updateRun.run(
      input.status,
      nextErrorMessage,
      nextStartedAt,
      nextFinishedAt,
      runId
    );
    updateAutomationStmt.run(
      nextStartedAt,
      nextFinishedAt,
      input.status,
      updatedAt,
      currentRun.automationId
    );
  })();

  return getAutomationRun(runId);
}

export function listDueAutomations(nowIsoString: string): Automation[] {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        name,
        prompt,
        provider_profile_id,
        persona_id,
        schedule_kind,
        interval_minutes,
        calendar_frequency,
        time_of_day,
        days_of_week,
        enabled,
        next_run_at,
        last_scheduled_for,
        last_started_at,
        last_finished_at,
        last_status,
        created_at,
        updated_at
       FROM automations
       WHERE enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?
       ORDER BY next_run_at ASC, id ASC`
    )
    .all(nowIsoString) as AutomationRow[];

  return rows.map(rowToAutomation);
}
