import { env } from "@/lib/env";
import {
  attachConversationToRun,
  createAutomationRun,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  listDueAutomations,
  listQueuedAutomationRuns,
  updateAutomation,
  updateAutomationRunStatus
} from "@/lib/automations";
import { createConversation } from "@/lib/conversations";
import type { StartChatTurn } from "@/lib/chat-turn";
import { startChatTurn } from "@/lib/chat-turn";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { Automation } from "@/lib/types";
import { getConversationManager } from "@/lib/ws-singleton";

type SchedulerDependencies = {
  now?: () => Date;
  timeZone?: string;
  manager?: ConversationManager;
  startChatTurn?: StartChatTurn;
  pollIntervalMs?: number;
};

type SchedulerHandle = {
  wake: () => void;
};

type ScheduleShape = Pick<
  Automation,
  "scheduleKind" | "intervalMinutes" | "calendarFrequency" | "timeOfDay" | "daysOfWeek"
>;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const activeSchedulers = new Set<SchedulerHandle>();

function getDateTimeFormatter(timeZone: string) {
  let formatter = dateTimeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    dateTimeFormatterCache.set(timeZone, formatter);
  }

  return formatter;
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number.parseInt(part.value, 10)])
  ) as Record<string, number>;

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtcIso(parts: ZonedParts, timeZone: string) {
  let guess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
    const refined = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    ) - offset;

    if (refined === guess) {
      break;
    }

    guess = refined;
  }

  return new Date(guess).toISOString();
}

function addDays(parts: Pick<ZonedParts, "year" | "month" | "day">, days: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  };
}

