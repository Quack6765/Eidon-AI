import type { Automation } from "@/lib/types";

export const AUTOMATION_WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
] as const;

export function formatAutomationRunAt(runAt: string | null | undefined) {
  if (!runAt) {
    return "--:--";
  }

  const date = new Date(runAt);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function describeSchedule(
  schedule: Pick<
    Automation,
    "scheduleKind" | "intervalMinutes" | "calendarFrequency" | "timeOfDay" | "daysOfWeek"
  > & { runAt?: string | null }
) {
  if (schedule.scheduleKind === "once") {
    return `Once on ${formatAutomationRunAt(schedule.runAt)}`;
  }

  if (schedule.scheduleKind === "interval" && schedule.intervalMinutes) {
    return `Every ${schedule.intervalMinutes} min`;
  }

  if (schedule.calendarFrequency === "weekly") {
    const selectedDays = AUTOMATION_WEEKDAYS.filter((day) => schedule.daysOfWeek.includes(day.value)).map((day) => day.label);
    return `${selectedDays.join(", ")} at ${schedule.timeOfDay ?? "--:--"}`;
  }

  return `Daily at ${schedule.timeOfDay ?? "--:--"}`;
}
