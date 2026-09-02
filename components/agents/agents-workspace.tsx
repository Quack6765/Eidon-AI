"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, Crown, Plus } from "lucide-react";

import { BotAvatar } from "@/components/agents/bot-avatar";
import { BotStatusChip, formatBotActivity } from "@/components/agents/bot-status";
import { BotFormModal } from "@/components/agents/bot-form-modal";
import { useBots } from "@/hooks/use-bots";
import type { BotRun, BotRunStatus, BotRunTriggerSource, BotSummary } from "@/lib/types";

const TRIGGER_LABELS: Record<BotRunTriggerSource, string> = {
  dm: "Direct message",
  delegated: "Delegated",
  routine: "Routine"
};

function runStatusClasses(status: BotRunStatus) {
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

function formatRunTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function sortBots(bots: BotSummary[]) {
  return [...bots].sort((left, right) => {
    if (left.isChief !== right.isChief) {
      return left.isChief ? -1 : 1;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt < right.createdAt ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function BotCard({ bot }: { bot: BotSummary }) {
  return (
    <Link
      href={`/agents/${bot.id}`}
      className={`group flex flex-col gap-4 rounded-xl border p-4 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/45 ${
        bot.isChief
          ? "border-[var(--accent)]/20 bg-[var(--accent-soft)] hover:bg-[rgba(139,92,246,0.14)]"
          : "border-white/6 bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        <BotAvatar seed={bot.avatarSeed} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-[#f4f4f5]">{bot.name}</span>
            {bot.isChief ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#c4b5fd]"
                title="Chief of staff"
              >
                <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                Chief
              </span>
            ) : null}
          </div>
          {bot.title ? (
            <div className="mt-0.5 truncate text-xs text-[#71717a]">{bot.title}</div>
          ) : null}
        </div>
      </div>
      {bot.description ? (
        <p className="line-clamp-2 text-xs leading-5 text-[#71717a]">{bot.description}</p>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2">
        <BotStatusChip status={bot.status} />
        <span className="truncate text-[11px] text-[#52525b]">{formatBotActivity(bot.lastRunAt)}</span>
      </div>
    </Link>
  );
}

export function AgentsWorkspace({
  initialBots,
  initialRuns,
  initialLimits
}: {
  initialBots: BotSummary[];
  initialRuns: BotRun[];
  initialLimits: { maxBots: number };
}) {
  const router = useRouter();
  const { bots, runs, limits, isLoading, setBots } = useBots({
    bots: initialBots,
    runs: initialRuns,
    limits: initialLimits
  });
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const sortedBots = useMemo(() => sortBots(bots), [bots]);
  const botNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const bot of bots) {
      map.set(bot.id, bot.name);
    }
    return map;
  }, [bots]);
  const atLimit = bots.length >= limits.maxBots;

  async function handleCreate(values: {
    name: string;
    title: string;
    description: string;
    systemPrompt: string;
  }) {
    try {
      const response = await fetch("/api/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          title: values.title,
          description: values.description,
          ...(values.systemPrompt ? { systemPrompt: values.systemPrompt } : {})
        })
      });
      const payload = (await response.json().catch(() => null)) as { bot?: BotSummary; error?: string } | null;

      if (!response.ok || !payload?.bot) {
        return payload?.error ?? "Unable to create bot";
      }

      setBots((current) => [...current, payload.bot as BotSummary]);
      router.push(`/agents/${payload.bot.id}`);
      return null;
    } catch {
      return "Unable to create bot";
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-8">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
        <div className="rounded-xl border border-white/6 bg-white/[0.02] p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-[1.35rem] font-semibold text-[#f4f4f5]">Agents</h1>
              <p className="mt-2 text-sm text-[#71717a]">
                Your team of bots. Message them directly, or let the chief of staff delegate work.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              disabled={atLimit}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#18181b] px-3 py-2 text-sm font-medium text-[#f4f4f5] transition-colors hover:bg-[#202024] disabled:cursor-not-allowed disabled:text-[#71717a]"
              title={atLimit ? `Bot limit reached (${limits.maxBots})` : undefined}
            >
              <Plus className="h-4 w-4" />
              New bot
            </button>
          </div>
        </div>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[0.95rem] font-semibold text-[#f4f4f5]">Roster</h2>
            <span className="text-xs text-[#71717a]">
              {bots.length} of {limits.maxBots} bots
            </span>
          </div>

          {isLoading && bots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-5 py-10 text-center text-sm text-[#71717a]">
              Loading bots…
            </div>
          ) : sortedBots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-5 py-10 text-center text-sm text-[#71717a]">
              No bots yet. Create your first specialist to delegate work to.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sortedBots.map((bot) => (
                <BotCard key={bot.id} bot={bot} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[0.95rem] font-semibold text-[#f4f4f5]">Recent activity</h2>
            <span className="text-xs text-[#71717a]">
              {runs.length} run{runs.length === 1 ? "" : "s"}
            </span>
          </div>

          {runs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/8 bg-white/[0.02] px-5 py-10 text-center text-sm text-[#71717a]">
              No bot activity yet. Runs appear here as bots handle messages and routines.
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${runStatusClasses(run.status)}`}>
                      {run.status}
                    </span>
                    <span className="truncate text-sm text-[#f4f4f5]">
                      {botNameById.get(run.botId) ?? "Bot"}
                    </span>
                    <span className="hidden truncate text-xs text-[#71717a] sm:inline">
                      {TRIGGER_LABELS[run.triggerSource]}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-[#71717a]">{formatRunTime(run.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex items-center gap-2 pb-2 text-xs text-[#71717a]">
          <Bot className="h-3.5 w-3.5" />
          <span>Bots run in their own sandboxed browser sessions and keep separate workspaces.</span>
          <Link
            href="/settings/automations"
            className="ml-auto shrink-0 text-[#cbd5e1] underline-offset-2 transition-colors hover:text-white hover:underline"
          >
            Bind a routine to a bot
          </Link>
        </div>
      </div>

      <BotFormModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        submitLabel="Create bot"
        title="New bot"
        description="Add a specialist to your team. The chief of staff can delegate tasks to it."
        onSubmit={handleCreate}
      />
    </div>
  );
}
