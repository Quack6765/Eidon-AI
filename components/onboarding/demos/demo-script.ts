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
  /** Empty means the status line is hidden, the way it is once text starts streaming. */
  statusLabel: string;
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
 * then disappears entirely.
 */
export const DEMO_SCRIPT: Array<{ phase: DemoPhase; holdMs: number }> = [
  { phase: { statusLabel: "Working…", pills: [], answer: "" }, holdMs: 700 },
  { phase: { statusLabel: "Thinking…", pills: [THINK], answer: "" }, holdMs: 900 },
  {
    phase: { statusLabel: "Search workspace", pills: [done(THINK), WORKSPACE], answer: "" },
    holdMs: 1000
  },
  {
    phase: { statusLabel: "Working…", pills: [done(THINK), done(WORKSPACE)], answer: "" },
    holdMs: 500
  },
  {
    phase: {
      statusLabel: "Web search: q3 industry benchmarks",
      pills: [done(THINK), done(WORKSPACE), SEARCH],
      answer: ""
    },
    holdMs: 1200
  },
  {
    phase: {
      statusLabel: "",
      pills: [done(THINK), done(WORKSPACE), done(SEARCH)],
      answer: "Revenue grew 12%,"
    },
    holdMs: 400
  },
  {
    phase: {
      statusLabel: "",
      pills: [done(THINK), done(WORKSPACE), done(SEARCH)],
      // Kept to one short line so it never wraps out of the fixed-height frame.
      answer: "Revenue grew 12%, ahead of market."
    },
    holdMs: 1600
  }
];

export const FINAL_DEMO_PHASE = DEMO_SCRIPT[DEMO_SCRIPT.length - 1].phase;

/**
 * Drives one looping clock for the whole step so both demos stay in lockstep.
 * Returns the resting final phase when the user prefers reduced motion.
 */
export function useDemoClock(script = DEMO_SCRIPT) {
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
