"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle, Square, X } from "lucide-react";

import type { MessageActionStatus } from "@/lib/types";

/**
 * Presentation for assistant tool activity, in both display modes: a pill per
 * tool call, or a single status line.
 *
 * Kept separate from the message renderer so surfaces that only need the
 * chrome — the onboarding demos, for one — do not pull in the markdown stack.
 */

export function ToolPillStatusIcon({ status }: { status: MessageActionStatus }) {
  if (status === "running" || status === "pending") {
    return <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />;
  }
  if (status === "completed") {
    return <Check className="h-2.5 w-2.5 text-emerald-400" />;
  }
  if (status === "stopped") {
    return <Square className="h-2.5 w-2.5 text-red-400 fill-current" />;
  }
  return <X className="h-2.5 w-2.5 text-red-400" />;
}

/**
 * Pass `onToggle` for the interactive disclosure variant; omit it for a static
 * pill (running rows in chat, onboarding demos).
 */
export function ToolPill({
  label,
  query,
  status,
  kindIcon,
  statusIcon,
  isOpen,
  onToggle,
  compact = false,
  children
}: {
  label: string;
  query?: string;
  status: MessageActionStatus;
  kindIcon?: ReactNode;
  statusIcon?: ReactNode;
  isOpen?: boolean;
  onToggle?: () => void;
  /** Shrinks the label for the onboarding demo tiles; chat keeps the default. */
  compact?: boolean;
  children?: ReactNode;
}) {
  const isRunning = status === "running";
  const title = (
    <span
      className={`min-w-0 break-words font-medium leading-4 ${
        compact ? "text-[11px]" : "text-xs"
      } ${isRunning ? "text-white/55" : "text-white/85"}`}
    >
      {kindIcon ? (
        <span className="mr-1 inline-flex translate-y-px align-middle">{kindIcon}</span>
      ) : null}
      {label}
      {query ? (
        <>
          {": "}
          <span className={isRunning ? "font-normal text-white/45" : "font-normal text-white/55"}>
            {query}
          </span>
        </>
      ) : null}
    </span>
  );
  const iconChip = (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
      {statusIcon ?? <ToolPillStatusIcon status={status} />}
    </span>
  );

  if (!onToggle) {
    return (
      <div
        className={`inline-flex w-fit max-w-full items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
          isRunning ? "border-white/6 bg-white/[0.02]" : "border-white/5 bg-white/[0.015]"
        }`}
      >
        {iconChip}
        {title}
      </div>
    );
  }

  return (
    <div
      className={`inline-flex w-fit max-w-full flex-col rounded-lg border border-white/5 bg-white/[0.015] transition-all duration-300 ${
        isOpen ? "w-full" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className={`flex max-w-full items-start gap-1.5 px-2.5 py-1.5 text-left transition hover:opacity-80 ${isOpen ? "w-full" : "w-fit min-w-0"}`}
      >
        {iconChip}
        {title}
        <span className="ml-auto flex items-center pt-px">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-white/30" /> : <ChevronRight className="h-3.5 w-3.5 text-white/30" />}
        </span>
      </button>
      {children}
    </div>
  );
}

export function InProgressIndicator() {
  return (
    <div
      className="w-fit rounded-lg border border-white/5 bg-white/[0.015] px-2 py-1 animate-fade-in"
      data-testid="assistant-in-progress"
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5">
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <LoaderCircle className="h-3 w-3 animate-spin text-white/45" aria-hidden="true" />
        </span>
        <span className="flex items-center gap-1 text-[11px] leading-[16.5px] text-white/50">
          <span className="font-medium">Working</span>
          <span className="text-white/30" aria-hidden="true">...</span>
        </span>
      </span>
    </div>
  );
}

export function StatusLine({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={compact ? "status-line status-line--compact" : "status-line"}
      data-testid="assistant-status-line"
      role="status"
      aria-live="polite"
    >
      <span className="status-line__label" data-testid="assistant-status-line-label">
        {label}
      </span>
    </div>
  );
}
