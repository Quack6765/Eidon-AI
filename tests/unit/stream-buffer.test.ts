import { describe, expect, it, vi } from "vitest";
import { createStreamBuffer } from "@/lib/stream-buffer";

function createManualScheduler() {
  let nowMs = 0;
  let nextHandle = 0;
  const queue = new Map<number, () => void>();
  return {
    schedule: (cb: () => void) => {
      nextHandle += 1;
      queue.set(nextHandle, cb);
      return nextHandle;
    },
    cancel: (handle: number) => {
      queue.delete(handle);
    },
    now: () => nowMs,
    advance(ms: number) {
      nowMs += ms;
      const pending = [...queue.values()];
      queue.clear();
      for (const cb of pending) cb();
    },
    pendingCount: () => queue.size
  };
}

const PACING = {
  baseCharsPerSecond: 100,
  drainWindowMs: 250,
  finalizeDrainWindowMs: 175,
  maxWordHoldChars: 24,
  maxWordHoldMs: 350
};

describe("createStreamBuffer", () => {
  it("starts empty and settled", () => {
    const buffer = createStreamBuffer();
    expect(buffer.getSnapshot()).toEqual({
      answerTarget: "",
      answerDisplay: "",
      thinkingTarget: "",
      thinkingDisplay: "",
      isSettled: true
    });
  });

  it("reveals complete words and briefly holds the trailing partial word", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("hello world foo");

    expect(buffer.getSnapshot().answerTarget).toBe("hello world foo");
    expect(buffer.getSnapshot().answerDisplay).toBe("");
    expect(buffer.getSnapshot().isSettled).toBe(false);

    scheduler.advance(50);
    scheduler.advance(50);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello ");

    scheduler.advance(50);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello world ");

    scheduler.advance(50);
    scheduler.advance(50);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello world ");

    buffer.finalize();
    scheduler.advance(50);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello world foo");
    expect(buffer.getSnapshot().isSettled).toBe(true);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("reveals a stalled trailing word once the hold deadline passes", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("hello world");

    scheduler.advance(100);
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello ");

    for (let i = 0; i < 12; i += 1) scheduler.advance(16);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello ");

    for (let i = 0; i < 15; i += 1) scheduler.advance(16);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello world");
    expect(buffer.getSnapshot().isSettled).toBe(true);
  });

  it("reveals a held word once a new delta provides its boundary", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("hello world");
    scheduler.advance(100);
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello ");

    buffer.appendAnswer(" again");
    scheduler.advance(100);
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello world ");
  });

  it("adaptively drains a large backlog without ever dumping it in one frame", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    const text = "word ".repeat(600);
    buffer.appendAnswer(text);
    buffer.finalize();

    let previousLength = 0;
    let maxStep = 0;
    for (let i = 0; i < 63; i += 1) {
      scheduler.advance(16);
      const length = buffer.getSnapshot().answerDisplay.length;
      maxStep = Math.max(maxStep, length - previousLength);
      previousLength = length;
    }

    const remaining = text.length - previousLength;
    expect(remaining).toBeLessThan(text.length * 0.05);
    expect(maxStep).toBeLessThan(text.length * 0.15);
  });

  it("accelerates with backlog so a fast stream never falls unboundedly behind", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });

    for (let i = 0; i < 100; i += 1) {
      buffer.appendAnswer("chunk of streamed text ");
      scheduler.advance(16);
    }

    const snapshot = buffer.getSnapshot();
    const backlog = snapshot.answerTarget.length - snapshot.answerDisplay.length;
    expect(backlog).toBeLessThan(600);
  });

  it("is frame-rate independent for the same elapsed time", () => {
    const text = "word ".repeat(600);

    const run = (stepMs: number, steps: number) => {
      const scheduler = createManualScheduler();
      const buffer = createStreamBuffer({ ...scheduler, ...PACING });
      buffer.appendAnswer(text);
      buffer.finalize();
      for (let i = 0; i < steps; i += 1) scheduler.advance(stepMs);
      return buffer.getSnapshot().answerDisplay.length;
    };

    const at60fps = run(16, 50);
    const at30fps = run(33, 24);
    expect(Math.abs(at60fps - at30fps)).toBeLessThan(text.length * 0.1);
  });

  it("force-flushes boundary-less runs in bounded steps instead of holding forever", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("a".repeat(60));

    for (let i = 0; i < 30; i += 1) scheduler.advance(16);

    const revealed = buffer.getSnapshot().answerDisplay.length;
    expect(revealed).toBeGreaterThanOrEqual(48);
    expect(revealed).toBeLessThan(60);

    for (let i = 0; i < 20; i += 1) scheduler.advance(16);
    expect(buffer.getSnapshot().answerDisplay.length).toBe(60);
  });

  it("treats CJK characters as boundaries so they reveal without word holds", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("你好世界");
    scheduler.advance(50);
    expect(buffer.getSnapshot().answerDisplay).toBe("你好世界");
  });

  it("never splits a surrogate pair when force-flushing", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer(`x${"👍".repeat(15)}`);
    buffer.finalize();

    for (let i = 0; i < 60; i += 1) {
      scheduler.advance(16);
      const display = buffer.getSnapshot().answerDisplay;
      expect(/[\uD800-\uDBFF]$/.test(display)).toBe(false);
    }
    expect(buffer.getSnapshot().answerDisplay).toBe(`x${"👍".repeat(15)}`);
  });

  it("notifies subscribers once per animation frame, not per append", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    let notifications = 0;
    buffer.subscribe(() => {
      notifications += 1;
    });
    buffer.appendAnswer("aa ");
    buffer.appendAnswer("bb ");
    buffer.appendAnswer("cc ");
    expect(notifications).toBe(0);
    scheduler.advance(200);
    expect(notifications).toBe(1);
    expect(buffer.getSnapshot().answerDisplay).toBe("aa bb cc ");
  });

  it("keeps snapshot identity stable between changes", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    const first = buffer.getSnapshot();
    expect(buffer.getSnapshot()).toBe(first);
    buffer.appendAnswer("xy ");
    scheduler.advance(200);
    const second = buffer.getSnapshot();
    expect(second).not.toBe(first);
    expect(buffer.getSnapshot()).toBe(second);
  });

  it("animates the thinking channel with the same adaptive pacing", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendThinking("pondering deeply now");
    scheduler.advance(100);
    scheduler.advance(100);
    expect(buffer.getSnapshot().thinkingDisplay).toBe("pondering deeply ");
    buffer.finalize();
    scheduler.advance(100);
    expect(buffer.getSnapshot().thinkingDisplay).toBe("pondering deeply now");
  });

  it("setAnswer immediate skips animation and settles", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.setAnswer("done", { immediate: true });
    expect(buffer.getSnapshot().answerDisplay).toBe("done");
    expect(buffer.getSnapshot().isSettled).toBe(true);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("setAnswer clamps display when new target is shorter", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.setAnswer("long text", { immediate: true });
    buffer.setAnswer("long");
    expect(buffer.getSnapshot().answerDisplay).toBe("long");
  });

  it("setAnswer snaps display and notifies once when a same-length divergent target arrives", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.setAnswer("abc", { immediate: true });
    let notifications = 0;
    buffer.subscribe(() => {
      notifications += 1;
    });
    buffer.setAnswer("abd");
    expect(buffer.getSnapshot().answerDisplay).toBe("abd");
    expect(notifications).toBe(1);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("extends the target without resetting display when a longer snapshot arrives mid-stream", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("hello world");
    scheduler.advance(100);
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello ");

    buffer.setAnswer("hello world and more trailing content");
    expect(buffer.getSnapshot().answerDisplay).toBe("hello ");
    expect(buffer.getSnapshot().answerTarget).toBe("hello world and more trailing content");
  });

  it("whenDrained fires immediately when already settled", () => {
    const buffer = createStreamBuffer();
    const callback = vi.fn();
    buffer.whenDrained(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("whenDrained waits for the drain to complete after finalize", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    const callback = vi.fn();
    buffer.appendAnswer("almost done here");
    buffer.finalize();
    buffer.whenDrained(callback);
    expect(callback).not.toHaveBeenCalled();

    for (let i = 0; i < 20; i += 1) scheduler.advance(16);

    expect(buffer.getSnapshot().answerDisplay).toBe("almost done here");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("whenDrained can be cancelled via the returned disposer", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    const callback = vi.fn();
    buffer.appendAnswer("pending tail");
    buffer.finalize();
    const cancel = buffer.whenDrained(callback);
    cancel();
    for (let i = 0; i < 20; i += 1) scheduler.advance(16);
    expect(callback).not.toHaveBeenCalled();
  });

  it("reset cancels pending whenDrained callbacks", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    const callback = vi.fn();
    buffer.appendAnswer("pending tail");
    buffer.finalize();
    buffer.whenDrained(callback);
    buffer.reset();
    for (let i = 0; i < 20; i += 1) scheduler.advance(16);
    expect(callback).not.toHaveBeenCalled();
  });

  it("finalize drains faster than the live-stream pacing", () => {
    const text = "word ".repeat(200);

    const run = (finalizeEarly: boolean) => {
      const scheduler = createManualScheduler();
      const buffer = createStreamBuffer({ ...scheduler, ...PACING });
      buffer.appendAnswer(text);
      if (finalizeEarly) buffer.finalize();
      for (let i = 0; i < 10; i += 1) scheduler.advance(16);
      return buffer.getSnapshot().answerDisplay.length;
    };

    expect(run(true)).toBeGreaterThan(run(false));
  });

  it("reset clears everything, cancels animation and notifies", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    let notifications = 0;
    buffer.subscribe(() => {
      notifications += 1;
    });
    buffer.appendAnswer("text ");
    buffer.appendThinking("think ");
    buffer.reset();
    expect(notifications).toBe(1);
    expect(buffer.getSnapshot()).toEqual({
      answerTarget: "",
      answerDisplay: "",
      thinkingTarget: "",
      thinkingDisplay: "",
      isSettled: true
    });
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("");
  });

  it("reset clears the finalized state so the buffer can animate a new turn", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    buffer.appendAnswer("first turn");
    buffer.finalize();
    scheduler.advance(200);
    buffer.reset();

    buffer.appendAnswer("second turn pending");
    scheduler.advance(100);
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("second turn ");
  });

  it("unsubscribe stops notifications", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, ...PACING });
    let notifications = 0;
    const unsubscribe = buffer.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();
    buffer.appendAnswer("aa ");
    scheduler.advance(100);
    expect(notifications).toBe(0);
  });
});
