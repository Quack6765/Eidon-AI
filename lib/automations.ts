import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { getNextAutomationRunAt } from "@/lib/automation-schedule";
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

type CreateAutomationInput = {
  name: string;
  prompt: string;
  providerProfileId: string;
  personaId: string | null;
  scheduleKind: AutomationScheduleKind;
  intervalMinutes: number | null;
  calendarFrequency: AutomationCalendarFrequency | null;
  timeOfDay: string | null;
  daysOfWeek: number[];
  enabled?: boolean;
};

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

function normalizeAutomationSchedule(input: Automation): Automation {
  const daysOfWeek = normalizeDaysOfWeek(input.daysOfWeek);

  if (input.scheduleKind === "interval") {
    return {
      ...input,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    };
  }

  if (input.calendarFrequency === "daily") {
    return {
      ...input,
      intervalMinutes: null,
      daysOfWeek: []
    };
  }

  return {
    ...input,
    intervalMinutes: null,
    daysOfWeek
  };
}

function shouldRecomputeNextRunAt(
  current: Automation,
  next: Automation,
  patch: UpdateAutomationInput
) {
  if ("nextRunAt" in patch) {
    return false;
  }

  if (!next.enabled) {
    return false;
  }

  if (current.nextRunAt === null) {
    return true;
  }

  return (
    patch.enabled !== undefined ||
    patch.scheduleKind !== undefined ||
    patch.intervalMinutes !== undefined ||
    patch.calendarFrequency !== undefined ||
    patch.timeOfDay !== undefined ||
    patch.daysOfWeek !== undefined
  );
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

export function getAutomationRun(runId: string, userId?: string) {
  const row = (userId
    ? getDb()
        .prepare(
          `SELECT
            r.id,
            r.automation_id,
            r.conversation_id,
            r.scheduled_for,
            r.started_at,
            r.finished_at,
            r.status,
            r.error_message,
            r.trigger_source,
            r.created_at
           FROM automation_runs r
           JOIN automations a ON a.id = r.automation_id
           WHERE r.id = ? AND a.user_id = ?`
        )
        .get(runId, userId)
    : getDb()
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
        .get(runId)) as AutomationRunRow | undefined;

  return row ? rowToAutomationRun(row) : null;
}

export function getAutomationOwnerId(automationId: string) {
  const row = getDb()
    .prepare("SELECT user_id FROM automations WHERE id = ?")
    .get(automationId) as { user_id: string | null } | undefined;

  return row?.user_id ?? null;
}

function getLatestAutomationRun(automationId: string) {
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
       WHERE automation_id = ?
       ORDER BY scheduled_for DESC, created_at DESC, id DESC
       LIMIT 1`
    )
    .get(automationId) as AutomationRunRow | undefined;

  return row ? rowToAutomationRun(row) : null;
}

function refreshAutomationRunSummary(automationId: string, updatedAt: string) {
  const latestRun = getLatestAutomationRun(automationId);

  getDb()
    .prepare(
      `UPDATE automations
       SET last_scheduled_for = ?,
           last_started_at = ?,
           last_finished_at = ?,
           last_status = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      latestRun?.scheduledFor ?? null,
      latestRun?.startedAt ?? null,
      latestRun?.finishedAt ?? null,
      latestRun?.status ?? null,
      updatedAt,
      automationId
    );
}

