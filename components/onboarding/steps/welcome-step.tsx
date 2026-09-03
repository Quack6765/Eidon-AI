"use client";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col items-center px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16 text-center sm:pt-24">
      <Wordmark className="text-lg" />
      <h1
        className="mt-8 text-3xl font-medium leading-tight text-[var(--text)] md:text-4xl"
        style={{ fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif" }}
      >
        Let&apos;s get you set up
      </h1>
      <p className="mt-3 max-w-[48ch] text-sm leading-6 text-[var(--muted)]">
        A few questions and you&apos;ll be ready to work — you can change any of it later in
        settings.
      </p>
      <Button
        type="button"
        size="lg"
        onClick={onNext}
        className="mt-8 min-h-11 min-w-[160px] rounded-full"
      >
        Get started
      </Button>
    </div>
  );
}
