"use client";

import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import {
  buildToolApprovalHeading,
  buildToolApprovalNote,
  getToolApprovalPreview
} from "@/lib/tool-approval-display";
import type {
  MessageTimelineItem,
  ToolApprovalProposalPayload
} from "@/lib/types";

type TimelineAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

export function isToolApprovalAction(
  action: TimelineAction
): action is TimelineAction & {
  proposalPayload: ToolApprovalProposalPayload;
} {
  return action.kind === "tool_approval" && Boolean(action.proposalPayload);
}

export function ToolApprovalCard({
  action,
  onApprove,
  onDismiss,
  readOnly = false
}: {
  action: TimelineAction;
  onApprove?: (
    actionId: string,
    options?: { allowAlways?: boolean }
  ) => Promise<void>;
  onDismiss?: (actionId: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const payload = action.proposalPayload as ToolApprovalProposalPayload;
  const canAllowAlways = payload.scope === "mcp" || payload.classified;
  const isPending = !readOnly && action.status === "pending" && action.proposalState === "pending";
  const heading = buildToolApprovalHeading(payload);
  const [submissionState, setSubmissionState] = useState<"approve" | "dismiss" | null>(null);
  const [localError, setLocalError] = useState("");

  async function handleApprove(allowAlways: boolean) {
    if (!onApprove) {
      return;
    }

    setSubmissionState("approve");
    setLocalError("");

    try {
      await onApprove(action.id, { allowAlways });
    } catch (caughtError) {
      setLocalError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to approve tool request"
      );
    } finally {
      setSubmissionState(null);
    }
  }

  async function handleDismiss() {
    if (!onDismiss) {
      return;
    }

    setSubmissionState("dismiss");
    setLocalError("");

    try {
      await onDismiss(action.id);
    } catch (caughtError) {
      setLocalError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to deny tool request"
      );
    } finally {
      setSubmissionState(null);
    }
  }

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
        </span>
        <span className="text-[12px] font-medium text-white/88">{heading}</span>
      </div>

      <div className="mt-2 space-y-2 text-[12px] leading-5 text-white/70">
        <div className="rounded-md border border-white/6 bg-black/20 px-3 py-2">
          <p className="text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">
            {payload.scope === "mcp" ? "Tool call" : "Command"}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-white/84">
            {getToolApprovalPreview(payload)}
          </p>
        </div>

        {buildToolApprovalNote(payload) ? (
          <p className="text-[11px] leading-5 text-white/48">{buildToolApprovalNote(payload)}</p>
        ) : null}

        {action.status === "error" && action.resultSummary ? (
          <p className="text-[11px] text-red-300">{action.resultSummary}</p>
        ) : null}

        {localError ? <p className="text-[11px] text-red-300">{localError}</p> : null}
      </div>

      {isPending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleApprove(false)}
            disabled={submissionState !== null}
            className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submissionState === "approve" ? "Allowing..." : "Allow once"}
          </button>
          {canAllowAlways ? (
            <button
              type="button"
              onClick={() => void handleApprove(true)}
              disabled={submissionState !== null}
              className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Allow always
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleDismiss()}
            disabled={submissionState !== null}
            className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submissionState === "dismiss" ? "Denying..." : "Deny"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
