"use client";

import { FOLLOW_UP_SCRIPT, useDemoClock } from "@/components/onboarding/demos/demo-script";
import { QueueFollowUpDemo, SteerFollowUpDemo } from "@/components/onboarding/demos/follow-up-demo";
import { OnboardingOptionTile } from "@/components/onboarding/onboarding-step-shell";
import type { FollowUpBehavior } from "@/lib/types";

export function FollowUpStep({
  value,
  onChange
}: {
  value: FollowUpBehavior;
  onChange: (value: FollowUpBehavior) => void;
}) {
  const { phase } = useDemoClock(FOLLOW_UP_SCRIPT);

  return (
    <div role="radiogroup" aria-label="Follow-up behavior" className="grid gap-3 sm:grid-cols-2">
      <OnboardingOptionTile
        selected={value === "steer"}
        onSelect={() => onChange("steer")}
        title="Steer"
        description="Your message joins the run at its next step, so the agent can change course without stopping."
        ariaLabel="Steer: your message joins the run at its next step"
      >
        <SteerFollowUpDemo phase={phase} />
      </OnboardingOptionTile>
      <OnboardingOptionTile
        selected={value === "queue"}
        onSelect={() => onChange("queue")}
        title="Queue"
        description="Your message is queued and sent as its own turn once this run finishes. Nothing interrupts work in progress."
        ariaLabel="Queue: your message waits and is sent as its own turn once this run finishes"
      >
        <QueueFollowUpDemo phase={phase} />
      </OnboardingOptionTile>
    </div>
  );
}
