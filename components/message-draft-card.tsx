"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResize } from "@/lib/use-auto-resize";
import {
  applyMessageDraftFieldValues,
  getEmptyRequiredDraftFields,
  getMessageDraftExtraArguments,
  getMessageDraftFieldValue,
  isMessageDraftPayload
} from "@/lib/message-draft-display";
import type {
  MessageDraftField,
  MessageDraftProposalPayload,
  MessageTimelineItem
} from "@/lib/types";

type TimelineAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

export function isMessageDraftAction(
  action: TimelineAction
): action is TimelineAction & { proposalPayload: MessageDraftProposalPayload } {
  return action.kind === "draft_message" && isMessageDraftPayload(action.proposalPayload);
}

export function getMessageDraftHeading(action: TimelineAction & { proposalPayload: MessageDraftProposalPayload }) {
  if (action.proposalState === "approved") return "Sent";
  if (action.proposalState === "dismissed") return "Discarded";
  if (action.proposalState === "superseded") return "Replaced by a newer draft";
  if (action.status === "running") return "Sending...";
  if (action.status !== "pending") return "Send interrupted";
  if (action.proposalPayload.sendError) return "Couldn't send";
  return "Ready to send";
}

function getIconTone(action: TimelineAction & { proposalPayload: MessageDraftProposalPayload }) {
  if (action.proposalState === "approved") return "text-emerald-400";
  if (action.proposalState === "dismissed" || action.proposalState === "superseded") return "text-white/40";
  if (action.status === "error" || action.proposalPayload.sendError) return "text-red-300";
  return "text-violet-400";
}

function readFieldValues(payload: MessageDraftProposalPayload) {
  return Object.fromEntries(
    payload.fields.map((field) => [field.key, getMessageDraftFieldValue(payload, field)])
  );
}

