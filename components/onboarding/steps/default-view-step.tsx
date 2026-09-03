"use client";

import { Bot, Clock, MessageSquare } from "lucide-react";

import { OnboardingOptionTile } from "@/components/onboarding/onboarding-step-shell";
import type { DefaultView } from "@/lib/types";

const VIEWS: Array<{
  id: DefaultView;
  label: string;
  description: string;
  icon: typeof MessageSquare;
}> = [
  {
    id: "chat",
    label: "Chat",
    description: "Open straight into a new conversation.",
    icon: MessageSquare
  },
  {
    id: "agents",
    label: "Agents",
    description: "Start with your bots and their recent work.",
    icon: Bot
  },
  {
    id: "automations",
    label: "Automations",
    description: "Start with scheduled runs and their history.",
    icon: Clock
  }
];

export function DefaultViewStep({
  value,
  onChange
}: {
  value: DefaultView;
  onChange: (value: DefaultView) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Default main view" className="grid gap-3 sm:grid-cols-3">
      {VIEWS.map((view) => {
        const Icon = view.icon;
        return (
          <OnboardingOptionTile
            key={view.id}
            selected={value === view.id}
            onSelect={() => onChange(view.id)}
            title={view.label}
            description={view.description}
          >
            <span className="flex h-16 items-center justify-center rounded-lg border border-white/6 bg-black/20">
              <Icon className="h-5 w-5 text-white/40" aria-hidden="true" />
            </span>
          </OnboardingOptionTile>
        );
      })}
    </div>
  );
}
