import { LoaderCircle } from "lucide-react";

import type { BotStatus } from "@/lib/types";

const STATUS_CHIP_CLASSES: Record<BotStatus, string> = {
  idle: "border-white/8 bg-white/[0.03] text-[#d4d4d8]",
  queued: "border-amber-500/20 bg-amber-500/8 text-amber-200",
  running: "border-sky-500/20 bg-sky-500/8 text-sky-200"
};

const STATUS_DOT_CLASSES: Record<BotStatus, string> = {
  idle: "bg-white/25",
  queued: "bg-amber-400",
  running: "bg-sky-400"
};

const STATUS_LABELS: Record<BotStatus, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running"
};

export function botStatusLabel(status: BotStatus) {
  return STATUS_LABELS[status];
}

export function BotStatusChip({ status }: { status: BotStatus }) {
  if (status === "idle") {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_CHIP_CLASSES[status]}`}
    >
      {status === "running" ? (
        <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`} aria-hidden="true" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function BotStatusDot({ status }: { status: BotStatus }) {
  if (status === "idle") {
    return null;
  }

  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {status === "running" ? (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${STATUS_DOT_CLASSES[status]}`} />
      ) : null}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${STATUS_DOT_CLASSES[status]}`} />
    </span>
  );
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
