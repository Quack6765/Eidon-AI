import { describe, it, expect, vi, beforeEach } from "vitest";

describe("emitter", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("calls listeners when events are emitted", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown]; status: [string, string] }>();
    const listener = vi.fn();
    emitter.on("delta", listener);
    emitter.emit("delta", "conv-1", { type: "answer_delta", text: "hello" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("conv-1", { type: "answer_delta", text: "hello" });
  });

  it("supports multiple listeners for the same event", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("delta", listener1);
    emitter.on("delta", listener2);
    emitter.emit("delta", "conv-1", { type: "test" });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("removes listeners via the returned unsubscribe function", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    const listener = vi.fn();
    const unsub = emitter.on("delta", listener);
    unsub();
    emitter.emit("delta", "conv-1", { type: "test" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw when emitting to an event with no listeners", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    expect(() => emitter.emit("delta", "conv-1", { type: "test" })).not.toThrow();
  });

  it("removes all listeners via off()", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    const listener = vi.fn();
    emitter.on("delta", listener);
    emitter.off("delta");
    emitter.emit("delta", "conv-1", { type: "test" });
    expect(listener).not.toHaveBeenCalled();
  });
});
