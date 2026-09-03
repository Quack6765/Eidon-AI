"use client";

import { ArrowDown, ArrowUp, LoaderCircle, Plus, RefreshCw, Telescope, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_RESEARCH_PLAN_STEPS, MAX_RESEARCH_PLAN_STEP_CHARS } from "@/lib/constants";
import { parseResearchPlan } from "@/lib/research-mode";
import { cn } from "@/lib/utils";
import type { ResearchPlanDraft } from "@/hooks/use-research-plan-draft";

type ResearchPlanCardProps = {
  draft: ResearchPlanDraft;
  onUpdateStep: (index: number, value: string) => void;
  onAddStep: () => void;
  onRemoveStep: (index: number) => void;
  onMoveStep: (index: number, delta: -1 | 1) => void;
  onRegenerate: () => void;
  onCancel: () => void;
  onStart: () => void;
  className?: string;
};

const iconButton =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-30";

export function ResearchPlanCard({
  draft,
  onUpdateStep,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onRegenerate,
  onCancel,
  onStart,
  className
}: ResearchPlanCardProps) {
  const isLoading = draft.status === "loading";
  const isValid = parseResearchPlan(draft.plan) !== null;
  const canStart = !isLoading && isValid;

  return (
    <section
      aria-label="Research plan"
      className={cn(
        "mb-3 rounded-[24px] border border-[var(--accent)]/30 bg-zinc-900/95 p-4 shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-xl",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
          <Telescope className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white/90">Research plan</h3>
            {isLoading ? (
              <span className="flex items-center gap-1 text-[11px] text-white/45">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                Drafting
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-white/50">{draft.message}</p>
        </div>
        <button
          type="button"
          aria-label="Regenerate plan"
          onClick={onRegenerate}
          disabled={isLoading}
          className={iconButton}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
        </button>
      </div>

      {draft.error ? (
        <p className="mt-3 rounded-xl border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/80">
          {draft.error}. Edit the steps below or try again.
        </p>
      ) : null}

      <ol className="mt-3 space-y-2">
        {draft.plan.map((step, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-white/40">{index + 1}.</span>
            <Input
              aria-label={`Research step ${index + 1}`}
              value={step}
              maxLength={MAX_RESEARCH_PLAN_STEP_CHARS}
              disabled={isLoading}
              onChange={(event) => onUpdateStep(index, event.target.value)}
              className="h-9 flex-1 text-sm"
            />
            <button
              type="button"
              aria-label={`Move step ${index + 1} up`}
              onClick={() => onMoveStep(index, -1)}
              disabled={isLoading || index === 0}
              className={iconButton}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Move step ${index + 1} down`}
              onClick={() => onMoveStep(index, 1)}
              disabled={isLoading || index === draft.plan.length - 1}
              className={iconButton}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Remove step ${index + 1}`}
              onClick={() => onRemoveStep(index)}
              disabled={isLoading || draft.plan.length <= 1}
              className={iconButton}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAddStep}
          disabled={isLoading || draft.plan.length >= MAX_RESEARCH_PLAN_STEPS}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add step
        </button>
        <span className="ml-auto text-[11px] text-white/35">
          {isValid
            ? `${draft.plan.length} of ${MAX_RESEARCH_PLAN_STEPS} steps`
            : `Use 1 to ${MAX_RESEARCH_PLAN_STEPS} non-empty steps, each under ${MAX_RESEARCH_PLAN_STEP_CHARS} characters`}
        </span>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onStart} disabled={!canStart}>
          <Telescope data-icon="inline-start" />
          Start research
        </Button>
      </div>
    </section>
  );
}
