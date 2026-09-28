"use client";

import Image from "next/image";

import { OnboardingOptionTile } from "@/components/onboarding/onboarding-step-shell";
import type { DefaultView } from "@/lib/types";

const VIEWS: Array<{
  id: DefaultView;
  label: string;
  description: string;
  screenshot: string;
  alt: string;
}> = [
  {
    id: "chat",
    label: "Chat",
    description: "Open straight into the conversation view.",
    screenshot: "/screenshots/desktop-chat.png",
    alt: "Eidon chat with a tool timeline and queued follow-ups"
  },
  {
    id: "agents",
    label: "Agents",
    description: "Start with your bots and their recent work.",
    screenshot: "/screenshots/desktop-delegation.png",
    alt: "Chief of Staff agent messaging two specialist bots"
  },
  {
    id: "automations",
    label: "Automations",
    description: "Start with scheduled runs and their history.",
    screenshot: "/screenshots/desktop-automations.png",
    alt: "Automations list with run history"
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
    <div role="radiogroup" aria-label="Default main view" className="flex flex-col gap-3">
      {VIEWS.map((view) => (
        <OnboardingOptionTile
          key={view.id}
          selected={value === view.id}
          onSelect={() => onChange(view.id)}
          title={view.label}
          description={view.description}
          className="lg:flex-row lg:items-center lg:gap-6 lg:p-4"
        >
          <span className="block overflow-hidden rounded-lg border border-white/6 bg-black/20 lg:w-[54%] lg:shrink-0">
            <Image
              src={view.screenshot}
              alt={view.alt}
              width={1280}
              height={1040}
              unoptimized
              className="h-auto w-full max-h-64 object-cover object-top sm:max-h-none"
            />
          </span>
        </OnboardingOptionTile>
      ))}
    </div>
  );
}
