"use client";

import { KeyRound, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { Input } from "@/components/ui/input";
import type { MessageTimelineItem, SecretRequestProposalPayload } from "@/lib/types";

type TimelineAction = Extract<MessageTimelineItem, { timelineKind: "action" }>;

export function isSecretRequestAction(
  action: TimelineAction
): action is TimelineAction & { proposalPayload: SecretRequestProposalPayload } {
  return (
    action.kind === "secret_request" &&
    (action.proposalPayload as { operation?: unknown } | null)?.operation === "secret_request"
  );
}

function siteName(origin: string) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

async function postAction(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(result?.error || "Something went wrong");
  }
}

export function SecretRequestCard({
  action,
  readOnly = false
}: {
  action: TimelineAction & { proposalPayload: SecretRequestProposalPayload };
  readOnly?: boolean;
}) {
  const payload = action.proposalPayload;
  const inputId = useId();
  const site = siteName(payload.origin);
  const isPending = action.status === "pending" && action.proposalState === "pending";
  const canAnswer = isPending && !readOnly;
  const [value, setValue] = useState("");
  const [save, setSave] = useState(payload.save);
  const [submitting, setSubmitting] = useState<"fill" | "decline" | null>(null);
  const [error, setError] = useState("");
  const heading = isPending ? `Enter your ${payload.label} for ${site}` : action.resultSummary || `Your ${payload.label} for ${site}`;

  async function answer(kind: "fill" | "decline") {
    setSubmitting(kind);
    setError("");
    try {
      if (kind === "fill") {
        await postAction(`/api/message-actions/${encodeURIComponent(action.id)}/secret`, { value, save });
        setValue("");
      } else {
        await postAction(`/api/message-actions/${encodeURIComponent(action.id)}/dismiss`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setSubmitting(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value) void answer("fill");
  }

  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5" data-testid="secret-request-card">
      <div className="flex items-center gap-1.5">
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
          <KeyRound className={`h-3 w-3 ${isPending ? "text-violet-400" : "text-white/40"}`} aria-hidden="true" />
        </span>
        <span className="text-[12px] font-medium text-white/88">{heading}</span>
      </div>

      {canAnswer ? (
        <form className="mt-2 space-y-2" onSubmit={handleSubmit}>
          <div className="rounded-md border border-white/6 bg-black/20 px-3 py-2">
            <label htmlFor={inputId} className="text-[10px] font-medium tracking-[0.12em] text-white/45 uppercase">
              {payload.label}
            </label>
            <Input
              id={inputId}
              type="password"
              value={value}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              maxLength={1000}
              onChange={(event) => setValue(event.target.value)}
              className="mt-1 h-9 rounded-md border-white/8 bg-black/20 px-2.5 py-0 text-[16px] text-white md:text-[12px]"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] leading-5 text-white/60">
            <input type="checkbox" checked={save} onChange={(event) => setSave(event.target.checked)} />
            Save it for {site} so bots don&apos;t have to ask again
          </label>
          <p className="text-[11px] leading-5 text-white/48">
            Eidon types it straight into the page on {payload.origin} and won&apos;t send it to the model.
          </p>
          {error ? <p className="text-[11px] text-red-300">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={!value || submitting !== null}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.06] px-3 text-[12px] font-medium text-white transition hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting === "fill" ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              Fill in
            </button>
            <button
              type="button"
              onClick={() => void answer("decline")}
              disabled={submitting !== null}
              className="inline-flex h-8 items-center justify-center rounded-md border border-white/8 bg-transparent px-3 text-[12px] font-medium text-white/72 transition hover:border-white/14 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting === "decline" ? "Declining..." : "Decline"}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-1.5 text-[11px] leading-5 text-white/48">
          {payload.resolution === "filled"
            ? `Typed into the page on ${payload.origin}${payload.saved ? " and saved for next time" : ""}.`
            : `The bot asked for your ${payload.label} on ${payload.origin}.`}
        </p>
      )}
    </div>
  );
}
