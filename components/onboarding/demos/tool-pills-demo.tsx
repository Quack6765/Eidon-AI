"use client";

import { AnimatePresence, motion } from "framer-motion";

import { ToolPill } from "@/components/tool-activity";
import type { DemoPhase } from "@/components/onboarding/demos/demo-script";
import { DemoTranscript } from "@/components/onboarding/demos/demo-transcript";

export function ToolPillsDemo({ phase }: { phase: DemoPhase }) {
  return (
    <DemoTranscript answer={phase.answer}>
      <AnimatePresence initial={false}>
        {phase.pills.map((pill) => (
          <motion.div
            key={pill.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <ToolPill label={pill.label} query={pill.query} status={pill.status} compact />
          </motion.div>
        ))}
      </AnimatePresence>
    </DemoTranscript>
  );
}
