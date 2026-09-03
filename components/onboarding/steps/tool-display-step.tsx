"use client";

import { useDemoClock } from "@/components/onboarding/demos/demo-script";
import { StatusLineDemo } from "@/components/onboarding/demos/status-line-demo";
import { ToolPillsDemo } from "@/components/onboarding/demos/tool-pills-demo";
import { OnboardingOptionTile } from "@/components/onboarding/onboarding-step-shell";
import type { ToolCallDisplayMode } from "@/lib/types";

export function ToolDisplayStep({
  value,
  onChange
}: {
  value: ToolCallDisplayMode;
  onChange: (value: ToolCallDisplayMode) => void;
}) {
  // One clock for both demos, so they always show the same moment of the turn.
  const { phase } = useDemoClock();

  return (
    <div role="radiogroup" aria-label="Tool activity display" className="grid gap-3 sm:grid-cols-2">
      <OnboardingOptionTile
        selected={value === "pills"}
        onSelect={() => onChange("pills")}
        title="Tool pills"
        description="Keep a record of every tool call."
        ariaLabel="Tool pills: keep a record of every tool call"
      >
        <ToolPillsDemo phase={phase} />
      </OnboardingOptionTile>
      <OnboardingOptionTile
        selected={value === "status_line"}
        onSelect={() => onChange("status_line")}
        title="Single status line"
        description="One quiet line, nothing left behind."
        ariaLabel="Single status line: one quiet line, nothing left behind"
      >
        <StatusLineDemo phase={phase} />
      </OnboardingOptionTile>
    </div>
  );
}
