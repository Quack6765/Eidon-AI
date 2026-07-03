export type StreamBufferSnapshot = {
  answerTarget: string;
  answerDisplay: string;
  thinkingTarget: string;
  thinkingDisplay: string;
  isSettled: boolean;
};

export type StreamBufferOptions = {
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
  now?: () => number;
  baseCharsPerSecond?: number;
  drainWindowMs?: number;
  finalizeDrainWindowMs?: number;
  maxWordHoldChars?: number;
  maxWordHoldMs?: number;
};

export type StreamBuffer = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StreamBufferSnapshot;
  appendAnswer: (text: string) => void;
  appendThinking: (text: string) => void;
  setAnswer: (text: string, options?: { immediate?: boolean }) => void;
  setThinking: (text: string, options?: { immediate?: boolean }) => void;
  finalize: () => void;
  whenDrained: (callback: () => void) => () => void;
  reset: () => void;
};

const DEFAULT_BASE_CHARS_PER_SECOND = 90;
const DEFAULT_DRAIN_WINDOW_MS = 250;
const DEFAULT_FINALIZE_DRAIN_WINDOW_MS = 175;
const DEFAULT_MAX_WORD_HOLD_CHARS = 24;
const DEFAULT_MAX_WORD_HOLD_MS = 350;
const CARRY_CAP_FACTOR = 2;

const EMPTY_SNAPSHOT: StreamBufferSnapshot = Object.freeze({
  answerTarget: "",
  answerDisplay: "",
  thinkingTarget: "",
  thinkingDisplay: "",
  isSettled: true
});

const BOUNDARY_CHAR_PATTERN =
  /[\s⺀-鿿가-힯豈-﫿！-｠]/;

function defaultSchedule(callback: () => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(() => callback());
  }
  return setTimeout(callback, 16) as unknown as number;
}