export function createAutomation(input: CreateAutomationInput, userId?: string) {
  const timestamp = nowIso();
  const automation = normalizeAutomationSchedule({
    id: createId("auto"),
    name: input.name.trim(),
    prompt: input.prompt,
    providerProfileId: input.providerProfileId,
    personaId: input.personaId,
    scheduleKind: input.scheduleKind,
    intervalMinutes: input.intervalMinutes,
    calendarFrequency: input.calendarFrequency,
    timeOfDay: input.timeOfDay,
    daysOfWeek: input.daysOfWeek,
    enabled: input.enabled ?? true,
    nextRunAt: null,
    lastScheduledFor: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  assertValidSchedule({
    scheduleKind: automation.scheduleKind,
    intervalMinutes: automation.intervalMinutes,
    calendarFrequency: automation.calendarFrequency,
    timeOfDay: automation.timeOfDay,
    daysOfWeek: automation.daysOfWeek
  });

  const nextRunAt = automation.enabled
    ? getNextAutomationRunAt(automation, timestamp, env.TZ)
    : null;

  getDb()
    .prepare(
      `INSERT INTO automations (
        id,
        user_id,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      automation.id,
      userId ?? null,
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
      nextRunAt,
      automation.lastScheduledFor,
      automation.lastStartedAt,
      automation.lastFinishedAt,
      automation.lastStatus,
      automation.createdAt,
      automation.updatedAt
    );

  void import("@/lib/automation-scheduler")
    .then(({ wakeAutomationSchedulers }) => wakeAutomationSchedulers())
    .catch(() => {});

  return {
    ...automation,
    nextRunAt
  };
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
    .transaction(() => {
      refreshAutomationRunSummary(run.automationId, run.createdAt);
    })();

  return run;
}

export function triggerAutomationNow(
  automationId: string,
  triggerSource: Extract<AutomationTriggerSource, "manual_run" | "manual_retry"> = "manual_run",
  userId?: string
) {
  const automation = getAutomation(automationId, userId);
  if (!automation) return null;

  const run = createAutomationRun({
    automationId,
    scheduledFor: nowIso(),
    triggerSource
  });

  void import("@/lib/automation-scheduler")
    .then(({ wakeAutomationSchedulers }) => wakeAutomationSchedulers())
    .catch(() => {});

  return run;
}

export function listAutomations(userId?: string): Automation[] {
  const rows = (userId
    ? getDb()
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
           WHERE user_id = ?
           ORDER BY updated_at DESC, id DESC`
        )
        .all(userId)
    : getDb()
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
        .all()) as AutomationRow[];

  return rows.map(rowToAutomation);
}

export function getAutomation(id: string, userId?: string) {
  const row = (userId
    ? getDb()
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
           WHERE id = ? AND user_id = ?`
        )
        .get(id, userId)
    : getDb()
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
        .get(id)) as AutomationRow | undefined;

  return row ? rowToAutomation(row) : null;
}

export function deleteAutomation(id: string, userId?: string) {
  const result = userId
    ? getDb()
        .prepare("DELETE FROM automations WHERE id = ? AND user_id = ?")
        .run(id, userId)
    : getDb()
        .prepare("DELETE FROM automations WHERE id = ?")
        .run(id);

  return result.changes > 0;
}

export function updateAutomation(id: string, patch: UpdateAutomationInput, userId?: string) {
  const current = getAutomation(id, userId);
  if (!current) return null;

  const next = normalizeAutomationSchedule({
    ...current,
    ...patch,
    name: patch.name?.trim() ?? current.name,
    daysOfWeek: patch.daysOfWeek ? normalizeDaysOfWeek(patch.daysOfWeek) : current.daysOfWeek,
    updatedAt: nowIso()
  });

  assertValidSchedule({
    scheduleKind: next.scheduleKind,
    intervalMinutes: next.intervalMinutes,
    calendarFrequency: next.calendarFrequency,
    timeOfDay: next.timeOfDay,
    daysOfWeek: next.daysOfWeek
  });

  if (!next.enabled) {
    next.nextRunAt = null;
  } else if (shouldRecomputeNextRunAt(current, next, patch)) {
    next.nextRunAt = getNextAutomationRunAt(next, next.updatedAt, env.TZ);
  }

  if (userId) {
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
         WHERE id = ? AND user_id = ?`
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
        id,
        userId
      );
  } else {
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
  }

  const updated = getAutomation(id, userId);

  void import("@/lib/automation-scheduler")
    .then(({ wakeAutomationSchedulers }) => wakeAutomationSchedulers())
    .catch(() => {});

  return updated;
}

export function listAutomationRuns(automationId: string, userId?: string): AutomationRun[] {
  const rows = (userId
    ? getDb()
        .prepare(
          `SELECT
            r.id,
            r.automation_id,
            r.conversation_id,
            r.scheduled_for,
            r.started_at,
            r.finished_at,
            r.status,
            r.error_message,
            r.trigger_source,
            r.created_at
           FROM automation_runs r
           JOIN automations a ON a.id = r.automation_id
           WHERE r.automation_id = ? AND a.user_id = ?
           ORDER BY r.scheduled_for DESC, r.created_at DESC, r.id DESC`
        )
        .all(automationId, userId)
    : getDb()
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
        .all(automationId)) as AutomationRunRow[];

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
  const nextErrorMessage = "errorMessage" in input ? input.errorMessage ?? null : currentRun.errorMessage;
  const updatedAt = nowIso();

  const updateRun = getDb().prepare(
    `UPDATE automation_runs
     SET status = ?,
         error_message = ?,
         started_at = ?,
         finished_at = ?
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
    refreshAutomationRunSummary(currentRun.automationId, updatedAt);
  })();

  return getAutomationRun(runId);
}

export function retryAutomationRun(runId: string, userId?: string) {
  const currentRun = getAutomationRun(runId, userId);
  if (!currentRun) return null;

  return triggerAutomationNow(currentRun.automationId, "manual_retry", userId);
}

export function listQueuedAutomationRuns() {
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
       WHERE status = 'queued'
       ORDER BY scheduled_for ASC, created_at ASC, id ASC`
    )
    .all() as AutomationRunRow[];

  return rows.map(rowToAutomationRun);
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
