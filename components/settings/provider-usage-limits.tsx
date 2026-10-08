"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ProviderUsageLimits as UsageLimits, ProviderUsageWindow } from "@/lib/provider-adapters/types";
import { fieldLabel } from "@/lib/settings-styles";
import { cn, formatDurationSeconds, formatRelativeTime } from "@/lib/utils";

type UsageState =
  | { status: "loading"; usage: UsageLimits | null }
  | { status: "ready"; usage: UsageLimits }
  | { status: "error"; usage: UsageLimits | null; message: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function usageBarColor(usedPercent: number) {
  if (usedPercent >= 90) return "bg-red-500";
  if (usedPercent >= 70) return "bg-yellow-500";
  return "bg-emerald-500";
}

function formatReset(resetsAt: string | null, now: number) {
  if (!resetsAt) return "Reset time not reported";
  const resetTime = Date.parse(resetsAt);
  const remaining = resetTime - now;
  if (remaining <= 0) return "Resets now";
  if (remaining < DAY_MS) return `Resets in ${formatDurationSeconds(remaining / 1000)}`;
  return `Resets ${new Date(resetTime).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function UsageRow({ window, now }: { window: ProviderUsageWindow; now: number }) {
  const percent = Math.round(window.usedPercent);
  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] @md:items-center @md:gap-6">
      <div className="min-w-0">
        <p className="text-sm text-[var(--text)]">{window.label}</p>
        <p className="text-xs text-[var(--muted)]">{formatReset(window.resetsAt, now)}</p>
      </div>
      <div className="flex items-center gap-3">
        <div
          role="progressbar"
          aria-label={`${window.label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${usageBarColor(window.usedPercent)}`}
            style={{ width: `${Math.max(percent, percent > 0 ? 2 : 0)}%` }}
          />
        </div>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
          {percent}% used
        </span>
      </div>
    </div>
  );
}

export function ProviderUsageLimits({ profileId }: { profileId: string }) {
  const [state, setState] = useState<UsageState>({ status: "loading", usage: null });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState((current) => ({ status: "loading", usage: current.usage }));
    try {
      const response = await fetch(`/api/providers/${profileId}/usage`, { signal });
      const result = await response.json().catch(() => ({})) as { usage?: UsageLimits; error?: string };
      if (!response.ok || !result.usage) {
        setState((current) => ({
          status: "error",
          usage: current.usage,
          message: result.error ?? "Unable to load usage limits"
        }));
        return;
      }
      setState({ status: "ready", usage: result.usage });
    } catch (error) {
      if (signal?.aborted) return;
      setState((current) => ({
        status: "error",
        usage: current.usage,
        message: error instanceof Error ? error.message : "Unable to load usage limits"
      }));
    }
  }, [profileId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const usage = state.usage;
  const now = Date.now();

  return (
    <div className="@container">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3">
        <p className={cn(fieldLabel, "mb-0")}>Usage limits</p>
        <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
          {usage ? <span>Updated {formatRelativeTime(usage.fetchedAt)}</span> : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh usage limits"
            className="min-h-11 min-w-11 text-[var(--muted)] hover:text-[var(--text)] md:min-h-7 md:min-w-7"
            disabled={state.status === "loading"}
            onClick={() => void load()}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${state.status === "loading" ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>
      <div className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06] bg-white/[0.03]">
        {usage?.windows.length ? (
          usage.windows.map((window) => (
            <UsageRow key={`${window.label}-${window.windowSeconds ?? ""}`} window={window} now={now} />
          ))
        ) : usage ? (
          <p className="px-4 py-3 text-sm text-[var(--muted)]">This plan did not report any usage limits.</p>
        ) : state.status === "loading" ? (
          <p className="px-4 py-3 text-sm text-[var(--muted)]" role="status">Loading usage limits…</p>
        ) : null}
        {state.status === "error" ? (
          <p className="px-4 py-3 text-sm text-amber-400" role="alert">{state.message}</p>
        ) : null}
      </div>
    </div>
  );
}
