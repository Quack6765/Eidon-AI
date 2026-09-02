import { describe, expect, it, beforeEach } from "vitest";

import {
  configureBotRunLimits,
  enqueueBotTask,
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

  it("never goes negative on release", () => {
    releaseBotUserSlot("user-1");
    releaseBotUserSlot("user-1");
    expect(getBotRunLimiterSnapshot().activeByUser["user-1"]).toBeUndefined();
  });

  it("serializes tasks for the same bot", async () => {
    const order: string[] = [];
    const slow = enqueueBotTask("bot-1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow");
    });
    const fast = enqueueBotTask("bot-1", async () => {
      order.push("fast");
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(["slow", "fast"]);
  });

  it("runs tasks for different bots concurrently", async () => {
    const order: string[] = [];
    const first = enqueueBotTask("bot-1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first");
    });
    const second = enqueueBotTask("bot-2", async () => {
      order.push("second");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["second", "first"]);
  });

  it("continues the queue after a failure", async () => {
    const order: string[] = [];
    const failing = enqueueBotTask("bot-1", async () => {
      throw new Error("boom");
    }).catch(() => "failed");
    const next = enqueueBotTask("bot-1", async () => {
      order.push("recovered");
    });

    expect(await failing).toBe("failed");
    await next;
    expect(order).toEqual(["recovered"]);
  });
});
