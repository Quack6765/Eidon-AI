"use client";

import { LoaderCircle, Square } from "lucide-react";

import { useTicker } from "@/hooks/use-delegation-status";
import { formatDurationSeconds } from "@/lib/utils";
import type { BotRun, BotRunStatus, BotRunTriggerSource } from "@/lib/types";

export const BOT_RUN_TRIGGER_LABELS: Record<BotRunTriggerSource, string> = {
  dm: "Direct message",
  delegated: "Delegated",
  routine: "Routine"
};

export function isActiveBotRun(run: BotRun) {
  return run.status === "queued" || run.status === "running" || run.status === "waiting_user";
}

export function formatBotRunTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatBotRunDuration(run: BotRun, now: number) {
  if (!run.startedAt) return null;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return formatDurationSeconds((end - Date.parse(run.startedAt)) / 1000);
}

function runStatusClasses(status: BotRunStatus) {
  if (status === "completed") {
    return "border-emerald-500/20 bg-emerald-500/8 text-emerald-300";
  }
  if (status === "failed") {
    return "border-red-500/20 bg-red-500/8 text-red-200";
  }
  if (status === "running" || status === "waiting_user") {
    return "border-[var(--accent)]/20 bg-[var(--accent)]/8 text-[#c4b5fd]";
  }
  if (status === "queued") {
    return "border-amber-500/20 bg-amber-500/8 text-amber-200";
  }
  return "border-white/8 bg-white/[0.03] text-[#d4d4d8]";
}

export function BotRunStatusChip({ status, compact = false }: { status: BotRunStatus; compact?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-md border font-medium ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"} ${runStatusClasses(status)}`}
    >
      {status === "waiting_user" ? "waiting for you" : status}
    </span>
  );
}

export function describeBotRunTrigger(
  run: BotRun,
  nameOf: (botId: string) => string | undefined,
  viewpointBotId?: string
) {
  if (viewpointBotId && run.botId !== viewpointBotId) {
    return `Handed to ${nameOf(run.botId) ?? "a teammate"}`;
  }
  if (run.triggerSource === "delegated" && run.requestedByBotId) {
    return `From ${nameOf(run.requestedByBotId) ?? "a teammate"}`;
  }
  return BOT_RUN_TRIGGER_LABELS[run.triggerSource];
}

export function BotRunList({
  botId,
  runs,
  botNames,
  stoppingRunIds,
  onStopAction
}: {
  botId: string;
  runs: BotRun[];
  botNames: Record<string, string>;
  stoppingRunIds: ReadonlySet<string>;
  onStopAction: (run: BotRun) => void;
}) {
  const hasActiveRun = runs.some(isActiveBotRun);
  const now = useTicker(1_000, hasActiveRun);

  return (
    <ul className="divide-y divide-white/4 rounded-xl border border-white/6 bg-white/[0.02]">
      {runs.map((run) => {
        const trigger = describeBotRunTrigger(run, (id) => botNames[id], botId);
        const duration = formatBotRunDuration(run, now);
        const isStopping = stoppingRunIds.has(run.id);
        return (
          <li key={run.id} className="flex items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <BotRunStatusChip status={run.status} compact />
                <span className="truncate text-xs font-medium text-[#f4f4f5]">{trigger}</span>
              </div>
              <div className="mt-1 text-[11px] text-[var(--muted)]">
                {formatBotRunTime(run.createdAt)}
                {duration ? ` · ${duration}` : null}
              </div>
              {run.errorMessage ? (
                <p className="mt-1 line-clamp-2 break-words text-[11px] leading-4 text-red-200/80" title={run.errorMessage}>
                  {run.errorMessage}
                </p>
              ) : null}
            </div>
            {isActiveBotRun(run) ? (
              <button
                type="button"
                onClick={() => onStopAction(run)}
                disabled={isStopping}
                aria-label={`Stop run: ${trigger}`}
                title="Stop"
                className="-mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#71717a] transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:text-[#52525b]"
              >
                {isStopping ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
