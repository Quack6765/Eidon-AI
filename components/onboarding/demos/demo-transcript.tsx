"use client";

import type { ReactNode } from "react";

// Short enough to stay on one line in the narrow demo bubble.
const DEMO_PROMPT = "Compare Q3 to the market";

/**
 * The miniature chat frame both demos share: a user turn, the activity area
 * that differs between the two modes, then the streamed answer. Height is
 * fixed so the tiles never reflow as the scripted turn advances.
 */
export function DemoTranscript({ answer, children }: { answer: string; children: ReactNode }) {
  return (
    // Height is fixed so the tiles never reflow as the turn advances, and sized
    // with headroom over the tallest phase: user turn + three pills + answer.
    <div className="flex h-[212px] flex-col gap-2.5 overflow-hidden rounded-xl border border-white/6 bg-black/20 p-3 text-left">
      <div className="flex justify-end">
        <span className="max-w-[80%] rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[13px] leading-5 text-white/80">
          {DEMO_PROMPT}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-start gap-1.5">
        {children}
        {/* truncate keeps the answer on one line at every tile width, so the
            fixed-height frame can never be overflowed. */}
        {answer ? (
          <p className="w-full truncate text-[13px] leading-5 text-white/85">{answer}</p>
        ) : null}
      </div>
    </div>
  );
}
