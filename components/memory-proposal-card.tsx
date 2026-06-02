"use client";

import React, { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type {
  MemoryCategory,
  MessageTimelineItem
} from "@/lib/types";

export function isMemoryProposalAction(
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>
) {
  return (
    (action.kind === "create_memory" ||
      action.kind === "update_memory" ||
      action.kind === "delete_memory") &&
    action.proposalPayload
  );
}

export function getMemoryProposalHeading(
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>
) {
  const operation = action.proposalPayload?.operation;

  if (action.status === "error") {
    return "Memory not saved";
  }

  if (action.proposalState === "approved") {
    if (operation === "update") {
      return "Memory updated";
    }

    if (operation === "delete") {
      return "Memory deleted";
    }

    return "Memory saved";
  }

  if (action.proposalState === "dismissed") {
    return "Memory ignored";
  }

  if (action.proposalState === "superseded") {
    return "Memory proposal superseded";
  }

  if (operation === "update") {
    return "Update memory";
  }

  if (operation === "delete") {
    return "Delete memory";
  }

  return "Save memory";
}

function MemorySnapshot({
  label,
  content,
  category
}: {
  label: string;
  content: string;
  category: MemoryCategory;
}) {
  return (
    <div className="rounded-md border border-white/6 bg-black/20 px-3 py-2">
      <p className="text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-white/84">
        {content}
      </p>
      <p className="mt-1 text-[11px] text-white/48">{category}</p>
    </div>
  );
}

export function MemoryProposalCard({
  action,
  onApprove,
  onDismiss,
  readOnly = false
}: {
  action: Extract<MessageTimelineItem, { timelineKind: "action" }>;
  onApprove?: (
    actionId: string,
    overrides?: { content?: string; category?: MemoryCategory }
  ) => Promise<void>;
  onDismiss?: (actionId: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const proposal = action.proposalPayload!;
  const editableMemory = proposal.proposedMemory;
  const displayMemory = proposal.proposedMemory ?? proposal.currentMemory ?? null;
  const currentMemory = proposal.currentMemory ?? null;
  const canEdit = action.kind !== "delete_memory" && Boolean(editableMemory);
  const isPending = !readOnly && action.status === "pending" && action.proposalState === "pending";
  const isDelete = proposal.operation === "delete";
  const heading = getMemoryProposalHeading(action);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(editableMemory?.content ?? "");
  const [draftCategory, setDraftCategory] = useState<MemoryCategory>(
    editableMemory?.category ?? currentMemory?.category ?? "other"
  );
  const [submissionState, setSubmissionState] = useState<"approve" | "dismiss" | null>(null);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setDraftContent(editableMemory?.content ?? "");
    setDraftCategory(editableMemory?.category ?? currentMemory?.category ?? "other");
    setIsEditing(false);
    setSubmissionState(null);
    setLocalError("");
  }, [action.id, editableMemory?.content, editableMemory?.category, currentMemory?.category]);

  function resetDraft() {
    setDraftContent(editableMemory?.content ?? "");
    setDraftCategory(editableMemory?.category ?? currentMemory?.category ?? "other");
  }

  function handleCancelEdit() {
    resetDraft();
    setIsEditing(false);
    setLocalError("");
  }

  async function handleApprove() {
    if (!onApprove) {
      return;
    }

    const trimmedContent = draftContent.trim();
    const nextOverrides =
      canEdit && !isDelete && trimmedContent
        ? {
            content: trimmedContent,
            category: draftCategory
          }
        : undefined;

    setSubmissionState("approve");
    setLocalError("");

    try {
      await onApprove(action.id, nextOverrides);
    } catch (caughtError) {
      setLocalError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to save memory proposal"
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
          : "Unable to ignore memory proposal"
      );
    } finally {
      setSubmissionState(null);
    }
  }

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          <Brain className="h-3 w-3 text-violet-400" />
        </span>
        <span className="text-[12px] font-medium text-white/88">{heading}</span>
      </div>

      <div className="mt-2 space-y-2 text-[12px] leading-5 text-white/70">
        {isEditing && canEdit && isPending ? (
          <>
            <Textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              className="min-h-[80px] border-white/8 bg-black/20 px-3 py-2 text-[12px] leading-5 text-white focus-visible:ring-0"
            />
            <select
              value={draftCategory}
              onChange={(event) => setDraftCategory(event.target.value as MemoryCategory)}
              className="h-9 rounded-md border border-white/8 bg-black/20 px-2.5 text-[12px] text-white outline-none transition focus:border-white/15"
            >
              <option value="personal">personal</option>
              <option value="preference">preference</option>
              <option value="work">work</option>
              <option value="location">location</option>
              <option value="other">other</option>
            </select>
          </>
        ) : proposal.operation === "update" && currentMemory && displayMemory ? (
          <div className="grid gap-2">
            <MemorySnapshot
              label="Before"
              content={currentMemory.content}
              category={currentMemory.category}
            />
            <MemorySnapshot
              label="After"
              content={displayMemory.content}
              category={displayMemory.category}
            />
          </div>
        ) : proposal.operation === "delete" && currentMemory ? (
          <>
            <p className="text-[12px] text-white/68">Remove this memory from saved context.</p>
            <MemorySnapshot
              label="Current memory"
              content={currentMemory.content}
              category={currentMemory.category}
            />
          </>
        ) : displayMemory ? (
          <MemorySnapshot
            label={isPending ? "Proposed memory" : "Memory"}
            content={displayMemory.content}
            category={displayMemory.category}
          />
        ) : null}

        {action.status === "error" && action.resultSummary ? (
          <p className="text-[11px] text-red-300">{action.resultSummary}</p>
        ) : null}

        {localError ? <p className="text-[11px] text-red-300">{localError}</p> : null}
      </div>

      {isPending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isEditing && canEdit ? (
            <>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={submissionState !== null || !draftContent.trim()}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submissionState === "approve" ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
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
                {submissionState === "approve"
                  ? isDelete
                    ? "Deleting..."
                    : "Saving..."
                  : isDelete
                    ? "Delete memory"
                    : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void handleDismiss()}
                disabled={submissionState !== null}
                className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submissionState === "dismiss"
                  ? isDelete
                    ? "Cancelling..."
                    : "Ignoring..."
                  : isDelete
                    ? "Cancel"
                    : "Ignore"}
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    resetDraft();
                    setIsEditing(true);
                    setLocalError("");
                  }}
                  disabled={submissionState !== null}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
