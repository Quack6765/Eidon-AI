"use client";

import { ChevronDown, Globe, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { ComputerStage } from "@/components/computer-stage";
import { displayComputerUrl, requestComputerControl, useComputerStream } from "@/hooks/use-computer-stream";
import type { MessageTimelineItem } from "@/lib/types";

type ActionItem = Extract<MessageTimelineItem, { timelineKind: "action" }>;

const OPEN_COMMAND = /agent-browser\s+(?:open|goto|navigate)\s+(\S+)/g;

export function isBrowserAction(item: MessageTimelineItem) {
  return item.timelineKind === "action" && item.kind === "shell_command" && item.label === "Web browser";
}

export function lastOpenedUrl(actions: ActionItem[]) {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const matches = [...(actions[index].detail ?? "").matchAll(OPEN_COMMAND)];
    const url = matches.at(-1)?.[1];
    if (url) return url.replace(/^["']|["']$/g, "");
  }
  return null;
}

const SECONDARY_BUTTON =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/8 px-2.5 text-[11px] font-medium text-white/72 transition hover:border-white/14 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50";

export function ComputerSessionCard({
  actions,
  liveConversationId,
  stepsOpen,
  onToggleSteps,
  children
}: {
  actions: ActionItem[];
  liveConversationId?: string;
  stepsOpen: boolean;
  onToggleSteps: () => void;
  children?: ReactNode;
}) {
  const [stageOpen, setStageOpen] = useState(false);
  const [pendingControl, setPendingControl] = useState<"take" | "return" | null>(null);
  const [controlError, setControlError] = useState("");
  const { view } = useComputerStream(liveConversationId);
  const isLive = Boolean(liveConversationId);
  const url = displayComputerUrl(view.url ?? (isLive ? null : lastOpenedUrl(actions)));
  const userHasControl = isLive && view.controlOwner === "user";
  const runningAction = [...actions].reverse().find((action) => action.status === "running");
  const caption = view.caption ?? runningAction?.detail ?? null;
  const width = view.viewport?.width ?? 16;
  const height = view.viewport?.height ?? 9;
  const stepLabel = `${actions.length} ${actions.length === 1 ? "step" : "steps"}`;

  async function changeControl(action: "take" | "return") {
    if (!liveConversationId) return;
    setPendingControl(action);
    setControlError("");
    try {
      await requestComputerControl(liveConversationId, action);
      if (action === "take") setStageOpen(true);
    } catch (caught) {
      setControlError(caught instanceof Error ? caught.message : "Could not change who controls the browser");
    } finally {
      setPendingControl(null);
    }
  }

  return (
    <div className="w-full rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5" data-testid="computer-session-card">
      <div className="flex min-w-0 items-center gap-2">
        {!isLive && view.frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Frames are in-memory blob URLs from the live browser stream that next/image cannot load.
          <img
            src={view.frameUrl}
            alt=""
            className="h-9 w-14 shrink-0 rounded-md border border-white/6 bg-black/40 object-cover object-top"
          />
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/8 bg-white/[0.03]">
            <Globe className="h-3 w-3 text-indigo-300" aria-hidden="true" />
          </span>
        )}
        <span className="text-[12px] font-medium text-white/88">Browser</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-white/45" title={url ?? undefined}>
          {url}
        </span>
        {isLive ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-300/90" data-testid="computer-live-badge">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
        ) : null}
        <button
          type="button"
          onClick={onToggleSteps}
          aria-expanded={stepsOpen}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          {stepLabel}
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${stepsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </div>

      {isLive ? (
        <div className="mt-2.5">
          <div
            className="relative mx-auto overflow-hidden rounded-md border border-white/6 bg-black/40"
            style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(60vh * ${width} / ${height}))` }}
          >
            {view.frameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Frames are in-memory blob URLs from the live browser stream that next/image cannot load.
              <img
                src={view.frameUrl}
                alt={url ? `Live view of ${url}` : "Live view of the browser"}
                className="absolute inset-0 h-full w-full object-contain"
                data-testid="computer-live-frame"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/40">
                Waiting for the browser…
              </div>
            )}
          </div>
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            {userHasControl ? (
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-emerald-300/90" data-testid="computer-user-control">
                You&apos;re in control of the browser
              </span>
            ) : (
              <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/50" title={caption ?? undefined} data-testid="computer-caption">
                {caption}
              </p>
            )}
            {userHasControl ? (
              <>
                <button type="button" onClick={() => setStageOpen(true)} className={SECONDARY_BUTTON}>
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => void changeControl("return")}
                  disabled={pendingControl !== null}
                  className={SECONDARY_BUTTON}
                >
                  {pendingControl === "return" ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                  Return control
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void changeControl("take")}
                disabled={pendingControl !== null || !view.live}
                className={SECONDARY_BUTTON}
              >
                {pendingControl === "take" ? <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                Take control
              </button>
            )}
          </div>
          {controlError ? <p className="mt-1 text-[11px] text-red-300">{controlError}</p> : null}
        </div>
      ) : null}

      {stepsOpen && children ? <div className="mt-2 flex flex-col gap-1.5">{children}</div> : null}
      {stageOpen && liveConversationId ? (
        <ComputerStage conversationId={liveConversationId} onClose={() => setStageOpen(false)} />
      ) : null}
    </div>
  );
}
