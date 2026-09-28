import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBot } from "@/lib/bots";
import { getBotSkillsDir } from "@/lib/bot-workspace-skills";
import { createConversation } from "@/lib/conversations";
import { updateGlobalPreferences } from "@/lib/global-preferences";
import type { ComposerReferences } from "@/lib/reference-tokens";
import { createSkill } from "@/lib/skills";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

async function getReferences(conversationId?: string) {
  const { GET } = await import("@/app/api/composer/references/route");
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
  const response = await GET(new Request(`http://localhost/api/composer/references${query}`));
  return { status: response.status, payload: (await response.json()) as ComposerReferences };
}

describe("composer references route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("lists enabled skills and no bots outside bot conversations", async () => {
    const user = await createLocalUser({ username: "refs-chat", password: "password-123", role: "user" });
    requireUserMock.mockResolvedValue(user);
    createBot({ name: "Writer" }, user.id);
    createSkill({ name: "Daily Report", description: "Summarize the day", content: "Report." });
    createSkill({ name: "Retired", description: "Old", content: "Old.", enabled: false });
    const conversation = createConversation("Chat", null, {}, user.id);

    for (const conversationId of [undefined, conversation.id]) {
      const { status, payload } = await getReferences(conversationId);
      expect(status).toBe(200);
      expect(payload.bots).toEqual([]);
      expect(payload.skills).toContainEqual({ name: "Daily Report", description: "Summarize the day" });
      expect(payload.skills.map((skill) => skill.name)).not.toContain("Retired");
    }
  });

  it("lists the other bots and the bot's workspace skills inside a bot conversation", async () => {
    const user = await createLocalUser({ username: "refs-bot", password: "password-123", role: "user" });
    requireUserMock.mockResolvedValue(user);
    const writer = createBot({ name: "Writer", title: "Copywriter" }, user.id);
    const editor = createBot({ name: "Editor" }, user.id);
    const skillDir = join(getBotSkillsDir(writer), "tone-guide");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: Tone Guide\ndescription: House voice.\n---\n\nBe warm.", "utf8");

    const { status, payload } = await getReferences(writer.homeConversationId);

    expect(status).toBe(200);
    expect(payload.bots).toEqual([{ name: "Editor", title: "", avatarSeed: editor.avatarSeed }]);
    expect(payload.skills).toContainEqual({ name: "Tone Guide", description: "House voice." });
  });

  it("returns no skills when skills are turned off", async () => {
    const user = await createLocalUser({ username: "refs-off", password: "password-123", role: "user" });
    requireUserMock.mockResolvedValue(user);
    createSkill({ name: "Daily Report", content: "Report." });
    updateGlobalPreferences({ skillsEnabled: false });

    const { payload } = await getReferences();

    expect(payload.skills).toEqual([]);
  });

  it("hides another user's conversation", async () => {
    const owner = await createLocalUser({ username: "refs-owner", password: "password-123", role: "user" });
    const stranger = await createLocalUser({ username: "refs-stranger", password: "password-123", role: "user" });
    const bot = createBot({ name: "Private" }, owner.id);
    requireUserMock.mockResolvedValue(stranger);

    const { status } = await getReferences(bot.homeConversationId);

    expect(status).toBe(404);
  });
});
