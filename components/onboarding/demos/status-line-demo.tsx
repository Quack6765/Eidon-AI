"use client";

import { AnimatePresence, motion } from "framer-motion";

import { StatusLine } from "@/components/tool-activity";
import type { DemoPhase } from "@/components/onboarding/demos/demo-script";
import { DemoTranscript } from "@/components/onboarding/demos/demo-transcript";

export function StatusLineDemo({ phase }: { phase: DemoPhase }) {
  return (
    <DemoTranscript answer={phase.answer}>
      {/* mode="wait" so each label fades out before the next arrives, which is
          what makes the line read as replacing itself rather than stacking. */}
      <AnimatePresence mode="wait" initial={false}>
        {phase.statusLabel ? (
          <motion.div
            key={phase.statusLabel}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <StatusLine label={phase.statusLabel} compact />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </DemoTranscript>
  );
}
