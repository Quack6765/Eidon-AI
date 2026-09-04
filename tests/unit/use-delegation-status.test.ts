import { afterEach, describe, expect, it } from "vitest";

import {
  applyDelegationWsMessage,
  describeDelegationStatus,
  formatElapsedMinutes,
  ingestBotsPayload,
  resetDelegationStatusForTests,
  resolveDelegationStatus
} from "@/hooks/use-delegation-status";
import type { BotRun, BotSummary } from "@/lib/types";

const bot: BotSummary = {
  id: "bot_1",
  name: "Researcher",
  title: "",
  description: "",
  avatarSeed: "seed",
  isChief: false,
  homeConversationId: "conv_worker",
  providerProfileId: null,
  status: "running",
  waitingForInput: false,
  lastRunAt: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:00:00.000Z"
};

function run(overrides: Partial<BotRun> = {}): BotRun {
  return {
    id: "run_1",
    botId: "bot_1",
    conversationId: "conv_worker",
    triggerSource: "delegated",
    status: "running",
    startedAt: "2026-09-04T10:00:00.000Z",
    finishedAt: null,
    parentMessageId: "msg_chief",
    errorMessage: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...overrides
  };
}

describe("use-delegation-status store", () => {
  afterEach(() => {
    resetDelegationStatusForTests();
  });

  it("resolves the latest run for a message and bot name, case-insensitively", () => {
    ingestBotsPayload({
      bots: [bot],
      runs: [run({ id: "run_old", createdAt: "2026-09-04T09:00:00.000Z", status: "completed" }), run()]
    });

    expect(resolveDelegationStatus("msg_chief", "researcher")?.run.id).toBe("run_1");
    expect(resolveDelegationStatus("msg_other", "researcher")).toBeNull();
    expect(resolveDelegationStatus("msg_chief", "ghost")).toBeNull();
  });

  it("applies run and activity updates from websocket messages", () => {
    ingestBotsPayload({ bots: [bot], runs: [run()] });

    applyDelegationWsMessage({
      type: "bot_activity",
      conversationId: "conv_worker",
      activity: {
        startedAt: "2026-09-04T10:00:00.000Z",
        lastActivityAt: "2026-09-04T10:03:00.000Z",
        currentAction: "Read page",
        stalled: false
      }
    });
    expect(resolveDelegationStatus("msg_chief", "Researcher")?.activity?.currentAction).toBe("Read page");

    applyDelegationWsMessage({ type: "bot_activity", conversationId: "conv_worker", activity: null });
    expect(resolveDelegationStatus("msg_chief", "Researcher")?.activity).toBeNull();

    applyDelegationWsMessage({ type: "bot_run_updated", run: run({ status: "completed" }) });
    expect(resolveDelegationStatus("msg_chief", "Researcher")?.run.status).toBe("completed");
  });

  it("describes queued, running, stalled and finished states", () => {
    const now = Date.parse("2026-09-04T10:04:30.000Z");
    expect(describeDelegationStatus(null, now)).toBeNull();
    expect(describeDelegationStatus({ run: run({ status: "queued" }), activity: null }, now)).toEqual({
      text: "queued",
      stalled: false
    });
    expect(describeDelegationStatus({ run: run(), activity: null }, now)).toEqual({
      text: "working 4m",
      stalled: false
    });
    expect(
      describeDelegationStatus(
        {
          run: run(),
          activity: {
            startedAt: "2026-09-04T10:00:00.000Z",
            lastActivityAt: "2026-09-04T10:04:00.000Z",
            currentAction: "Run command",
            stalled: false
          }
        },
        now
      )
    ).toEqual({ text: "working 4m · Run command", stalled: false });
    expect(
      describeDelegationStatus(
        {
          run: run(),
          activity: {
            startedAt: "2026-09-04T10:00:00.000Z",
            lastActivityAt: "2026-09-04T10:01:00.000Z",
            currentAction: null,
            stalled: true
          }
        },
        now
      )
    ).toEqual({ text: "working 4m · no activity for 3m", stalled: true });
    expect(describeDelegationStatus({ run: run({ status: "completed" }), activity: null }, now)).toBeNull();
  });

  it("formats elapsed minutes compactly", () => {
    const base = Date.parse("2026-09-04T10:00:00.000Z");
    expect(formatElapsedMinutes("2026-09-04T10:00:00.000Z", base + 30_000)).toBe("<1m");
    expect(formatElapsedMinutes("2026-09-04T10:00:00.000Z", base + 7 * 60_000)).toBe("7m");
    expect(formatElapsedMinutes("2026-09-04T10:00:00.000Z", base + 125 * 60_000)).toBe("2h 5m");
  });
});
