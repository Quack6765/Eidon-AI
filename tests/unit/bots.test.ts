import { describe, expect, it } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot, deleteBot, ensureChiefBot, getBot, getBotByConversationId, listBots } from "@/lib/bots";
import { getConversation, createMessage } from "@/lib/conversations";

describe("bots", () => {
  it("creates a bot with a home conversation and generated identity", async () => {
    const user = await createLocalUser({ username: "botowner", password: "password-123", role: "user" as const });
    const bot = createBot(
      { name: "Inbox Bot", title: "Email triage", description: "Keeps the inbox clean." },
      user.id
    );

    expect(bot.id).toBeTruthy();
    expect(bot.isChief).toBe(false);
    expect(bot.avatarSeed).toBeTruthy();
    expect(bot.systemPrompt).toContain("Inbox Bot");

    const conversation = getConversation(bot.homeConversationId, user.id);
    expect(conversation).not.toBeNull();
    expect(conversation?.conversationOrigin).toBe("bot");
    expect(conversation?.title).toBe("Inbox Bot");

    expect(getBotByConversationId(bot.homeConversationId)?.id).toBe(bot.id);
    expect(listBots(user.id).map((entry) => entry.name)).toEqual(["Inbox Bot"]);

    const { existsSync, statSync } = await import("node:fs");
    const { getBotWorkspaceDir } = await import("@/lib/bot-sandbox");
    const workspaceDir = getBotWorkspaceDir(bot);
    expect(existsSync(workspaceDir)).toBe(true);
    expect(statSync(workspaceDir).isDirectory()).toBe(true);
  });

  it("rejects duplicate names per user and enforces the cap", async () => {
    const user = await createLocalUser({ username: "botlimits", password: "password-123", role: "user" as const });

    expect(() => createBot({ name: "Alpha" }, user.id)).not.toThrow();
    expect(() => createBot({ name: "alpha" }, user.id)).toThrow(/already exists/i);

    const maxBots = (await import("@/lib/bots")).MAX_BOTS_PER_USER;
    for (let index = 0; index < maxBots - 1; index += 1) {
      createBot({ name: `Bot ${index}` }, user.id);
    }
    expect(() => createBot({ name: "One Too Many" }, user.id)).toThrow(/limit reached/i);
  });

  it("creates the chief exactly once and protects it from deletion", async () => {
    const user = await createLocalUser({ username: "chiefowner", password: "password-123", role: "user" as const });
    const chief = ensureChiefBot(user.id);
    expect(chief.isChief).toBe(true);
    expect(ensureChiefBot(user.id).id).toBe(chief.id);

    expect(() => deleteBot(chief.id, user.id)).toThrow(/cannot be deleted/i);
  });

  it("builds the chief prompt with the current roster", async () => {
    const user = await createLocalUser({ username: "chiefprompt", password: "password-123", role: "user" as const });
    const { buildBotSystemPrompt } = await import("@/lib/bots");
    const chief = ensureChiefBot(user.id);

    const emptyPrompt = buildBotSystemPrompt(chief);
    expect(emptyPrompt).toContain("no specialist bots");

    createBot({ name: "Researcher", title: "Web research", description: "Finds sources." }, user.id);
    const rosterPrompt = buildBotSystemPrompt(chief);
    expect(rosterPrompt).toContain("Researcher");
    expect(rosterPrompt).toContain("Web research");
    expect(rosterPrompt).toContain("Finds sources.");
  });

  it("deleting a bot disables its automations and removes its thread", async () => {
    const { createAutomation } = await import("@/lib/automations");
    const { updateProviderCatalog } = await import("@/lib/settings");
    const { createProviderProfileInput } = await import("@/tests/provider-fixtures");

    const user = await createLocalUser({ username: "botdeleter", password: "password-123", role: "user" as const });
    const profile = createProviderProfileInput({
      id: "profile_bot_delete",
      name: "Bot Delete",
      model: "gpt-test",
      systemPrompt: "Be exact.",
      temperature: 0.2,
      maxOutputTokens: 512,
      modelContextLimit: 16384,
      freshTailCount: 12,
      visionMode: "none",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    updateProviderCatalog({
      defaultProviderProfileId: profile.id,
      skillsEnabled: false,
      providerProfiles: [profile]
    });

    const bot = createBot({ name: "Temp Bot" }, user.id);
    createMessage({ conversationId: bot.homeConversationId, role: "user", content: "hello" });
    const automation = createAutomation(
      {
        name: "Temp routine",
        prompt: "check",
        providerProfileId: profile.id,
        personaId: null,
        botId: bot.id,
        scheduleKind: "interval",
        intervalMinutes: 30,
        calendarFrequency: null,
        timeOfDay: null,
        daysOfWeek: []
      },
      user.id
    );

    expect(deleteBot(bot.id, user.id)).toBe(true);
    expect(getBot(bot.id, user.id)).toBeNull();
    expect(getConversation(bot.homeConversationId, user.id)).toBeNull();
    expect(getBotByConversationId(bot.homeConversationId)).toBeNull();

    const { getAutomation } = await import("@/lib/automations");
    const updated = getAutomation(automation.id, user.id);
    expect(updated).not.toBeNull();
    expect(updated?.enabled).toBe(false);
    expect(updated?.botId).toBeNull();
  });

  it("renaming a bot renames its home thread", async () => {
    const { updateBot } = await import("@/lib/bots");
    const user = await createLocalUser({ username: "botrenamer", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Old Name" }, user.id);

    const updated = updateBot(bot.id, { name: "New Name", title: "Fresh title" }, user.id);

    expect(updated?.name).toBe("New Name");
    const conversation = getConversation(updated?.homeConversationId ?? "", user.id);
    expect(conversation?.title).toBe("New Name");
    expect(conversation?.titleGenerationStatus).toBe("completed");
  });

  it("resolves bots by id or case-insensitive name", async () => {
    const { resolveBotByNameOrId } = await import("@/lib/bots");
    const user = await createLocalUser({ username: "botresolver", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Scout" }, user.id);

    expect(resolveBotByNameOrId(bot.id, user.id)?.id).toBe(bot.id);
    expect(resolveBotByNameOrId("scout", user.id)?.id).toBe(bot.id);
    expect(resolveBotByNameOrId(" SCOUT ", user.id)?.id).toBe(bot.id);
    expect(resolveBotByNameOrId("missing", user.id)).toBeNull();
  });
});