function DraftBody({ value, label }: { value: string; label?: string }) {
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;

    const measure = () => setCanExpand(body.scrollHeight > body.clientHeight + 1);
    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [value, expanded]);

  return (
    <div>
      {label ? (
        <p className="mb-1 text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">{label}</p>
      ) : null}
      <p
        ref={bodyRef}
        data-testid="message-draft-body"
        className={`whitespace-pre-wrap break-words text-[12px] leading-5 text-white/84 ${expanded ? "" : "line-clamp-8"}`}
      >
        {value}
      </p>
      {canExpand || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-[11px] font-medium text-white/55 transition hover:text-white"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function DraftPreview({ payload }: { payload: MessageDraftProposalPayload }) {
  const headerFields = payload.fields.filter((field) => field.format !== "multiline");
  const bodyFields = payload.fields.filter((field) => field.format === "multiline");

  return (
    <div className="rounded-md border border-white/6 bg-black/20 px-3 py-2">
      {headerFields.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          {headerFields.map((field) => (
            <React.Fragment key={field.key}>
              <dt className="text-[12px] leading-5 text-white/45">{field.label}</dt>
              <dd className="break-words text-[12px] leading-5 text-white/84">
                {getMessageDraftFieldValue(payload, field) || <span className="text-white/48">Empty</span>}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}

      {bodyFields.length ? (
        <div className={`space-y-2 ${headerFields.length ? "mt-2 border-t border-white/6 pt-2" : ""}`}>
          {bodyFields.map((field) => (
            <DraftBody
              key={field.key}
              value={getMessageDraftFieldValue(payload, field)}
              label={bodyFields.length > 1 ? field.label : undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight
  );

  useEffect(() => {
    const handleResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return viewportHeight;
}

function DraftTextarea({
  id,
  value,
  autoFocus,
  onChange
}: {
  id: string;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { height } = useAutoResize({ ref: textareaRef, value, minHeight: 120 });
  const viewportHeight = useViewportHeight();
  const reachedCap = height >= viewportHeight * 0.6;

  return (
    <Textarea
      ref={textareaRef}
      id={id}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      className={`mt-1 max-h-[60vh] resize-none rounded-md border-white/8 bg-black/20 px-3 py-2 text-[16px] leading-6 text-white transition-[border-color,background-color,box-shadow] md:text-[12px] md:leading-5 ${reachedCap ? "overflow-y-auto" : "overflow-y-hidden"}`}
    />
  );
}

function DraftFieldEditor({
  field,
  value,
  autoFocus,
  onChange
}: {
  field: MessageDraftField;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const hintId = field.format === "list" ? `${id}-hint` : undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">
          {field.label}
        </label>
        {hintId ? (
          <span id={hintId} className="text-[11px] text-white/48">
            Separate with commas
          </span>
        ) : null}
      </div>
      {field.format === "multiline" ? (
        <DraftTextarea id={id} value={value} autoFocus={autoFocus} onChange={onChange} />
      ) : (
        <Input
          id={id}
          value={value}
          autoFocus={autoFocus}
          aria-describedby={hintId}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 h-9 rounded-md border-white/8 bg-black/20 px-2.5 py-0 text-[16px] text-white md:text-[12px]"
        />
      )}
    </div>
  );
}

const PRIMARY_BUTTON =
  "inline-flex h-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

export function MessageDraftCard({
  action,
  onSend,
  onDiscard,
  readOnly = false
}: {
  action: TimelineAction;
  onSend?: (actionId: string, fields?: Record<string, string>) => Promise<void>;
  onDiscard?: (actionId: string) => Promise<void>;
  readOnly?: boolean;
}) {
  const draftAction = action as TimelineAction & { proposalPayload: MessageDraftProposalPayload };
  const payload = draftAction.proposalPayload;
  const isPending = !readOnly && action.status === "pending" && action.proposalState === "pending";
  const [isEditing, setIsEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => readFieldValues(payload));
  const [submissionState, setSubmissionState] = useState<"send" | "discard" | null>(null);
  const [localError, setLocalError] = useState("");
  const [returnFocusToEdit, setReturnFocusToEdit] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const requiredMessageId = useId();
  const extraArguments = getMessageDraftExtraArguments(payload);
  const emptyRequiredFields = isEditing
    ? getEmptyRequiredDraftFields(payload, applyMessageDraftFieldValues(payload, values))
    : [];

  useEffect(() => {
    if (returnFocusToEdit && !isEditing) {
      editButtonRef.current?.focus();
      setReturnFocusToEdit(false);
    }
  }, [returnFocusToEdit, isEditing]);

  async function handleSend() {
    if (!onSend) return;

    setSubmissionState("send");
    setLocalError("");

    try {
      await onSend(action.id, isEditing ? values : undefined);
    } catch (caughtError) {
      setLocalError(caughtError instanceof Error ? caughtError.message : "Unable to send the draft");
    } finally {
      setSubmissionState(null);
    }
  }

  async function handleDiscard() {
    if (!onDiscard) return;

    setSubmissionState("discard");
    setLocalError("");

    try {
      await onDiscard(action.id);
    } catch (caughtError) {
      setLocalError(caughtError instanceof Error ? caughtError.message : "Unable to discard the draft");
    } finally {
      setSubmissionState(null);
    }
  }

  function handleCancelEdit() {
    setValues(readFieldValues(payload));
    setIsEditing(false);
    setLocalError("");
    setReturnFocusToEdit(true);
  }

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5" data-testid="message-draft-card">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          <Send className={`h-3 w-3 ${getIconTone(draftAction)}`} />
        </span>
        <span className="text-[12px] font-medium text-white/88">{getMessageDraftHeading(draftAction)}</span>
        <span className="min-w-0 truncate text-[11px] text-white/45">
          {payload.mcpServerName} · {payload.toolLabel}
        </span>
      </div>

      <div className="mt-2 space-y-2 text-[12px] leading-5 text-white/70">
        {isEditing && isPending ? (
          <div className="space-y-2">
            {payload.fields.map((field, index) => (
              <DraftFieldEditor
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                autoFocus={index === 0}
                onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              />
            ))}
            {emptyRequiredFields.length ? (
              <p id={requiredMessageId} role="status" className="text-[11px] text-white/48">
                {emptyRequiredFields.map((field) => field.label).join(", ")} can&apos;t be empty.
              </p>
            ) : null}
          </div>
        ) : (
          <DraftPreview payload={payload} />
        )}

        {extraArguments.length ? (
          <p className="break-words text-[11px] leading-5 text-white/48">
            Also sent: {extraArguments.map(({ key, value }) => `${key}: ${value}`).join(" · ")}
          </p>
        ) : null}

        {isPending && payload.sendError ? (
          <div className="space-y-0.5">
            <p className="break-words text-[11px] text-red-300">
              {payload.mcpServerName} didn&apos;t send it: {payload.sendError}
            </p>
            {isEditing ? null : (
              <p className="text-[11px] text-white/48">Edit the draft and send it again, or discard it.</p>
            )}
          </div>
        ) : null}

        {action.status === "error" && action.proposalState === "pending" ? (
          <p className="text-[11px] text-red-300">
            The server restarted while sending, so this may or may not have gone out. Check {payload.mcpServerName} before
            sending it again.
          </p>
        ) : null}

        {localError && isPending ? <p className="text-[11px] text-red-300">{localError}</p> : null}
      </div>

      {isPending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={submissionState !== null || emptyRequiredFields.length > 0}
            aria-describedby={emptyRequiredFields.length ? requiredMessageId : undefined}
            className={PRIMARY_BUTTON}
          >
            {submissionState === "send" ? "Sending..." : "Send"}
          </button>
          {isEditing ? (
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={submissionState !== null}
              className={SECONDARY_BUTTON}
            >
              Cancel
            </button>
          ) : (
            <>
              <button
                ref={editButtonRef}
                type="button"
                onClick={() => {
                  setValues(readFieldValues(payload));
                  setIsEditing(true);
                  setLocalError("");
                }}
                disabled={submissionState !== null}
                className={SECONDARY_BUTTON}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void handleDiscard()}
                disabled={submissionState !== null}
                className={SECONDARY_BUTTON}
              >
                {submissionState === "discard" ? "Discarding..." : "Discard"}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
