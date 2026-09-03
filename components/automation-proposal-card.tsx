"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { describeSchedule } from "@/lib/automation-display";
import { getNextAutomationRunAt } from "@/lib/automation-schedule";
import type {
  AutomationProposalPayload,
  MessageTimelineItem
} from "@/lib/types";

type TimelineAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

const providerProfileNamesById = new Map<string, string>();

function useProviderProfileName(providerProfileId: string) {
  const [name, setName] = useState(() => providerProfileNamesById.get(providerProfileId) ?? "");

  useEffect(() => {
    const cached = providerProfileNamesById.get(providerProfileId);
    if (cached) {
      setName(cached);
      return;
    }

    let cancelled = false;
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { settings?: { providerProfiles?: Array<{ id: string; name: string }> } } | null) => {
        const profiles = payload?.settings?.providerProfiles;
        if (!Array.isArray(profiles)) return;
        for (const profile of profiles) {
          providerProfileNamesById.set(profile.id, profile.name);
        }
        if (!cancelled) {
          setName(providerProfileNamesById.get(providerProfileId) ?? "");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [providerProfileId]);

  return name;
}

import type {
  AutomationProposalOverrides
} from "@/lib/automation-proposals";

export function isAutomationProposalAction(action: TimelineAction): action is TimelineAction & {
  proposalPayload: AutomationProposalPayload;
} {
  return action.kind === "create_automation" && Boolean(action.proposalPayload);
}

export function getAutomationProposalHeading(action: TimelineAction) {
  if (action.status === "error") {
    return "Automation not scheduled";
  }

  if (action.proposalState === "approved") {
    return "Automation scheduled";
  }

  if (action.proposalState === "dismissed") {
    return "Automation ignored";
  }

  if (action.proposalState === "superseded") {
    return "Automation proposal superseded";
  }

  return "Schedule automation";
}

function formatNextRun(schedule: AutomationProposalPayload) {
  try {
    const nextRunAt = getNextAutomationRunAt(
      schedule,
      new Date().toISOString(),
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
    const date = new Date(nextRunAt);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return null;
  }
}

export function AutomationProposalCard({
  action,
  onApprove,
  onDismiss,
  readOnly = false
}: {
  action: TimelineAction;
  onApprove?: (actionId: string, overrides?: AutomationProposalOverrides) => Promise<void>;
  onDismiss?: (actionId: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const proposal = action.proposalPayload as AutomationProposalPayload;
  const providerProfileName = useProviderProfileName(proposal.providerProfileId);
  const isPending = !readOnly && action.status === "pending" && action.proposalState === "pending";
  const heading = getAutomationProposalHeading(action);
  const scheduleSummary = describeSchedule(proposal);
  const nextRunLabel = isPending ? formatNextRun(proposal) : null;
  const [isEditing, setIsEditing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState(proposal.prompt);
  const [submissionState, setSubmissionState] = useState<"approve" | "dismiss" | null>(null);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDraftPrompt(proposal.prompt);
    setIsEditing(false);
    setSubmissionState(null);
    setLocalError("");
  }, [action.id, proposal.prompt]);

  async function handleApprove() {
    if (!onApprove) {
      return;
    }

    const trimmedPrompt = draftPrompt.trim();
    const nextOverrides =
      isEditing && trimmedPrompt && trimmedPrompt !== proposal.prompt
        ? { prompt: trimmedPrompt }
        : undefined;

    setSubmissionState("approve");
    setLocalError("");

    try {
      await onApprove(action.id, nextOverrides);
    } catch (caughtError) {
      setLocalError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to schedule automation"
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
          : "Unable to ignore automation proposal"
      );
    } finally {
      setSubmissionState(null);
    }
  }

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          <CalendarClock className="h-3 w-3 text-violet-400" />
        </span>
        <span className="text-[12px] font-medium text-white/88">{heading}</span>
      </div>

      <div className="mt-2 space-y-2 text-[12px] leading-5 text-white/70">
        <p className="break-words text-[12px] font-medium text-white/84">{proposal.name}</p>

        <p className="text-[12px] text-white/68">
          {scheduleSummary}
          {nextRunLabel ? <span className="text-white/45"> · first run {nextRunLabel}</span> : null}
        </p>

        <p className="text-[11px] text-white/48">
          {proposal.continuePreviousConversation
            ? "Each run continues the previous run's conversation, so briefs build on earlier results."
            : "Each run starts a fresh conversation."}
          {providerProfileName ? ` Runs with ${providerProfileName}.` : ""}
        </p>

        {isEditing && isPending ? (
          <Textarea
            aria-label="Automation prompt"
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            className="min-h-[120px] border-white/8 bg-black/20 px-3 py-2 text-[12px] leading-5 text-white focus-visible:ring-0"
          />
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border border-white/6 bg-black/20 px-3 py-2">
            <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-white/84">
              {proposal.prompt}
            </p>
          </div>
        )}

        {action.status === "error" && action.resultSummary ? (
          <p className="text-[11px] text-red-300">{action.resultSummary}</p>
        ) : null}

        {localError ? <p className="text-[11px] text-red-300">{localError}</p> : null}
      </div>

      {isPending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={submissionState !== null || !draftPrompt.trim()}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submissionState === "approve" ? "Scheduling..." : "Schedule"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftPrompt(proposal.prompt);
                  setIsEditing(false);
                  setLocalError("");
                }}
                disabled={submissionState !== null}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={submissionState !== null}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submissionState === "approve" ? "Scheduling..." : "Schedule"}
              </button>
              <button
                type="button"
                onClick={() => void handleDismiss()}
                disabled={submissionState !== null}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submissionState === "dismiss" ? "Ignoring..." : "Ignore"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftPrompt(proposal.prompt);
                  setIsEditing(true);
                  setLocalError("");
                }}
                disabled={submissionState !== null}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Edit
              </button>
            </>
          )}
        </div>
      ) : null}

      {action.proposalState === "approved" && proposal.automationId ? (
        <Link
          href={`/automations/${proposal.automationId}`}
          className="mt-2 inline-flex items-center text-[11px] font-medium text-violet-300 transition hover:text-violet-200"
        >
          View in Automations workspace →
        </Link>
      ) : null}
    </div>
  );
}
