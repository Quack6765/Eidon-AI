import { describe, expect, it, beforeEach } from "vitest";

import {
  acquireBotUserSlot,
  configureBotRunLimits,
  enqueueSerialTask,
  getBotRunLimiterSnapshot,
  releaseBotUserSlot,
  resetBotRunLimiter,
  tryAcquireBotUserSlot
} from "@/lib/bot-run-limiter";

describe("bot-run-limiter", () => {
  beforeEach(() => {
    resetBotRunLimiter();
    configureBotRunLimits({ maxConcurrentPerUser: 2 });
  });

  it("caps concurrent slots per user", () => {
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);
    expect(tryAcquireBotUserSlot("user-1")).toBe(false);
    expect(tryAcquireBotUserSlot("user-2")).toBe(true);

    releaseBotUserSlot("user-1");
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);
  });

  it("hands a slot to a waiter as soon as one is released", async () => {
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);

    let settled: boolean | null = null;
    const waiting = acquireBotUserSlot("user-1", 1_000).then((acquired) => {
      settled = acquired;
      return acquired;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBeNull();

    releaseBotUserSlot("user-1");
    expect(await waiting).toBe(true);
    expect(getBotRunLimiterSnapshot().activeByUser["user-1"]).toBe(2);
  });

  it("gives up waiting for a slot after the timeout", async () => {
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);
    expect(tryAcquireBotUserSlot("user-1")).toBe(true);

    expect(await acquireBotUserSlot("user-1", 10)).toBe(false);
    expect(getBotRunLimiterSnapshot().activeByUser["user-1"]).toBe(2);

    releaseBotUserSlot("user-1");
    expect(getBotRunLimiterSnapshot().activeByUser["user-1"]).toBe(1);
  });

  it("never goes negative on release", () => {
    releaseBotUserSlot("user-1");
    releaseBotUserSlot("user-1");
    expect(getBotRunLimiterSnapshot().activeByUser["user-1"]).toBeUndefined();
  });

  it("serializes tasks for the same bot", async () => {
    const order: string[] = [];
    const slow = enqueueSerialTask("bot-1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow");
    });
    const fast = enqueueSerialTask("bot-1", async () => {
      order.push("fast");
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow", "fast"]);
  });

  it("runs tasks for different bots concurrently", async () => {
    const order: string[] = [];
    const first = enqueueSerialTask("bot-1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first");
    });
    const second = enqueueSerialTask("bot-2", async () => {
      order.push("second");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["second", "first"]);
  });

  it("continues the queue after a failure", async () => {
    const order: string[] = [];
    const failing = enqueueSerialTask("bot-1", async () => {
      throw new Error("boom");
    }).catch(() => "failed");
    const next = enqueueSerialTask("bot-1", async () => {
      order.push("recovered");
    });

    expect(await failing).toBe("failed");
    await next;
    expect(order).toEqual(["recovered"]);
  });
});
