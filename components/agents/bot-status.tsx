import { LoaderCircle } from "lucide-react";

import type { BotStatus, BotSummary } from "@/lib/types";

const STATUS_CHIP_CLASSES: Partial<Record<BotStatus, string>> = {
  idle: "border-white/8 bg-white/[0.03] text-[#d4d4d8]",
  queued: "border-amber-500/20 bg-amber-500/8 text-amber-200"
};

const STATUS_DOT_CLASSES: Partial<Record<BotStatus, string>> = {
  idle: "bg-white/25",
  queued: "bg-amber-400"
};

const STATUS_LABELS: Record<BotStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  waiting_user: "Needs approval"
};

const WAITING_FOR_INPUT_CHIP_CLASSES =
  "border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[#c4b5fd]";

const UNREAD_LABEL = "Unread";

export function botStatusLabel(status: BotStatus) {
  return STATUS_LABELS[status];
}

export function botAttentionLabel(bot: Pick<BotSummary, "status" | "waitingForInput">, unread: boolean) {
  if (bot.status === "waiting_user") return STATUS_LABELS.waiting_user;
  if (bot.waitingForInput) return "Waiting for input";
  if (bot.status === "queued") return STATUS_LABELS.queued;
  if (bot.status === "idle" && unread) return UNREAD_LABEL;
  return null;
}

export function BotStatusChip({
  status,
  waitingForInput = false,
  unread = false
}: {
  status: BotStatus;
  waitingForInput?: boolean;
  unread?: boolean;
}) {
  if (waitingForInput || status === "waiting_user") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${WAITING_FOR_INPUT_CHIP_CLASSES}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
        {status === "waiting_user" ? STATUS_LABELS.waiting_user : "Waiting for input"}
      </span>
    );
  }

  if (status === "idle") {
    if (!unread) return null;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-[#f4f4f5]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#f4f4f5]" aria-hidden="true" />
        {UNREAD_LABEL}
      </span>
    );
  }

  if (status === "running") {
    return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" aria-label="Running" />;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP_CLASSES[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`} aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function BotStatusDot({
  status,
  waitingForInput = false,
  unread = false
}: {
  status: BotStatus;
  waitingForInput?: boolean;
  unread?: boolean;
}) {
  if (waitingForInput || status === "waiting_user") {
    return <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />;
  }

  if (status === "idle") {
    if (!unread) return null;
    return (
      <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[#f4f4f5]" aria-hidden="true" />
    );
  }

  if (status === "running") {
    return <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" aria-label="Running" />;
  }

  return <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASSES[status]}`} aria-hidden="true" />;
}

export function formatBotActivity(value: string | null) {
  if (!value) {
    return "Never run";
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "Active just now";
  if (diffMin < 60) return `Active ${diffMin}m ago`;
  if (diffHr < 24) return `Active ${diffHr}h ago`;
  if (diffDay < 30) return `Active ${diffDay}d ago`;
  return `Active ${date.toLocaleDateString()}`;
}
