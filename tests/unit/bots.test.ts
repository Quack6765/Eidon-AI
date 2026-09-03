import { describe, expect, it, vi } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot, deleteBot, ensureChiefBot, getBot, getBotByConversationId, listBots, toBotSummary } from "@/lib/bots";
import { getConversation, createConversation, createMessage, createMessageAction } from "@/lib/conversations";

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
    expect(bot.systemPrompt).toBe("");

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

  it("issues short bot- prefixed ids without collisions", async () => {
    const user = await createLocalUser({ username: "botids", password: "password-123", role: "user" as const });
    const ids = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      const bot = createBot({ name: `Bot ${index}` }, user.id);
      expect(bot.id).toMatch(/^bot-[a-z0-9]{6}$/);
      ids.add(bot.id);
    }
    expect(ids.size).toBe(12);
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

  it("composes worker prompts from the base, identity, and communication context", async () => {
    const user = await createLocalUser({ username: "botprompt", password: "password-123", role: "user" as const });
    const { buildBotSystemPrompt, DEFAULT_BOT_BASE_SYSTEM_PROMPT } = await import("@/lib/bots");
    ensureChiefBot(user.id);
    const worker = createBot(
      { name: "Researcher", title: "Web research", description: "Finds sources." },
      user.id
    );

    const prompt = buildBotSystemPrompt(worker);
    expect(prompt.startsWith(DEFAULT_BOT_BASE_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("You are Researcher, Web research");
    expect(prompt).toContain("Your role: Finds sources.");
    expect(prompt).toContain("message_bot");
    expect(prompt).toContain("Chief of Staff");
    expect(prompt).toContain("delivered back to the sender automatically");

    const customBase = buildBotSystemPrompt(worker, "Custom base line.");
    expect(customBase.startsWith("Custom base line.")).toBe(true);
    expect(customBase).not.toContain(DEFAULT_BOT_BASE_SYSTEM_PROMPT);

    const specialist = createBot({ name: "Curator", systemPrompt: "You curate art." }, user.id);
    const curated = buildBotSystemPrompt(specialist);
    expect(curated.startsWith(DEFAULT_BOT_BASE_SYSTEM_PROMPT)).toBe(true);
    expect(curated).toContain("You curate art.");
    expect(curated).toContain("message_bot");
    expect(curated).toContain("Only the chief of staff can create or edit bots");
  });

  it("builds the chief prompt with a cautious creation policy requiring confirmation", async () => {
    const user = await createLocalUser({ username: "chiefpolicy", password: "password-123", role: "user" as const });
    const { buildBotSystemPrompt } = await import("@/lib/bots");
    const chief = ensureChiefBot(user.id);
    const worker = createBot({ name: "Researcher" }, user.id);

    const chiefPrompt = buildBotSystemPrompt(chief);
    expect(chiefPrompt).toContain("bias against it");
    expect(chiefPrompt).toContain("recurring");
    expect(chiefPrompt).toContain("wait for their explicit confirmation");
    expect(chiefPrompt).toContain("message_bot");
    expect(chiefPrompt).toContain("Researcher");
    expect(chiefPrompt).toContain("Never use message_bot to acknowledge");
    expect(chiefPrompt).toContain("report it to the user directly");

    const workerPrompt = buildBotSystemPrompt(worker);
    expect(workerPrompt).not.toContain("wait for their explicit confirmation");
    expect(workerPrompt).not.toContain("update_bot");
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

    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { getBotBrowserSocketDir, getBotWorkspaceDir, resolveBotSandbox } = await import("@/lib/bot-sandbox");
    const workspaceDir = getBotWorkspaceDir(bot);
    mkdirSync(`${workspaceDir}/nested`, { recursive: true });
    writeFileSync(`${workspaceDir}/nested/keep.txt`, "data");
    const socketDir = getBotBrowserSocketDir(bot);
    mkdirSync(socketDir, { recursive: true });
    writeFileSync(`${socketDir}/profile-data.json`, "{}");
    resolveBotSandbox(bot);

    expect(deleteBot(bot.id, user.id)).toBe(true);
    expect(getBot(bot.id, user.id)).toBeNull();
    expect(getConversation(bot.homeConversationId, user.id)).toBeNull();
    expect(getBotByConversationId(bot.homeConversationId)).toBeNull();
    expect(existsSync(workspaceDir)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(existsSync(socketDir)).toBe(false);

    const { getAutomation } = await import("@/lib/automations");
    const updated = getAutomation(automation.id, user.id);
    expect(updated).not.toBeNull();
    expect(updated?.enabled).toBe(false);
    expect(updated?.botId).toBeNull();
  });

  it("deletes the stored avatar when the bot is deleted", async () => {
    const user = await createLocalUser({ username: "botavatar", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Avatar Bot" }, user.id);

    const { ensureBotAvatarSvg } = await import("@/lib/bot-avatar-store");
    const { getDb } = await import("@/lib/db");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<svg>robot</svg>"
    } as Response));

    try {
      await ensureBotAvatarSvg(bot.avatarSeed);
      expect(
        getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get(bot.avatarSeed)
      ).toBeDefined();

      expect(deleteBot(bot.id, user.id)).toBe(true);
      expect(
        getDb().prepare("SELECT 1 FROM bot_avatars WHERE seed = ?").get(bot.avatarSeed)
      ).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
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

describe("bot pending input summary", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function createPendingProposal(botId: string, conversationId: string, content: string) {
    const { buildCreateMemoryProposal } = await import("@/lib/memory-proposals");
    const message = createMessage({
      conversationId,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0
    });
    return createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Create memory proposal",
      proposalState: "pending",
      proposalPayload: buildCreateMemoryProposal({
        content,
        category: "preference"
      })
    });
  }

  it("flags waitingForInput while a proposal is pending, clears it once seen, and re-lights for newer input", async () => {
    const { markBotPendingInputSeen } = await import("@/lib/bots");
    const user = await createLocalUser({ username: "botpending", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Pending Bot" }, user.id);

    expect(toBotSummary(bot).waitingForInput).toBe(false);

    await createPendingProposal(bot.id, bot.homeConversationId, "Likes tea");
    expect(toBotSummary(getBot(bot.id, user.id)!).waitingForInput).toBe(true);

    await sleep(5);
    const seen = markBotPendingInputSeen(bot.id, user.id);
    expect(seen?.pendingInputSeenAt).toBeTruthy();
    expect(toBotSummary(getBot(bot.id, user.id)!).waitingForInput).toBe(false);

    await sleep(5);
    await createPendingProposal(bot.id, bot.homeConversationId, "Also likes biscuits");
    expect(toBotSummary(getBot(bot.id, user.id)!).waitingForInput).toBe(true);

    expect(markBotPendingInputSeen("bot-missing", user.id)).toBeNull();
  });

  it("clears waitingForInput when the pending proposal is resolved", async () => {
    const { dismissMemoryProposal } = await import("@/lib/memory-proposals");
    const user = await createLocalUser({ username: "botresolved", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Resolved Bot" }, user.id);

    const action = await createPendingProposal(bot.id, bot.homeConversationId, "Likes tea");
    expect(toBotSummary(getBot(bot.id, user.id)!).waitingForInput).toBe(true);

    dismissMemoryProposal(action.id, user.id);
    expect(toBotSummary(getBot(bot.id, user.id)!).waitingForInput).toBe(false);
  });

  it("does not flag pending input from another conversation", async () => {
    const user = await createLocalUser({ username: "botforeign", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Foreign Bot" }, user.id);
    const other = createConversation(undefined, undefined, undefined, user.id);

    await createPendingProposal(bot.id, other.id, "Unrelated proposal");
    expect(toBotSummary(getBot(bot.id, user.id)!).waitingForInput).toBe(false);
  });
});
