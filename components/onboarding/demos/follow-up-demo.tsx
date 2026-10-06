"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  useFadedIn,
  useStreamedText,
  type DemoPill,
  type FollowUpDemoPhase
} from "@/components/onboarding/demos/demo-script";
import { AgentLine, DemoTranscript } from "@/components/onboarding/demos/demo-transcript";
import { ToolPill } from "@/components/tool-activity";

const FOLLOW_UP = "Use the European numbers too";
const STEER_ACK = "Switching to European data.";
const NEW_TURN_ANSWER = "Europe included: 9% growth.";

const STEER_INSERT_INDEX = 1;
const FOLLOW_UP_FRAME_HEIGHT = 288;

const ROUTE_LABELS = {
  steer: "sends between tool calls",
  queued: "sends after this run"
} as const;

type Route = "sent" | "steer" | "queued" | "newTurn";

const CHIP_TEXT: Record<Route, { label: string; hint?: string }> = {
  sent: { label: "You sent this", hint: "just now" },
  steer: { label: "Steer", hint: ROUTE_LABELS.steer },
  queued: { label: "Queued", hint: ROUTE_LABELS.queued },
  newTurn: { label: "New turn", hint: "the agent starts here" }
};

function Chip({ route }: { route: Route }) {
  const text = CHIP_TEXT[route];

  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-violet-200/80">
      {text.label}
      {text.hint ? (
        <span className="normal-case tracking-normal text-violet-200/60">{text.hint}</span>
      ) : null}
    </span>
  );
}

function SentMessage({ route, waiting }: { route: Route; waiting?: boolean }) {
  const fade = useFadedIn();

  return (
    <div className="w-full" style={{ opacity: fade }}>
      <div
        className={`flex w-full flex-col items-end gap-1 transition-opacity duration-200 ${
          waiting ? "opacity-[0.45]" : "opacity-100"
        }`}
      >
        <span className="max-w-[80%] rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[13px] leading-5 text-white/80">
          {FOLLOW_UP}
        </span>
        <Chip route={route} />
      </div>
    </div>
  );
}

function Pill({ data }: { data: DemoPill }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
    >
      <ToolPill label={data.label} query={data.query} status={data.status} compact />
    </motion.div>
  );
}

function ToolRun({ phase }: { phase: FollowUpDemoPhase }) {
  return (
    <AnimatePresence initial={false}>
      {phase.pills.map((item) => (
        <Pill key={item.id} data={item} />
      ))}
    </AnimatePresence>
  );
}

function SteerAck() {
  return <AgentLine>{useStreamedText(STEER_ACK)}</AgentLine>;
}

function NewTurnActivity({ replied }: { replied: boolean }) {
  const answer = useStreamedText(replied ? NEW_TURN_ANSWER : "");

  if (replied) {
    return <AgentLine>{answer}</AgentLine>;
  }

  return (
    <div className="w-full">
      <ToolPill label="Thinking" status="running" compact />
    </div>
  );
}

export function SteerFollowUpDemo({ phase }: { phase: FollowUpDemoPhase }) {
  const answer = useStreamedText(phase.settled ? "Europe included: 9% growth." : "");

  return (
    <DemoTranscript
      answer={answer}
      height={FOLLOW_UP_FRAME_HEIGHT}
      footer={phase.sent && !phase.routed ? <SentMessage route="sent" /> : null}
    >
      <AnimatePresence initial={false}>
        {phase.pills.map((item, index) => (
          <React.Fragment key={item.id}>
            {phase.routed && index === STEER_INSERT_INDEX ? (
              <React.Fragment key={`${item.id}-follow-up`}>
                <SentMessage route="steer" />
                <SteerAck />
              </React.Fragment>
            ) : null}
            <Pill data={item} />
          </React.Fragment>
        ))}
        {phase.routed && STEER_INSERT_INDEX >= phase.pills.length ? (
          <React.Fragment key="trailing-follow-up">
            <SentMessage route="steer" />
            <SteerAck />
          </React.Fragment>
        ) : null}
      </AnimatePresence>
    </DemoTranscript>
  );
}

export function QueueFollowUpDemo({ phase }: { phase: FollowUpDemoPhase }) {
  const waiting = phase.sent && !phase.newTurn;
  const answer = useStreamedText(phase.settled ? "Revenue grew 12%, ahead of market." : "");

  return (
    <DemoTranscript
      answer={answer}
      height={FOLLOW_UP_FRAME_HEIGHT}
      afterAnswer={
        phase.newTurn ? (
          <>
            <SentMessage route="newTurn" />
            <NewTurnActivity replied={phase.replied} />
          </>
        ) : null
      }
      footer={
        waiting ? (
          <SentMessage
            route={phase.routed ? "queued" : "sent"}
            waiting={phase.routed && !phase.settled}
          />
        ) : null
      }
    >
      <ToolRun phase={phase} />
    </DemoTranscript>
  );
}
