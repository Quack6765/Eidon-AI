"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shared chrome for every onboarding step: numbered eyebrow, display heading,
 * subtitle, the option plane, then the action footer.
 *
 * The option area is a hairline-bounded plane rather than a card — DESIGN.md
 * forbids nesting cards, and the option tiles inside are themselves cards.
 */
export function OnboardingStepShell({
  progress,
  title,
  subtitle,
  children,
  onBack,
  onSkip,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  isBusy = false,
  wide = false
}: {
  progress: { current: number; total: number } | null;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  onSkip?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  isBusy?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto flex w-full flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-8 sm:pt-16 ${
        wide ? "max-w-[1100px]" : "max-w-[760px]"
      }`}
    >
      {progress ? (
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
          Step {progress.current} of {progress.total}
        </p>
      ) : null}
      <h1
        className="mt-3 text-center text-2xl font-medium leading-tight text-[var(--text)] md:text-3xl"
        style={{ fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif" }}
      >
        {title}
      </h1>
      {subtitle ? (
        <p className="mx-auto mt-2 max-w-[52ch] text-center text-sm leading-6 text-[var(--muted)]">
          {subtitle}
        </p>
      ) : null}

      <div className="mt-8 rounded-2xl border border-white/[0.06] p-4 sm:p-6">{children}</div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onBack}
            disabled={isBusy}
            className="min-h-11 rounded-full"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
        ) : null}
        <Button
          type="button"
          size="lg"
          onClick={onNext}
          disabled={nextDisabled || isBusy}
          className="min-h-11 min-w-[140px] rounded-full"
        >
          {isBusy ? "Saving…" : nextLabel}
        </Button>
        {onSkip ? (
          <Button
            type="button"
            variant="link"
            size="lg"
            onClick={onSkip}
            disabled={isBusy}
            className="min-h-11 text-[var(--muted)]"
          >
            Skip for now
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Selectable option tile. Flat at rest, accent ring when chosen — violet stays
 * scarce, and selection never uses a shadow.
 */
export function OnboardingOptionTile({
  selected,
  onSelect,
  title,
  description,
  children,
  ariaLabel,
  className
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel ?? title}
      onClick={onSelect}
      className={`flex min-h-11 w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${className ?? ""} ${
        selected
          ? "border-[var(--accent)]/45 bg-[var(--accent-soft)] shadow-[0_0_0_3px_var(--accent-soft)]"
          : "border-white/6 bg-white/[0.02] hover:border-white/12"
      }`}
    >
      {children}
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold text-[var(--text)]">{title}</span>
        {description ? (
          <span className="text-xs leading-5 text-[var(--muted)]">{description}</span>
        ) : null}
      </span>
    </button>
  );
}
