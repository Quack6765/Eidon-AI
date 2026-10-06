"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

export type DemoPill = {
  id: string;
  label: string;
  query?: string;
  status: "running" | "completed";
};

export type DemoPhase = {
  /** Live activity text. Empty when the line rests on the turn summary instead. */
  statusLabel: string;
  summaryLabel: string;
  pills: DemoPill[];
  answer: string;
};

// Labels match the real built-in tools: "Search workspace" (tool-executors.ts)
// looks through your own conversations and memories, "Web search" goes outside.
const THINK: DemoPill = { id: "think", label: "Thinking", status: "running" };
const WORKSPACE: DemoPill = { id: "workspace", label: "Search workspace", status: "running" };
const SEARCH: DemoPill = {
  id: "search",
  label: "Web search",
  query: "q3 industry benchmarks",
  status: "running"
};

const done = (pill: DemoPill): DemoPill => ({ ...pill, status: "completed" });

/**
 * One scripted turn, rendered by both demos so the comparison is honest: the
 * pills column accumulates a record while the status line replaces itself and
 * then rests on the count summary.
 */
export const DEMO_SCRIPT: Array<{ phase: DemoPhase; holdMs: number }> = [
  { phase: { statusLabel: "Working…", summaryLabel: "", pills: [], answer: "" }, holdMs: 700 },
  { phase: { statusLabel: "Thinking…", summaryLabel: "", pills: [THINK], answer: "" }, holdMs: 900 },
  {
    phase: { statusLabel: "Search workspace", summaryLabel: "", pills: [done(THINK), WORKSPACE], answer: "" },
    holdMs: 1000
  },
  {
    phase: { statusLabel: "", summaryLabel: "1 tool", pills: [done(THINK), done(WORKSPACE)], answer: "" },
    holdMs: 500
  },
  {
    phase: {
      statusLabel: "Web search: q3 industry benchmarks",
      summaryLabel: "",
      pills: [done(THINK), done(WORKSPACE), SEARCH],
      answer: ""
    },
    holdMs: 1200
  },
  {
    phase: {
      statusLabel: "",
      summaryLabel: "1 tool, 1 web search",
      pills: [done(THINK), done(WORKSPACE), done(SEARCH)],
      answer: "Revenue grew 12%,"
    },
    holdMs: 400
  },
  {
    phase: {
      statusLabel: "",
      summaryLabel: "1 tool, 1 web search",
      pills: [done(THINK), done(WORKSPACE), done(SEARCH)],
      // Kept to one short line so it never wraps out of the fixed-height frame.
      answer: "Revenue grew 12%, ahead of market."
    },
    holdMs: 1600
  }
];

export const FINAL_DEMO_PHASE = DEMO_SCRIPT[DEMO_SCRIPT.length - 1].phase;

const RUNNING_THINK: DemoPill = { id: "think", label: "Thinking", status: "running" };
const RUNNING_WORKSPACE: DemoPill = { id: "workspace", label: "Search workspace", status: "running" };

export type FollowUpDemoPhase = {
  pills: DemoPill[];
  sent: boolean;
  routed: boolean;
  settled: boolean;
  newTurn: boolean;
  replied: boolean;
};

const PHASE = (overrides: Partial<FollowUpDemoPhase>): FollowUpDemoPhase => ({
  pills: [],
  sent: false,
  routed: false,
  settled: false,
  newTurn: false,
  replied: false,
  ...overrides
});

export const FOLLOW_UP_SCRIPT: Array<{ phase: FollowUpDemoPhase; holdMs: number }> = [
  { phase: PHASE({ pills: [RUNNING_THINK] }), holdMs: 900 },
  { phase: PHASE({ pills: [RUNNING_THINK], sent: true }), holdMs: 1700 },
  {
    phase: PHASE({ pills: [done(RUNNING_THINK), RUNNING_WORKSPACE], sent: true, routed: true }),
    holdMs: 1900
  },
  {
    phase: PHASE({
      pills: [done(RUNNING_THINK), done(RUNNING_WORKSPACE)],
      sent: true,
      routed: true,
      settled: true
    }),
    holdMs: 1500
  },
  {
    phase: PHASE({
      pills: [done(RUNNING_THINK), done(RUNNING_WORKSPACE)],
      sent: true,
      routed: true,
      settled: true,
      newTurn: true
    }),
    holdMs: 1400
  },
  {
    phase: PHASE({
      pills: [done(RUNNING_THINK), done(RUNNING_WORKSPACE)],
      sent: true,
      routed: true,
      settled: true,
      newTurn: true,
      replied: true
    }),
    holdMs: 2000
  }
];

/**
 * Drives one looping clock for the whole step so both demos stay in lockstep.
 * Returns the resting final phase when the user prefers reduced motion.
 */
export function useDemoClock<Phase>(script: Array<{ phase: Phase; holdMs: number }>) {
  const prefersReducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = setTimeout(() => {
      setIndex((current) => (current + 1) % script.length);
    }, script[index].holdMs);
    return () => clearTimeout(timer);
  }, [index, prefersReducedMotion, script]);

  if (prefersReducedMotion) {
    return { phase: script[script.length - 1].phase, isAnimating: false };
  }
  return { phase: script[index].phase, isAnimating: true };
}

export function useFadedIn(durationMs = 320) {
  const prefersReducedMotion = useReducedMotion();
  const [opacity, setOpacity] = useState(prefersReducedMotion ? 1 : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setOpacity(1);
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      setOpacity(progress);
      if (progress >= 1) clearInterval(timer);
    }, 24);

    return () => clearInterval(timer);
  }, [durationMs, prefersReducedMotion]);

  return opacity;
}

export function useStreamedText(text: string, charsPerSecond = 30) {
  const prefersReducedMotion = useReducedMotion();
  const [shown, setShown] = useState("");

  useEffect(() => {
    if (prefersReducedMotion || !text) {
      setShown(text);
      return;
    }

    const startedAt = Date.now();
    setShown("");
    const timer = setInterval(() => {
      const revealed = Math.floor(((Date.now() - startedAt) / 1000) * charsPerSecond);
      setShown(revealed >= text.length ? text : text.slice(0, revealed));
    }, 28);

    return () => clearInterval(timer);
  }, [text, charsPerSecond, prefersReducedMotion]);

  return shown;
}
