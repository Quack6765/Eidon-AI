export type StreamBufferSnapshot = {
  answerTarget: string;
  answerDisplay: string;
  thinkingTarget: string;
  thinkingDisplay: string;
};

export type StreamBufferOptions = {
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
  now?: () => number;
  answerCharsPerSecond?: number;
  thinkingCharsPerSecond?: number;
};

export type StreamBuffer = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => StreamBufferSnapshot;
  appendAnswer: (text: string) => void;
  appendThinking: (text: string) => void;
  setAnswer: (text: string, options?: { immediate?: boolean }) => void;
  setThinking: (text: string, options?: { immediate?: boolean }) => void;
  reset: () => void;
};

const DEFAULT_ANSWER_CHARS_PER_SECOND = 400;
const DEFAULT_THINKING_CHARS_PER_SECOND = 250;
const EMPTY_SNAPSHOT: StreamBufferSnapshot = {
  answerTarget: "",
  answerDisplay: "",
  thinkingTarget: "",
  thinkingDisplay: ""
};

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

export function createStreamBuffer(options: StreamBufferOptions = {}): StreamBuffer {
  const schedule = options.schedule ?? defaultSchedule;
  const cancel = options.cancel ?? defaultCancel;
  const now = options.now ?? (() => Date.now());
  const answerRate = options.answerCharsPerSecond ?? DEFAULT_ANSWER_CHARS_PER_SECOND;
  const thinkingRate = options.thinkingCharsPerSecond ?? DEFAULT_THINKING_CHARS_PER_SECOND;

  let snapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<() => void>();
  let frameHandle: number | null = null;
  let lastTick = 0;

  function notify() {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function isAnimating() {
    return (
      snapshot.answerDisplay.length < snapshot.answerTarget.length ||
      snapshot.thinkingDisplay.length < snapshot.thinkingTarget.length
    );
  }

  function advance(display: string, target: string, rate: number, elapsedMs: number) {
    if (display.length >= target.length) {
      return display;
    }
    const step = Math.max(1, Math.round((elapsedMs / 1000) * rate));
    return target.slice(0, display.length + step);
  }

  function tick() {
    frameHandle = null;
    const current = now();
    const elapsed = Math.max(current - lastTick, 1);
    lastTick = current;
    const nextAnswer = advance(snapshot.answerDisplay, snapshot.answerTarget, answerRate, elapsed);
    const nextThinking = advance(snapshot.thinkingDisplay, snapshot.thinkingTarget, thinkingRate, elapsed);

    if (nextAnswer !== snapshot.answerDisplay || nextThinking !== snapshot.thinkingDisplay) {
      snapshot = { ...snapshot, answerDisplay: nextAnswer, thinkingDisplay: nextThinking };
      notify();
    }

    if (isAnimating()) {
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
    if (!isAnimating() || frameHandle !== null) {
      return;
    }
    lastTick = now();
    scheduleTick();
  }

  function setText(field: "answer" | "thinking", text: string, immediate: boolean) {
    const targetKey = field === "answer" ? "answerTarget" : "thinkingTarget";
    const displayKey = field === "answer" ? "answerDisplay" : "thinkingDisplay";
    const nextDisplay = immediate
      ? text
      : snapshot[displayKey].length > text.length
        ? text
        : snapshot[displayKey];
    const changed = snapshot[targetKey] !== text || snapshot[displayKey] !== nextDisplay;

    if (!changed) {
      return;
    }

    snapshot = { ...snapshot, [targetKey]: text, [displayKey]: nextDisplay };

    if (immediate) {
      notify();
      return;
    }

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
    reset() {
      if (frameHandle !== null) {
        cancel(frameHandle);
        frameHandle = null;
      }
      if (snapshot === EMPTY_SNAPSHOT) {
        return;
      }
      snapshot = EMPTY_SNAPSHOT;
      notify();
    }
  };
}
