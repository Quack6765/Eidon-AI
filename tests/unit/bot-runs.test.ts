import { describe, expect, it, vi, beforeEach } from "vitest";

import { createLocalUser } from "@/lib/users";
import {
  listRecentBotRuns,
  createBotRunRecord,
  updateBotRunStatus,
  getBotRun
} from "@/lib/bot-runs";
import { createBot } from "@/lib/bots";
import { createMessage } from "@/lib/conversations";

describe("bot-runs", () => {
  it("records and transitions run status", async () => {
    const user = await createLocalUser({ username: "runrecorder", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Runner" }, user.id);

    const parentMessage = createMessage({ conversationId: bot.homeConversationId, role: "user", content: "go" });
    const run = createBotRunRecord({
      botId: bot.id,
      conversationId: bot.homeConversationId,
      triggerSource: "delegated",
      parentMessageId: parentMessage.id
    });

    expect(run.status).toBe("queued");
    expect(run.triggerSource).toBe("delegated");

    const running = updateBotRunStatus(run.id, {
      status: "running",
      startedAt: "2026-05-01T00:00:00.000Z"
    });
    expect(running?.status).toBe("running");

    const finished = updateBotRunStatus(run.id, {
      status: "completed",
      finishedAt: "2026-05-01T00:01:00.000Z"
    });
    expect(finished?.status).toBe("completed");
    expect(finished?.startedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(getBotRun(run.id)?.id).toBe(run.id);
  });

  it("scopes recent runs to the owning user", async () => {
    const userA = await createLocalUser({ username: "runusera", password: "password-123", role: "user" as const });
    const userB = await createLocalUser({ username: "runuserb", password: "password-123", role: "user" as const });
    const botA = createBot({ name: "Alpha Bot" }, userA.id);
    const botB = createBot({ name: "Beta Bot" }, userB.id);

    createBotRunRecord({ botId: botA.id, conversationId: botA.homeConversationId, triggerSource: "dm" });
    createBotRunRecord({ botId: botB.id, conversationId: botB.homeConversationId, triggerSource: "routine" });

    const runsA = listRecentBotRuns({ userId: userA.id });
    expect(runsA).toHaveLength(1);
    expect(runsA[0].botId).toBe(botA.id);
    expect(runsA[0].triggerSource).toBe("dm");
  });

  it("computes bot summary status from activity", async () => {
    const { toBotSummary } = await import("@/lib/bots");
    const user = await createLocalUser({ username: "summarizer", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Status Bot" }, user.id);

    expect(toBotSummary(bot).status).toBe("idle");

    const run = createBotRunRecord({
      botId: bot.id,
      conversationId: bot.homeConversationId,
      triggerSource: "delegated"
    });
    const queuedBot = { ...bot };
    expect(toBotSummary(queuedBot).status).toBe("queued");

    updateBotRunStatus(run.id, { status: "failed", errorMessage: "boom" });
    const { getBot } = await import("@/lib/bots");
    const refreshed = getBot(bot.id, user.id);
    expect(refreshed && toBotSummary(refreshed).status).toBe("idle");
    expect(refreshed && toBotSummary(refreshed).lastRunAt).toBeTruthy();
  });
});

describe("bot-run broadcasts", () => {
  beforeEach(() => {
  });

  it("broadcasts run updates to the owner's sockets", async () => {
    const { broadcastBotRunUpdate } = await import("@/lib/bot-runs");
    const { getConversationManager } = await import("@/lib/ws-singleton");
    const manager = getConversationManager();

    const events: unknown[] = [];
    const original = manager.broadcastAll;
    manager.broadcastAll = (event: Parameters<typeof original>[0], userId: string | null) => {
      if (event.type === "bot_run_updated") {
        events.push({ event, userId });
      }
    };

    const user = await createLocalUser({ username: "broadcastowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Caster" }, user.id);
    const run = createBotRunRecord({
      botId: bot.id,
      conversationId: bot.homeConversationId,
      triggerSource: "dm"
    });

    broadcastBotRunUpdate(run);
    manager.broadcastAll = original;

    expect(events).toHaveLength(1);
  });
});
