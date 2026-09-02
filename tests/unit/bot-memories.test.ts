import { describe, expect, it } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import {
  createMemory,
  deleteMemory,
  getMemory,
  getMemoryCount,
  listMemories,
  listMemoriesForPrompt,
  updateMemory
} from "@/lib/memories";

async function makeUser(username: string) {
  return createLocalUser({ username, password: "password-123", role: "user" as const });
}

describe("bot-scoped memories", () => {
  it("keeps the main pool separate from bot pools by default", async () => {
    const user = await makeUser("memscope1");
    const botA = createBot({ name: "Alpha Mem" }, user.id);
    const botB = createBot({ name: "Beta Mem" }, user.id);

    createMemory("Lives in Toronto", "personal", user.id);
    createMemory("Alpha note", "work", user.id, { botId: botA.id });
    createMemory("Beta note", "work", user.id, { botId: botB.id });

    expect(listMemories(user.id).map((m) => m.content)).toEqual(["Lives in Toronto"]);
    expect(listMemories(user.id, undefined, { botId: botA.id }).map((m) => m.content)).toEqual(["Alpha note"]);
    expect(listMemories(user.id, undefined, { botId: botB.id }).map((m) => m.content)).toEqual(["Beta note"]);

    expect(getMemoryCount(user.id)).toBe(1);
    expect(getMemoryCount(user.id, { botId: botA.id })).toBe(1);
  });

  it("merges main + bot pool for prompts", async () => {
    const user = await makeUser("memscope2");
    const bot = createBot({ name: "Prompt Mem" }, user.id);

    createMemory("User fact", "personal", user.id);
    createMemory("Bot fact", "work", user.id, { botId: bot.id });

    const merged = listMemoriesForPrompt(user.id, { botId: bot.id }).map((m) => m.content);
    expect(merged).toContain("User fact");
    expect(merged).toContain("Bot fact");

    expect(listMemoriesForPrompt(user.id).map((m) => m.content)).toEqual(["User fact"]);
  });

  it("scopes reads, updates and deletes to a pool", async () => {
    const user = await makeUser("memscope3");
    const bot = createBot({ name: "Guard Mem" }, user.id);

    const mainMemory = createMemory("Main only", "other", user.id);
    const botMemory = createMemory("Bot only", "other", user.id, { botId: bot.id });

    expect(getMemory(mainMemory.id, user.id, { botId: bot.id })).toBeNull();
    expect(getMemory(botMemory.id, user.id)).toBeNull();
    expect(getMemory(botMemory.id, user.id, { botId: bot.id })?.content).toBe("Bot only");

    const updated = updateMemory(botMemory.id, { content: "Bot updated" }, user.id, { botId: bot.id });
    expect(updated?.content).toBe("Bot updated");
    expect(getMemory(mainMemory.id, user.id)?.content).toBe("Main only");

    deleteMemory(mainMemory.id, user.id, { botId: bot.id });
    expect(getMemory(mainMemory.id, user.id)).not.toBeNull();

    deleteMemory(botMemory.id, user.id, { botId: bot.id });
    expect(getMemory(botMemory.id, user.id, { botId: bot.id })).toBeNull();
  });

  it("builds bot prompts with main + bot memories merged", async () => {
    const { buildPromptMessages } = await import("@/lib/compaction");
    const user = await makeUser("memscope5");
    const bot = createBot({ name: "Prompt Build" }, user.id);

    createMemory("User fact", "personal", user.id);
    createMemory("Bot fact", "work", user.id, { botId: bot.id });

    const prompt = buildPromptMessages({
      systemPrompt: "You are a bot.",
      memoriesEnabled: true,
      memoryUserId: user.id,
      memoryBotId: bot.id,
      messages: [],
      activeMemoryNodes: []
    });

    const system = prompt[0];
    expect(system.role).toBe("system");
    const content = typeof system.content === "string" ? system.content : "";
    expect(content).toContain("<memory>");
    expect(content).toContain("User fact");
    expect(content).toContain("Bot fact");
  });

  it("deleting a bot cascades its memory pool", async () => {
    const { deleteBot } = await import("@/lib/bots");
    const user = await makeUser("memscope4");
    const bot = createBot({ name: "Doomed Mem" }, user.id);
    createMemory("Bot pool entry", "work", user.id, { botId: bot.id });
    createMemory("Main survives", "work", user.id);

    expect(deleteBot(bot.id, user.id)).toBe(true);

    expect(listMemories(user.id, undefined, { botId: bot.id })).toEqual([]);
    expect(listMemories(user.id).map((m) => m.content)).toEqual(["Main survives"]);
  });
});
