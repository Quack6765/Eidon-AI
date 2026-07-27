import { env } from "@/lib/env";
import type { Automation } from "@/lib/types";

export type AutomationScheduleShape = Pick<
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

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

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

function getLocalDayNumber(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

function appendRecentSlot(slots: string[], slot: string, limit: number) {
  slots.push(slot);
  if (slots.length > limit) {
    slots.shift();
  }
}

function getIntervalCatchUpWindow(
  schedule: AutomationScheduleShape,
  firstDueAt: string,
  nowIsoString: string,
  timeZone: string,
  historyLimit: number
) {
  const intervalMinutes = schedule.intervalMinutes;
  if (!intervalMinutes) {
    throw new Error("Interval automations require interval minutes");
  }

  const nowParts = getZonedParts(new Date(nowIsoString), timeZone);
  let cursorParts = getZonedParts(new Date(firstDueAt), timeZone);
  let cursor = firstDueAt;
  let elapsedLocalDays = 0;
  let iterations = 0;
  let jumpEvaluated = false;
  const seenMinuteStates = new Map<number, number>();
  const dueSlots: string[] = [];

  while (cursor <= nowIsoString) {
    appendRecentSlot(dueSlots, cursor, historyLimit);

    if (!jumpEvaluated) {
      const minuteState = cursorParts.hour * 60 + cursorParts.minute;
      const previousElapsedDays = seenMinuteStates.get(minuteState);

      if (previousElapsedDays !== undefined) {
        const cycleDays = elapsedLocalDays - previousElapsedDays;
        const remainingDays = getLocalDayNumber(nowParts) - getLocalDayNumber(cursorParts);
        const cyclesToSkip = cycleDays > 0
          ? Math.max(0, Math.floor(remainingDays / cycleDays) - 1)
          : 0;
        jumpEvaluated = true;

        if (cyclesToSkip > 0) {
          const date = addDays(cursorParts, cyclesToSkip * cycleDays);
          cursorParts = { ...cursorParts, ...date };
          cursor = zonedDateTimeToUtcIso(cursorParts, timeZone);
          elapsedLocalDays += cyclesToSkip * cycleDays;
          dueSlots.length = 0;
          continue;
        }
      } else {
        seenMinuteStates.set(minuteState, elapsedLocalDays);
      }
    }

    const nextCursor = getNextAutomationRunAt(schedule, cursor, timeZone);
    const nextParts = getZonedParts(new Date(nextCursor), timeZone);

    if (nextCursor <= cursor) {
      throw new Error("Automation interval schedule did not advance");
    }

    elapsedLocalDays += getLocalDayNumber(nextParts) - getLocalDayNumber(cursorParts);
    cursorParts = nextParts;
    cursor = nextCursor;
    iterations += 1;

    if (iterations > 4096) {
      throw new Error("Automation catch-up exceeded its computation limit");
    }
  }

  return { dueSlots, nextRunAt: cursor };
}

function getCalendarCatchUpWindow(
  schedule: AutomationScheduleShape,
  firstDueAt: string,
  nowIsoString: string,
  timeZone: string,
  historyLimit: number
) {
  if (!schedule.timeOfDay) {
    throw new Error("Calendar automations require a time of day");
  }

  const [hour, minute] = schedule.timeOfDay
    .split(":")
    .map((value) => Number.parseInt(value, 10));
  const nowParts = getZonedParts(new Date(nowIsoString), timeZone);
  let latestDate = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  let latestDueAt: string | null = null;

  const maxLatestScanDays = schedule.calendarFrequency === "daily" ? 2 : 14;
  for (let offset = 0; offset < maxLatestScanDays; offset += 1) {
    const date = addDays(latestDate, -offset);
    if (schedule.calendarFrequency === "weekly" && !schedule.daysOfWeek.includes(getWeekday(date))) {
      continue;
    }

    const candidate = zonedDateTimeToUtcIso({ ...date, hour, minute, second: 0 }, timeZone);
    if (candidate <= nowIsoString) {
      latestDate = date;
      latestDueAt = candidate;
      break;
    }
  }

  if (!latestDueAt || latestDueAt < firstDueAt) {
    throw new Error("Unable to locate the latest due automation slot");
  }

  const descendingSlots: string[] = [];
  const maxHistoryScanDays = schedule.calendarFrequency === "daily"
    ? historyLimit
    : historyLimit * 7 + 7;

  for (let offset = 0; offset < maxHistoryScanDays && descendingSlots.length < historyLimit; offset += 1) {
    const date = addDays(latestDate, -offset);
    if (schedule.calendarFrequency === "weekly" && !schedule.daysOfWeek.includes(getWeekday(date))) {
      continue;
    }

    const candidate = zonedDateTimeToUtcIso({ ...date, hour, minute, second: 0 }, timeZone);
    if (candidate < firstDueAt) {
      break;
    }
    if (candidate <= nowIsoString) {
      descendingSlots.push(candidate);
    }
  }

  return {
    dueSlots: descendingSlots.reverse(),
    nextRunAt: getNextAutomationRunAt(schedule, latestDueAt, timeZone)
  };
}

function scheduleToParts(schedule: AutomationScheduleShape, now: Date, timeZone: string) {
  const nowParts = getZonedParts(now, timeZone);

  if (schedule.scheduleKind === "interval") {
    if (!schedule.intervalMinutes) {
      throw new Error("Interval automations require interval minutes");
    }

    const currentMinuteOfDay = nowParts.hour * 60 + nowParts.minute;
    const nextMinuteOfDay =
      Math.floor(currentMinuteOfDay / schedule.intervalMinutes) * schedule.intervalMinutes +
      schedule.intervalMinutes;
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

  const [hour, minute] = schedule.timeOfDay
    .split(":")
    .map((value) => Number.parseInt(value, 10));
  return {
    ...nowParts,
    hour,
    minute,
    second: 0
  };
}

export function getNextAutomationRunAt(
  schedule: AutomationScheduleShape,
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

export function getAutomationCatchUpWindow(
  schedule: AutomationScheduleShape,
  firstDueAt: string,
  nowIsoString: string,
  timeZone = env.TZ,
  historyLimit = 64
) {
  const boundedHistoryLimit = Math.max(1, Math.floor(historyLimit));
  const initialSlots: string[] = [];
  let cursor = firstDueAt;

  while (cursor <= nowIsoString && initialSlots.length < boundedHistoryLimit) {
    initialSlots.push(cursor);
    cursor = getNextAutomationRunAt(schedule, cursor, timeZone);
  }

  if (cursor > nowIsoString) {
    return { dueSlots: initialSlots, nextRunAt: cursor };
  }

  return schedule.scheduleKind === "interval"
    ? getIntervalCatchUpWindow(schedule, cursor, nowIsoString, timeZone, boundedHistoryLimit)
    : getCalendarCatchUpWindow(schedule, cursor, nowIsoString, timeZone, boundedHistoryLimit);
}
