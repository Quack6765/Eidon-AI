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
