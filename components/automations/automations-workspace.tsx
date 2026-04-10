"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, MessageSquareText } from "lucide-react";

import type { Automation, AutomationRun } from "@/lib/types";

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function scheduleSummary(automation: Automation) {
  if (automation.scheduleKind === "interval" && automation.intervalMinutes) {
    return `Every ${automation.intervalMinutes} minutes`;
  }

  if (automation.calendarFrequency === "weekly") {
    const days = automation.daysOfWeek.length ? automation.daysOfWeek.join(", ") : "custom";
    return `Weekly (${days}) at ${automation.timeOfDay ?? "--:--"}`;
  }

  return `Daily at ${automation.timeOfDay ?? "--:--"}`;
}

function runStatusClasses(status: AutomationRun["status"]) {
  if (status === "completed") {
    return "border-emerald-500/20 bg-emerald-500/8 text-emerald-300";
  }
  if (status === "failed") {
    return "border-red-500/20 bg-red-500/8 text-red-200";
  }
  if (status === "running") {
    return "border-sky-500/20 bg-sky-500/8 text-sky-200";
  }
  return "border-white/8 bg-white/[0.03] text-[#d4d4d8]";
}

export function AutomationsWorkspace({
  automation,
  runs
}: {
  automation: Automation | null;
  runs: AutomationRun[];
}) {
  const router = useRouter();
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [optimisticRuns, setOptimisticRuns] = useState<AutomationRun[]>([]);
  const visibleRuns = useMemo(() => [...optimisticRuns, ...runs], [optimisticRuns, runs]);

  useEffect(() => {
    setOptimisticRuns((currentRuns) =>
      currentRuns.filter((run) => !runs.some((persistedRun) => persistedRun.id === run.id))
    );
  }, [runs]);

  if (!automation) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="max-w-[320px] text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/6 bg-white/[0.03]">
            <Clock3 className="h-5 w-5 text-[#52525b]" />
          </div>
          <h2 className="text-lg font-semibold text-[#f4f4f5]">Automations workspace</h2>
          <p className="mt-3 text-sm leading-6 text-[#71717a]">
            Select an automation from the sidebar to inspect recent runs and open prior run conversations.
          </p>
        </div>
      </div>
    );
  }

  const currentAutomation = automation;

  async function handleRunNow() {
    setIsRunningNow(true);
    setRunError(null);

    try {
      const response = await fetch(`/api/automations/${currentAutomation.id}/run-now`, {
        method: "POST"
      });
      const payload = await response.json().catch(() => null) as {
        run?: AutomationRun;
        error?: string;
      } | null;

      if (!response.ok || !payload?.run) {
        throw new Error(payload?.error ?? "Could not start automation");
      }

      const nextRun = payload.run;
      setOptimisticRuns((currentRuns) => [
        {
          ...nextRun,
          status: nextRun.status === "queued" ? "running" : nextRun.status
        },
        ...currentRuns.filter((run) => run.id !== nextRun.id)
      ]);
      setRunNotice("Running");
      window.setTimeout(() => setRunNotice(null), 1500);

      router.refresh();
      window.setTimeout(() => router.refresh(), 250);
      window.setTimeout(() => router.refresh(), 1000);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Could not start automation");
    } finally {
      setIsRunningNow(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
        <div className="rounded-xl border border-white/6 bg-white/[0.02] p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-[1.35rem] font-semibold text-[#f4f4f5]">{automation.name}</h1>
              <p className="mt-2 text-sm text-[#71717a]">{scheduleSummary(automation)}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm text-[#d4d4d8]">
                Next run: {formatTimestamp(automation.nextRunAt)}
              </div>
              <button
                type="button"
                onClick={handleRunNow}
                disabled={isRunningNow}
                className="rounded-lg border border-white/10 bg-[#18181b] px-3 py-2 text-sm font-medium text-[#f4f4f5] transition-colors hover:bg-[#202024] disabled:cursor-not-allowed disabled:text-[#71717a]"
              >
                {isRunningNow ? "Starting…" : "Run now"}
              </button>
            </div>
          </div>
          {runError ? (
            <p className="mt-3 text-sm text-red-200">{runError}</p>
          ) : runNotice ? (
            <p className="mt-3 text-sm text-[#d4d4d8]">{runNotice}</p>
          ) : null}
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[0.95rem] font-semibold text-[#f4f4f5]">Run history</h2>
            <span className="text-xs text-[#71717a]">
              {visibleRuns.length} run{visibleRuns.length === 1 ? "" : "s"}
            </span>
          </div>

          {visibleRuns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-5 py-10 text-center text-sm text-[#71717a]">
              No runs yet. Once this automation executes, its transcript will appear here.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRuns.map((run) => {
                const content = (
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-4 transition-colors hover:bg-white/[0.03]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-md border px-2 py-1 text-[11px] font-medium ${runStatusClasses(run.status)}`}>
                          {run.status}
                        </span>
                        <span className="text-xs text-[#71717a]">{run.triggerSource.replace("_", " ")}</span>
                      </div>
                      <p className="mt-3 text-sm text-[#f4f4f5]">
                        Scheduled for {formatTimestamp(run.scheduledFor)}
                      </p>
                      <p className="mt-1 text-xs text-[#71717a]">
                        Finished {formatTimestamp(run.finishedAt)}
                      </p>
                      {run.errorMessage ? (
                        <p className="mt-2 text-xs text-red-200">{run.errorMessage}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-[#71717a]">
                      <MessageSquareText className="h-4 w-4" />
                      <span className="text-xs">
                        {run.conversationId ? "Open transcript" : "Transcript pending"}
                      </span>
                    </div>
                  </div>
                );

                if (!run.conversationId) {
                  return <div key={run.id}>{content}</div>;
                }

                return (
                  <Link
                    key={run.id}
                    href={`/automations/${automation.id}/runs/${run.id}`}
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
