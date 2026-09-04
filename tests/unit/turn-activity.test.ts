import { afterEach, describe, expect, it, vi } from "vitest";

import { claimChatTurnStart, clearChatTurn } from "@/lib/chat-turn-control";
import {
  DELEGATED_TURN_STALL_STOP_MS,
  TURN_STALL_AFTER_MS,
  beginTurnActivity,
  consumeStallStop,
  endTurnActivity,
  finishTurnAction,
  getTurnActivity,
  resetTurnActivityForTests,
  scanTurnActivity,
  setTurnStallStop,
  startTurnAction,
  touchTurnActivity
} from "@/lib/turn-activity";

describe("turn-activity", () => {
  afterEach(() => {
    resetTurnActivityForTests();
  });

  it("tracks the current action and emits changes", () => {
    const changes: Array<unknown> = [];
    beginTurnActivity("conv_a", { onChange: (activity) => changes.push(activity) });

    expect(getTurnActivity("conv_a")).toMatchObject({ currentAction: null, stalled: false });

    startTurnAction("conv_a", "act_1", "Search web");
    expect(getTurnActivity("conv_a")?.currentAction).toBe("Search web");

    startTurnAction("conv_a", "act_2", "Read page");
    finishTurnAction("conv_a", "act_2");
    expect(getTurnActivity("conv_a")?.currentAction).toBe("Search web");

    finishTurnAction("conv_a", "act_1");
    expect(getTurnActivity("conv_a")?.currentAction).toBeNull();

    endTurnActivity("conv_a");
    expect(getTurnActivity("conv_a")).toBeNull();
    expect(changes.at(-1)).toBeNull();
    expect(changes.filter(Boolean).map((change) => (change as { currentAction: string | null }).currentAction)).toEqual([
      null,
      "Search web",
      "Read page",
      "Search web",
      null
    ]);
  });

  it("flags a quiet turn as stalled and clears the flag when activity resumes", () => {
    const changes: Array<{ stalled: boolean } | null> = [];
    beginTurnActivity("conv_b", { onChange: (activity) => changes.push(activity) });
    const startedAt = Date.parse(getTurnActivity("conv_b")!.startedAt);

    scanTurnActivity(startedAt + TURN_STALL_AFTER_MS - 1);
    expect(getTurnActivity("conv_b")?.stalled).toBe(false);

    scanTurnActivity(startedAt + TURN_STALL_AFTER_MS);
    expect(getTurnActivity("conv_b")?.stalled).toBe(true);

    touchTurnActivity("conv_b");
    expect(getTurnActivity("conv_b")?.stalled).toBe(false);
    expect(changes.map((change) => change?.stalled)).toEqual([false, true, false]);
  });

  it("does not treat a long-running tool call as a stall", () => {
    beginTurnActivity("conv_c");
    startTurnAction("conv_c", "act_shell", "Run command");
    const startedAt = Date.parse(getTurnActivity("conv_c")!.startedAt);

    scanTurnActivity(startedAt + TURN_STALL_AFTER_MS * 5);
    expect(getTurnActivity("conv_c")?.stalled).toBe(false);
  });

  it("stops a delegated turn after the stall-stop window and records the reason once", () => {
    const requestStopSpy = vi.fn();
    const claimed = claimChatTurnStart("conv_d");
    expect(claimed.ok).toBe(true);
    if (claimed.ok) {
      claimed.control.requestStop = requestStopSpy;
    }

    setTurnStallStop("conv_d", DELEGATED_TURN_STALL_STOP_MS);
    beginTurnActivity("conv_d");
    const startedAt = Date.parse(getTurnActivity("conv_d")!.startedAt);

    scanTurnActivity(startedAt + DELEGATED_TURN_STALL_STOP_MS - 1);
    expect(requestStopSpy).not.toHaveBeenCalled();

    scanTurnActivity(startedAt + DELEGATED_TURN_STALL_STOP_MS);
    scanTurnActivity(startedAt + DELEGATED_TURN_STALL_STOP_MS + 1_000);
    expect(requestStopSpy).toHaveBeenCalledTimes(1);

    endTurnActivity("conv_d");
    expect(consumeStallStop("conv_d")).toBe(true);
    expect(consumeStallStop("conv_d")).toBe(false);
    clearChatTurn("conv_d");
  });

  it("never auto-stops turns without a stall-stop policy", () => {
    const requestStopSpy = vi.fn();
    const claimed = claimChatTurnStart("conv_e");
    if (claimed.ok) {
      claimed.control.requestStop = requestStopSpy;
    }
    beginTurnActivity("conv_e");
    const startedAt = Date.parse(getTurnActivity("conv_e")!.startedAt);

    scanTurnActivity(startedAt + DELEGATED_TURN_STALL_STOP_MS * 10);
    expect(getTurnActivity("conv_e")?.stalled).toBe(true);
    expect(requestStopSpy).not.toHaveBeenCalled();
    expect(consumeStallStop("conv_e")).toBe(false);
    clearChatTurn("conv_e");
  });
});
