import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPausableTimeout } from "@/lib/pausable-timeout";

describe("createPausableTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires after the delay", () => {
    const callback = vi.fn();
    const timer = createPausableTimeout(callback, 1_000);
    expect(timer.remainingMs()).toBe(1_000);
    vi.advanceTimersByTime(999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(timer.remainingMs()).toBe(0);
  });

  it("does not count paused time and resumes with the remaining delay", () => {
    const callback = vi.fn();
    const timer = createPausableTimeout(callback, 1_000);
    vi.advanceTimersByTime(400);
    timer.pause();
    timer.pause();
    expect(timer.remainingMs()).toBe(600);
    vi.advanceTimersByTime(10_000);
    expect(callback).not.toHaveBeenCalled();
    timer.resume();
    timer.resume();
    vi.advanceTimersByTime(250);
    expect(timer.remainingMs()).toBe(350);
    vi.advanceTimersByTime(350);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("never fires once cleared, even when resumed", () => {
    const callback = vi.fn();
    const timer = createPausableTimeout(callback, 1_000);
    timer.pause();
    timer.clear();
    timer.resume();
    vi.advanceTimersByTime(5_000);
    expect(callback).not.toHaveBeenCalled();
    expect(timer.remainingMs()).toBe(0);
  });
});
