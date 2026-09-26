"use client";

import { MousePointer2 } from "lucide-react";
import { useState } from "react";

import { ComputerStage } from "@/components/computer-stage";
import type { ComputerHandoffProposalPayload, MessageTimelineItem } from "@/lib/types";

type TimelineAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

export function isComputerHandoffAction(
  action: TimelineAction
): action is TimelineAction & { proposalPayload: ComputerHandoffProposalPayload } {
  return (
    action.kind === "computer_handoff" &&
    (action.proposalPayload as { operation?: unknown } | null)?.operation === "computer_handoff"
  );
}

export function ComputerHandoffCard({
  action,
  conversationId,
  readOnly = false
}: {
  action: TimelineAction & { proposalPayload: ComputerHandoffProposalPayload };
  conversationId?: string;
  readOnly?: boolean;
}) {
  const [stageOpen, setStageOpen] = useState(false);
  const payload = action.proposalPayload;
  const isPending = action.status === "pending" && action.proposalState === "pending";
  const canTakeOver = isPending && !readOnly && Boolean(conversationId);
  const heading = isPending ? "Your turn in the browser" : action.resultSummary || "Your turn in the browser";

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5" data-testid="computer-handoff-card">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          <MousePointer2 className={`h-3 w-3 ${isPending ? "text-violet-400" : "text-white/40"}`} aria-hidden="true" />
        </span>
        <span className="text-[12px] font-medium text-white/88">{heading}</span>
      </div>

      <div className="mt-2 space-y-2 text-[12px] leading-5 text-white/70">
        <div className="rounded-md border border-white/6 bg-black/20 px-3 py-2">
          <p className="text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">The bot needs you to</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-white/84">{payload.reason}</p>
        </div>
        {payload.note ? (
          <p className="break-words text-[11px] leading-5 text-white/48">Your note: {payload.note}</p>
        ) : null}
        {canTakeOver ? (
          <p className="text-[11px] leading-5 text-white/48">
            The bot waits up to 30 minutes. Messages you send now reach it after you return control.
          </p>
        ) : null}
      </div>

      {canTakeOver ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStageOpen(true)}
            className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            Take over
          </button>
        </div>
      ) : null}

      {stageOpen && conversationId ? (
        <ComputerStage conversationId={conversationId} askForNote onClose={() => setStageOpen(false)} />
      ) : null}
    </div>
  );
}
