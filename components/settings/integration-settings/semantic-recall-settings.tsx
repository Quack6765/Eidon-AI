"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export type SemanticRecallStatus = {
  enabled: boolean;
  available: boolean;
  ready: boolean;
  modelId: string;
  chunkCount: number;
  pendingCount: number;
  backfillRunning: boolean;
};

const STATUS_POLL_INTERVAL_MS = 5000;

export function SemanticRecallSettings({
  enabled,
  persistedEnabled,
  canManage,
  dirty,
  onChange
}: {
  enabled: boolean;
  persistedEnabled: boolean;
  canManage: boolean;
  dirty: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const [status, setStatus] = useState<SemanticRecallStatus | null>(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/semantic-recall");
      if (!response.ok) return;
      const result = await response.json() as { status?: SemanticRecallStatus };
      if (result.status) setStatus(result.status);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus, persistedEnabled]);

  const shouldPoll = Boolean(status && (status.backfillRunning || (status.enabled && !status.ready)));

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = setInterval(() => void fetchStatus(), STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [shouldPoll, fetchStatus]);

  async function rebuildIndex() {
    setRebuildError(null);
    setIsRebuilding(true);
    try {
      const response = await fetch("/api/settings/semantic-recall", { method: "POST" });
      const result = await response.json() as { status?: SemanticRecallStatus; error?: string };
      if (!response.ok || !result.status) {
        setRebuildError(result.error ?? "Unable to rebuild the index");
        return;
      }
      setStatus(result.status);
    } catch {
      setRebuildError("Unable to rebuild the index");
    } finally {
      setIsRebuilding(false);
    }
  }

  const readiness = status
    ? !status.available
      ? { label: "Unavailable", dotClass: "bg-red-400" }
      : status.ready
        ? { label: "Ready", dotClass: "bg-emerald-400" }
        : { label: "Loading model…", dotClass: "bg-amber-400 animate-pulse" }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 sm:max-w-md">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">Semantic recall</div>
          <div className="mt-0.5 text-xs leading-5 text-[var(--muted)]">
            Rank memories by relevance and search past conversations semantically. Runs a small local embedding model on this server.
          </div>
          {!canManage ? (
            <div className="mt-1 text-xs leading-5 text-[var(--muted)]">Only admins can change semantic recall settings.</div>
          ) : null}
        </div>
        <label className={`relative inline-flex shrink-0 items-center ${canManage ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
          <input
            type="checkbox"
            aria-label="Enable semantic recall"
            checked={enabled}
            disabled={!canManage}
            onChange={(event) => onChange(event.target.checked)}
            className="peer sr-only"
          />
          <span className={`h-6 w-11 rounded-full bg-white/10 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-violet-500/60 peer-checked:after:translate-x-full ${dirty ? "ring-1 ring-amber-500/40" : ""}`} />
        </label>
      </div>
      {status?.enabled && readiness ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--muted)]" data-testid="semantic-recall-status">
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${readiness.dotClass}`} aria-hidden="true" />
            {readiness.label}
          </span>
          <span className="font-mono text-[11px] text-[var(--text)]/80">{status.modelId}</span>
          <span>{status.chunkCount} chunks indexed</span>
          {status.pendingCount > 0 || status.backfillRunning ? (
            <span>{status.pendingCount} pending</span>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={status.backfillRunning || isRebuilding}
              onClick={() => void rebuildIndex()}
            >
              <RefreshCw className={`h-3 w-3 ${status.backfillRunning || isRebuilding ? "animate-spin" : ""}`} />
              Rebuild index
            </Button>
          ) : null}
          {rebuildError ? <span className="text-red-400">{rebuildError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