function defaultCancel(handle: number) {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function graphemeSafeIndex(text: string, index: number) {
  if (index > 0 && isHighSurrogate(text.charCodeAt(index - 1))) {
    return index - 1;
  }
  return index;
}

export function createStreamBuffer(options: StreamBufferOptions = {}): StreamBuffer {
  const schedule = options.schedule ?? defaultSchedule;
  const cancel = options.cancel ?? defaultCancel;
  const now = options.now ?? (() => Date.now());
  const baseRate = options.baseCharsPerSecond ?? DEFAULT_BASE_CHARS_PER_SECOND;
  const drainWindowMs = options.drainWindowMs ?? DEFAULT_DRAIN_WINDOW_MS;
  const finalizeDrainWindowMs = options.finalizeDrainWindowMs ?? DEFAULT_FINALIZE_DRAIN_WINDOW_MS;
  const maxWordHoldChars = options.maxWordHoldChars ?? DEFAULT_MAX_WORD_HOLD_CHARS;
  const maxWordHoldMs = options.maxWordHoldMs ?? DEFAULT_MAX_WORD_HOLD_MS;
  const carryCap = maxWordHoldChars * CARRY_CAP_FACTOR;

  let snapshot = EMPTY_SNAPSHOT;
  let finalized = false;
  const carries = { answer: 0, thinking: 0 };
  const holdSince: { answer: number | null; thinking: number | null } = {
    answer: null,
    thinking: null
  };
  const listeners = new Set<() => void>();
  const drainCallbacks = new Set<() => void>();
  let frameHandle: number | null = null;
  let lastTick = 0;

  function notify() {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function isBoundary(target: string, index: number) {
    if (index === target.length && finalized) {
      return true;
    }
    return BOUNDARY_CHAR_PATTERN.test(target.charAt(index - 1));
  }

  function findBoundary(target: string, fromExclusive: number, toInclusive: number) {
    for (let index = toInclusive; index > fromExclusive; index -= 1) {
      if (isBoundary(target, index)) {
        return index;
      }
    }
    return -1;
  }

  function advance(
    field: "answer" | "thinking",
    display: string,
    target: string,
    elapsedMs: number,
    nowMs: number
  ) {
    const backlog = target.length - display.length;
    if (backlog <= 0) {
      carries[field] = 0;
      holdSince[field] = null;
      return display;
    }

    const windowMs = finalized ? finalizeDrainWindowMs : drainWindowMs;
    const rate = Math.max(baseRate, (backlog * 1000) / windowMs);
    const budget = carries[field] + (elapsedMs * rate) / 1000;
    const candidate = Math.min(display.length + Math.floor(budget), target.length);

    function hold() {
      carries[field] = Math.min(budget, carryCap);
      holdSince[field] ??= nowMs;
      return display;
    }

    function reveal(index: number) {
      carries[field] = Math.min(budget - (index - display.length), carryCap);
      holdSince[field] = null;
      return target.slice(0, index);
    }

    if (candidate <= display.length) {
      return hold();
    }

    const boundary = findBoundary(target, display.length, candidate);

    if (boundary !== -1) {
      return reveal(boundary);
    }

    const holdExpired =
      holdSince[field] !== null && nowMs - holdSince[field] >= maxWordHoldMs;

    if (candidate - display.length >= maxWordHoldChars || holdExpired) {
      const flushIndex = graphemeSafeIndex(target, candidate);
      if (flushIndex > display.length) {
        return reveal(flushIndex);
      }
    }

    return hold();
  }

  function canProgress() {
    return (
      snapshot.answerDisplay.length < snapshot.answerTarget.length ||
      snapshot.thinkingDisplay.length < snapshot.thinkingTarget.length
    );
  }

  function commit(next: Omit<StreamBufferSnapshot, "isSettled">) {
    snapshot = {
      ...next,
      isSettled:
        next.answerDisplay.length >= next.answerTarget.length &&
        next.thinkingDisplay.length >= next.thinkingTarget.length
    };
  }

  function flushDrainCallbacksIfSettled() {
    if (!snapshot.isSettled || drainCallbacks.size === 0) {
      return;
    }
    const callbacks = [...drainCallbacks];
    drainCallbacks.clear();
    for (const callback of callbacks) {
      callback();
    }
  }

  function tick() {
    frameHandle = null;
    const current = now();
    const elapsed = Math.max(current - lastTick, 1);
    lastTick = current;
    const nextAnswer = advance("answer", snapshot.answerDisplay, snapshot.answerTarget, elapsed, current);
    const nextThinking = advance("thinking", snapshot.thinkingDisplay, snapshot.thinkingTarget, elapsed, current);

    if (nextAnswer !== snapshot.answerDisplay || nextThinking !== snapshot.thinkingDisplay) {
      commit({ ...snapshot, answerDisplay: nextAnswer, thinkingDisplay: nextThinking });
      notify();
      flushDrainCallbacksIfSettled();
    }

    if (canProgress()) {
      scheduleTick();
    }
  }

  function scheduleTick() {
    if (frameHandle !== null) {
      return;
    }
    frameHandle = schedule(tick);
  }

  function startAnimationIfNeeded() {
    if (!canProgress() || frameHandle !== null) {
      return;
    }
    lastTick = now();
    scheduleTick();
  }

  function setText(field: "answer" | "thinking", text: string, immediate: boolean) {
    const targetKey = field === "answer" ? "answerTarget" : "thinkingTarget";
    const displayKey = field === "answer" ? "answerDisplay" : "thinkingDisplay";
    const previousDisplay = snapshot[displayKey];
    const previousSettled = snapshot.isSettled;
    const nextDisplay = immediate
      ? text
      : text.startsWith(previousDisplay)
        ? previousDisplay
        : text;
    const changed = snapshot[targetKey] !== text || previousDisplay !== nextDisplay;

    if (!changed) {
      return;
    }

    commit({ ...snapshot, [targetKey]: text, [displayKey]: nextDisplay });

    if (nextDisplay !== previousDisplay || snapshot.isSettled) {
      carries[field] = 0;
    }

    if (nextDisplay !== previousDisplay || (snapshot.isSettled && !previousSettled)) {
      notify();
    }

    flushDrainCallbacksIfSettled();
    startAnimationIfNeeded();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    appendAnswer(text) {
      setText("answer", `${snapshot.answerTarget}${text}`, false);
    },
    appendThinking(text) {
      setText("thinking", `${snapshot.thinkingTarget}${text}`, false);
    },
    setAnswer(text, opts) {
      setText("answer", text, Boolean(opts?.immediate));
    },
    setThinking(text, opts) {
      setText("thinking", text, Boolean(opts?.immediate));
    },
    finalize() {
      if (finalized) {
        return;
      }
      finalized = true;
      startAnimationIfNeeded();
    },
    whenDrained(callback) {
      if (snapshot.isSettled) {
        callback();
        return () => {};
      }
      drainCallbacks.add(callback);
      return () => {
        drainCallbacks.delete(callback);
      };
    },
    reset() {
      if (frameHandle !== null) {
        cancel(frameHandle);
        frameHandle = null;
      }
      finalized = false;
      carries.answer = 0;
      carries.thinking = 0;
      holdSince.answer = null;
      holdSince.thinking = null;
      drainCallbacks.clear();
      if (snapshot === EMPTY_SNAPSHOT) {
        return;
      }
      snapshot = EMPTY_SNAPSHOT;
      notify();
    }
  };
}