function getWeekday(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function scheduleToParts(
  schedule: ScheduleShape,
  now: Date,
  timeZone: string
) {
  const nowParts = getZonedParts(now, timeZone);

  if (schedule.scheduleKind === "interval") {
    if (!schedule.intervalMinutes) {
      throw new Error("Interval automations require interval minutes");
    }

    const currentMinuteOfDay = nowParts.hour * 60 + nowParts.minute;
    const nextMinuteOfDay = Math.floor(currentMinuteOfDay / schedule.intervalMinutes) * schedule.intervalMinutes
      + schedule.intervalMinutes;
    const dayOffset = Math.floor(nextMinuteOfDay / (24 * 60));
    const minuteWithinDay = nextMinuteOfDay % (24 * 60);
    const nextDate = addDays(nowParts, dayOffset);

    return {
      ...nextDate,
      hour: Math.floor(minuteWithinDay / 60),
      minute: minuteWithinDay % 60,
      second: 0
    };
  }

  if (!schedule.timeOfDay) {
    throw new Error("Calendar automations require a time of day");
  }

  const [hour, minute] = schedule.timeOfDay.split(":").map((value) => Number.parseInt(value, 10));
  return {
    ...nowParts,
    hour,
    minute,
    second: 0
  };
}

export function getNextAutomationRunAt(
  schedule: ScheduleShape,
  nowIsoString: string,
  timeZone = env.TZ
) {
  const now = new Date(nowIsoString);
  const baseParts = scheduleToParts(schedule, now, timeZone);

  if (schedule.scheduleKind === "interval") {
    return zonedDateTimeToUtcIso(baseParts, timeZone);
  }

  if (schedule.calendarFrequency === "daily") {
    let candidate = zonedDateTimeToUtcIso(baseParts, timeZone);
    if (candidate <= nowIsoString) {
      candidate = zonedDateTimeToUtcIso(
        {
          ...addDays(baseParts, 1),
          hour: baseParts.hour,
          minute: baseParts.minute,
          second: 0
        },
        timeZone
      );
    }
    return candidate;
  }

  const weekdays = schedule.daysOfWeek;
  for (let offset = 0; offset < 14; offset += 1) {
    const date = addDays(baseParts, offset);
    if (!weekdays.includes(getWeekday(date))) {
      continue;
    }

    const candidate = zonedDateTimeToUtcIso(
      {
        ...date,
        hour: baseParts.hour,
        minute: baseParts.minute,
        second: 0
      },
      timeZone
    );

    if (candidate > nowIsoString) {
      return candidate;
    }
  }

  throw new Error("Unable to compute next weekly automation run");
}

function registerScheduler(handle: SchedulerHandle) {
  activeSchedulers.add(handle);
}

function unregisterScheduler(handle: SchedulerHandle) {
  activeSchedulers.delete(handle);
}

export function wakeAutomationSchedulers() {
  for (const scheduler of activeSchedulers) {
    scheduler.wake();
  }
}

async function executeAutomationRun(
  runId: string,
  dependencies: Required<Pick<SchedulerDependencies, "now" | "manager" | "startChatTurn">>
) {
  const run = getAutomationRun(runId);
  if (!run || run.status !== "queued") {
    return;
  }

  const automation = getAutomation(run.automationId);
  if (!automation) {
    updateAutomationRunStatus(runId, {
      status: "failed",
      errorMessage: "Automation not found",
      finishedAt: dependencies.now().toISOString()
    });
    return;
  }

  const otherRunningRun = listAutomationRuns(automation.id).find(
    (candidate) => candidate.id !== run.id && candidate.status === "running"
  );
  if (otherRunningRun) {
    updateAutomationRunStatus(runId, {
      status: "failed",
      errorMessage: "Automation already has a running job",
      finishedAt: dependencies.now().toISOString()
    });
    return;
  }

  const conversation = createConversation(automation.name, null, {
    providerProfileId: automation.providerProfileId,
    origin: "automation",
    automationId: automation.id,
    automationRunId: run.id
  });
  attachConversationToRun(run.id, conversation.id);
  updateAutomationRunStatus(run.id, {
    status: "running",
    startedAt: dependencies.now().toISOString(),
    errorMessage: null
  });

  try {
    const result = await dependencies.startChatTurn(
      dependencies.manager,
      conversation.id,
      automation.prompt,
      [],
      automation.personaId ?? undefined
    );

    const completedAt = dependencies.now().toISOString();
    if (result?.status === "failed") {
      updateAutomationRunStatus(run.id, {
        status: "failed",
        errorMessage: result.errorMessage ?? "Automation run failed",
        finishedAt: completedAt
      });
      return;
    }

    if (result?.status === "stopped") {
      updateAutomationRunStatus(run.id, {
        status: "stopped",
        finishedAt: completedAt
      });
      return;
    }

    updateAutomationRunStatus(run.id, {
      status: "completed",
      finishedAt: completedAt
    });
  } catch (error) {
    updateAutomationRunStatus(run.id, {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Automation run failed",
      finishedAt: dependencies.now().toISOString()
    });
  }
}

function createMissedRun(automationId: string, scheduledFor: string, nowIsoString: string) {
  const run = createAutomationRun({
    automationId,
    scheduledFor,
    triggerSource: "schedule"
  });
  updateAutomationRunStatus(run.id, {
    status: "missed",
    finishedAt: nowIsoString
  });
}

function ensureNextRunAt(timeZone: string, nowIsoString: string) {
  for (const automation of listAutomations()) {
    if (!automation.enabled || automation.nextRunAt) {
      continue;
    }

    updateAutomation(automation.id, {
      nextRunAt: getNextAutomationRunAt(automation, nowIsoString, timeZone)
    });
  }
}

async function processDueAutomation(
  automation: Automation,
  nowIsoString: string,
  timeZone: string,
  dependencies: Required<Pick<SchedulerDependencies, "now" | "manager" | "startChatTurn">>
) {
  if (!automation.nextRunAt) {
    return;
  }

  const dueSlots: string[] = [];
  let cursor = automation.nextRunAt;
  while (cursor <= nowIsoString) {
    dueSlots.push(cursor);
    cursor = getNextAutomationRunAt(automation, cursor, timeZone);
  }

  if (dueSlots.length === 0) {
    return;
  }

  const hasRunningRun = listAutomationRuns(automation.id).some((run) => run.status === "running");
  const latestDueSlot = dueSlots[dueSlots.length - 1];

  for (const missedSlot of hasRunningRun ? dueSlots : dueSlots.slice(0, -1)) {
    createMissedRun(automation.id, missedSlot, nowIsoString);
  }

  updateAutomation(automation.id, { nextRunAt: cursor });

  if (hasRunningRun) {
    return;
  }

  const run = createAutomationRun({
    automationId: automation.id,
    scheduledFor: latestDueSlot,
    triggerSource: "schedule"
  });
  await executeAutomationRun(run.id, dependencies);
}

export function createAutomationScheduler(dependencies: SchedulerDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const timeZone = dependencies.timeZone ?? env.TZ;
  const manager = dependencies.manager ?? getConversationManager();
  const runChatTurn = dependencies.startChatTurn ?? startChatTurn;
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let started = false;

  const schedulerHandle: SchedulerHandle = {
    wake() {
      if (!started) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      queueMicrotask(() => {
        void runCycle();
      });
    }
  };

  async function runCycle() {
    if (running) {
      return running;
    }

    running = (async () => {
      const nowIsoString = now().toISOString();
      ensureNextRunAt(timeZone, nowIsoString);

      for (const run of listQueuedAutomationRuns()) {
        await executeAutomationRun(run.id, {
          now,
          manager,
          startChatTurn: runChatTurn
        });
      }

      for (const automation of listDueAutomations(nowIsoString)) {
        await processDueAutomation(automation, nowIsoString, timeZone, {
          now,
          manager,
          startChatTurn: runChatTurn
        });
      }
    })().finally(() => {
      running = null;
      if (started) {
        timer = setTimeout(() => {
          void runCycle();
        }, pollIntervalMs);
      }
    });

    return running;
  }

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      registerScheduler(schedulerHandle);
      schedulerHandle.wake();
    },
    stop() {
      started = false;
      unregisterScheduler(schedulerHandle);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    async runOnce() {
      await runCycle();
    },
    wake() {
      schedulerHandle.wake();
    }
  };
}

export type AutomationScheduler = ReturnType<typeof createAutomationScheduler>;
