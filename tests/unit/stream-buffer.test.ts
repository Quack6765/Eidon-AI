import { describe, expect, it } from "vitest";
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

describe("createStreamBuffer", () => {
  it("starts empty", () => {
    const buffer = createStreamBuffer();
    expect(buffer.getSnapshot()).toEqual({
      answerTarget: "",
      answerDisplay: "",
      thinkingTarget: "",
      thinkingDisplay: ""
    });
  });

  it("appendAnswer updates target immediately and animates display via scheduler", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, answerCharsPerSecond: 1000 });
    buffer.appendAnswer("hello world");
    expect(buffer.getSnapshot().answerTarget).toBe("hello world");
    expect(buffer.getSnapshot().answerDisplay).toBe("");
    scheduler.advance(5);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello");
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("hello world");
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("notifies subscribers once per animation frame, not per append", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, answerCharsPerSecond: 1000 });
    let notifications = 0;
    buffer.subscribe(() => {
      notifications += 1;
    });
    buffer.appendAnswer("a");
    buffer.appendAnswer("b");
    buffer.appendAnswer("c");
    expect(notifications).toBe(0);
    scheduler.advance(50);
    expect(notifications).toBe(1);
    expect(buffer.getSnapshot().answerDisplay).toBe("abc");
  });

  it("keeps snapshot identity stable between changes", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler });
    const first = buffer.getSnapshot();
    expect(buffer.getSnapshot()).toBe(first);
    buffer.appendAnswer("x");
    scheduler.advance(50);
    const second = buffer.getSnapshot();
    expect(second).not.toBe(first);
    expect(buffer.getSnapshot()).toBe(second);
  });

  it("animates thinking at its own rate", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler, thinkingCharsPerSecond: 100 });
    buffer.appendThinking("abcdefghij");
    scheduler.advance(50);
    expect(buffer.getSnapshot().thinkingDisplay).toBe("abcde");
  });

  it("setAnswer immediate skips animation", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler });
    buffer.setAnswer("done", { immediate: true });
    expect(buffer.getSnapshot().answerDisplay).toBe("done");
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("setAnswer clamps display when new target is shorter", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler });
    buffer.setAnswer("long text", { immediate: true });
    buffer.setAnswer("long");
    expect(buffer.getSnapshot().answerDisplay).toBe("long");
  });

  it("setAnswer snaps display and notifies once when a same-length divergent target arrives", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler });
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

  it("reset clears everything, cancels animation and notifies", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler });
    let notifications = 0;
    buffer.subscribe(() => {
      notifications += 1;
    });
    buffer.appendAnswer("text");
    buffer.appendThinking("think");
    buffer.reset();
    expect(notifications).toBe(1);
    expect(buffer.getSnapshot()).toEqual({
      answerTarget: "",
      answerDisplay: "",
      thinkingTarget: "",
      thinkingDisplay: ""
    });
    scheduler.advance(100);
    expect(buffer.getSnapshot().answerDisplay).toBe("");
  });

  it("unsubscribe stops notifications", () => {
    const scheduler = createManualScheduler();
    const buffer = createStreamBuffer({ ...scheduler });
    let notifications = 0;
    const unsubscribe = buffer.subscribe(() => {
      notifications += 1;
    });
    unsubscribe();
    buffer.appendAnswer("a");
    scheduler.advance(50);
    expect(notifications).toBe(0);
  });
});
