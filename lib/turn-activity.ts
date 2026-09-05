import { requestStop } from "@/lib/chat-turn-control";
import type { TurnActivity } from "@/lib/types";

export const TURN_STALL_AFTER_MS = 3 * 60_000;
export const DELEGATED_TURN_STALL_STOP_MS = 10 * 60_000;
const SCAN_INTERVAL_MS = 15_000;

type TurnActivityEntry = {
  activity: TurnActivity;
  runningActions: Map<string, string>;
  onChange?: (activity: TurnActivity | null) => void;
  stopAfterStallMs: number | null;
};

type TurnActivityState = {
  entries: Map<string, TurnActivityEntry>;
  stallStopPolicies: Map<string, number>;
  stallStops: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
};

const TURN_ACTIVITY_KEY = Symbol.for("eidon:turn-activity");

function getState(): TurnActivityState {
  const scope = globalThis as typeof globalThis & { [TURN_ACTIVITY_KEY]?: TurnActivityState };
  if (!scope[TURN_ACTIVITY_KEY]) {
    scope[TURN_ACTIVITY_KEY] = { entries: new Map(), stallStopPolicies: new Map(), stallStops: new Set(), timer: null };
  }
  return scope[TURN_ACTIVITY_KEY];
}

function emit(entry: TurnActivityEntry) {
  entry.onChange?.({ ...entry.activity });
}

function syncTimer(state: TurnActivityState) {
  if (state.entries.size > 0 && !state.timer) {
    state.timer = setInterval(() => scanTurnActivity(), SCAN_INTERVAL_MS);
    state.timer.unref?.();
  } else if (state.entries.size === 0 && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

export function beginTurnActivity(
  conversationId: string,
  options: { onChange?: (activity: TurnActivity | null) => void } = {}
) {
  const state = getState();
  const now = new Date().toISOString();
  const entry: TurnActivityEntry = {
    activity: { startedAt: now, lastActivityAt: now, currentAction: null, stalled: false },
    runningActions: new Map(),
    onChange: options.onChange,
    stopAfterStallMs: state.stallStopPolicies.get(conversationId) ?? null
  };
  state.entries.set(conversationId, entry);
  state.stallStops.delete(conversationId);
  syncTimer(state);
  emit(entry);
}

export function touchTurnActivity(conversationId: string) {
  const entry = getState().entries.get(conversationId);
  if (!entry) return;
  entry.activity.lastActivityAt = new Date().toISOString();
  if (entry.activity.stalled) {
    entry.activity.stalled = false;
    emit(entry);
  }
}

export function startTurnAction(conversationId: string, handle: string, label: string) {
  const entry = getState().entries.get(conversationId);
  if (!entry) return;
  entry.runningActions.set(handle, label);
  touchTurnActivity(conversationId);
  if (entry.activity.currentAction !== label) {
    entry.activity.currentAction = label;
    emit(entry);
  }
}

export function finishTurnAction(conversationId: string, handle: string) {
  const entry = getState().entries.get(conversationId);
  if (!entry || !entry.runningActions.delete(handle)) return;
  touchTurnActivity(conversationId);
  const remaining = [...entry.runningActions.values()];
  const nextAction = remaining.length ? remaining[remaining.length - 1] : null;
  if (entry.activity.currentAction !== nextAction) {
    entry.activity.currentAction = nextAction;
    emit(entry);
  }
}

export function setTurnStallStop(conversationId: string, stopAfterStallMs: number) {
  const state = getState();
  state.stallStopPolicies.set(conversationId, stopAfterStallMs);
  const entry = state.entries.get(conversationId);
  if (entry) entry.stopAfterStallMs = stopAfterStallMs;
}

export function endTurnActivity(conversationId: string) {
  const state = getState();
  const entry = state.entries.get(conversationId);
  state.stallStopPolicies.delete(conversationId);
  if (!entry) return;
  state.entries.delete(conversationId);
  syncTimer(state);
  entry.onChange?.(null);
}

export function getTurnActivity(conversationId: string): TurnActivity | null {
  const entry = getState().entries.get(conversationId);
  return entry ? { ...entry.activity } : null;
}

export function consumeStallStop(conversationId: string) {
  return getState().stallStops.delete(conversationId);
}

export function scanTurnActivity(now = Date.now()) {
  const state = getState();
  for (const [conversationId, entry] of state.entries) {
    if (entry.runningActions.size > 0) continue;
    const quietMs = now - Date.parse(entry.activity.lastActivityAt);
    if (quietMs >= TURN_STALL_AFTER_MS && !entry.activity.stalled) {
      entry.activity.stalled = true;
      emit(entry);
    }
    if (entry.stopAfterStallMs !== null && quietMs >= entry.stopAfterStallMs && !state.stallStops.has(conversationId)) {
      state.stallStops.add(conversationId);
      requestStop(conversationId);
    }
  }
}

export function resetTurnActivityForTests() {
  const state = getState();
  state.entries.clear();
  state.stallStopPolicies.clear();
  state.stallStops.clear();
  syncTimer(state);
}
