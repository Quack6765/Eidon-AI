import { afterEach, describe, expect, it } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot, ensureChiefBot } from "@/lib/bots";
import { createBotRunRecord, updateBotRunStatus } from "@/lib/bot-runs";
import { createMessage, setConversationActive } from "@/lib/conversations";
import { buildToolDefinitions } from "@/lib/tool-definitions";
import { executeToolCall } from "@/lib/tool-executors";
import { beginTurnActivity, resetTurnActivityForTests, startTurnAction } from "@/lib/turn-activity";

function toolNames(botTeam?: { isChief: boolean; roster: [] }) {
  return buildToolDefinitions({
    mcpToolSets: [],
    skills: [],
    loadedSkillIds: new Set<string>(),
    memoriesEnabled: false,
    effectiveVisionMode: "none",
    botTeam
  }).map((tool) => tool.function.name);
}

async function runCheckBot(memoryUserId: string | null, bot: string) {
  return executeToolCall(
    { id: "call_check", name: "check_bot", arguments: JSON.stringify({ bot }) },
    {
      input: { skills: [], mcpToolSets: [], memoryUserId },
      mcpServers: [],
      loadedSkillIds: new Set(),
      successfulReadOnlyToolResults: new Map(),
      timelineSortOrder: 3,
      promptMessages: [],
      memoryUserId
    } as unknown as Parameters<typeof executeToolCall>[1]
  );
}

describe("check_bot tool", () => {
  afterEach(() => {
    resetTurnActivityForTests();
  });

  it("is offered to every bot on a team but not outside bot conversations", () => {
    expect(toolNames()).not.toContain("check_bot");
    expect(toolNames({ isChief: true, roster: [] })).toContain("check_bot");
    expect(toolNames({ isChief: false, roster: [] })).toContain("check_bot");
  });

  it("reports a running bot's elapsed time, current step and output so far without an action row", async () => {
    const user = await createLocalUser({ username: "checkowner", password: "password-123", role: "user" as const });
    ensureChiefBot(user.id);
    const worker = createBot({ name: "Analyst" }, user.id);
    const run = createBotRunRecord({ botId: worker.id, conversationId: worker.homeConversationId, triggerSource: "delegated" });
    updateBotRunStatus(run.id, { status: "running", startedAt: new Date(Date.now() - 4 * 60_000).toISOString() });
    setConversationActive(worker.homeConversationId, true);
    createMessage({ conversationId: worker.homeConversationId, role: "user", content: "task" });
    createMessage({ conversationId: worker.homeConversationId, role: "assistant", content: "Collected 12 rows so far." });
    beginTurnActivity(worker.homeConversationId);
    startTurnAction(worker.homeConversationId, "act_1", "Read page");

    const result = await runCheckBot(user.id, "analyst");
    const content = String(result.promptMessages.at(-1)?.content);

    expect(result.toolSucceeded).toBe(true);
    expect(result.nextSortOrder).toBe(3);
    expect(content).toContain("Analyst is running.");
    expect(content).toMatch(/Working for \d+s|Working for \d+m/);
    expect(content).toContain("Current step: Read page.");
    expect(content).toContain("Collected 12 rows so far.");
    expect(content).toContain("the bot was not interrupted");
    setConversationActive(worker.homeConversationId, false);
  });

  it("reports the last finished run for an idle bot and rejects unknown bots", async () => {
    const user = await createLocalUser({ username: "checkidle", password: "password-123", role: "user" as const });
    const worker = createBot({ name: "Archivist" }, user.id);
    const run = createBotRunRecord({ botId: worker.id, conversationId: worker.homeConversationId, triggerSource: "delegated" });
    updateBotRunStatus(run.id, { status: "failed", finishedAt: new Date().toISOString(), errorMessage: "Timed out" });

    const idle = await runCheckBot(user.id, "Archivist");
    expect(String(idle.promptMessages.at(-1)?.content)).toContain("Archivist is idle.");
    expect(String(idle.promptMessages.at(-1)?.content)).toContain("Last run failed (Timed out)");

    const unknown = await runCheckBot(user.id, "nobody");
    expect(String(unknown.promptMessages.at(-1)?.content)).toContain("no bot \"nobody\" was found");

    const noOwner = await runCheckBot(null, "Archivist");
    expect(String(noOwner.promptMessages.at(-1)?.content)).toContain("not available");
  });
});
