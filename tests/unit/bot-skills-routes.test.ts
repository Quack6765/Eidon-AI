import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBot } from "@/lib/bots";
import { getBotSkillsDir, listBotWorkspaceSkills } from "@/lib/bot-workspace-skills";
import { createLocalUser } from "@/lib/users";
import type { Bot } from "@/lib/types";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

function buildBotContext(botId: string): { params: Promise<{ botId: string }> } {
  return { params: Promise.resolve({ botId }) };
}

function buildSkillContext(
  botId: string,
  skillId: string
): { params: Promise<{ botId: string; skillId: string }> } {
  return { params: Promise.resolve({ botId, skillId }) };
}

function seedWorkspaceSkill(bot: Pick<Bot, "id" | "userId">, folder: string, content: string) {
  const skillDir = join(getBotSkillsDir(bot), folder);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
}

async function createUserWithBot(username: string) {
  const user = await createLocalUser({ username, password: "password-123", role: "user" as const });
  const bot = createBot({ name: `${username} bot` }, user.id);
  return { user, bot };
}

describe("bot skills routes", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
  });

  it("lists the bot's workspace skills for the owner", async () => {
    const { user, bot } = await createUserWithBot("skillsowner");
    requireUserMock.mockResolvedValue(user);
    seedWorkspaceSkill(
      bot,
      "pdf-extraction",
      "---\nname: PDF Extraction\ndescription: Pull text from PDFs.\n---\n\nRun pdftotext."
    );

    const { GET } = await import("@/app/api/bots/[botId]/skills/route");
    const response = await GET(new Request("http://localhost/"), buildBotContext(bot.id));
    const payload = (await response.json()) as { skills?: Array<{ name: string }> };

    expect(response.status).toBe(200);
    expect(payload.skills?.map((skill) => skill.name)).toEqual(["PDF Extraction"]);
  });

  it("hides skills from other users and unknown bots", async () => {
    const { user } = await createUserWithBot("skillsstranger");
    const { bot } = await createUserWithBot("skillshidden");
    requireUserMock.mockResolvedValue(user);

    const { GET } = await import("@/app/api/bots/[botId]/skills/route");
    const notOwner = await GET(new Request("http://localhost/"), buildBotContext(bot.id));
    const missing = await GET(new Request("http://localhost/"), buildBotContext("bot_missing"));

    expect(notOwner.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it("creates a skill from name, description, and instructions", async () => {
    const { user, bot } = await createUserWithBot("skillscreator");
    requireUserMock.mockResolvedValue(user);

    const { POST } = await import("@/app/api/bots/[botId]/skills/route");
    const response = await POST(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Meeting Notes",
          description: "Summarize meetings.",
          instructions: "Capture action items."
        })
      }),
      buildBotContext(bot.id)
    );
    const payload = (await response.json()) as { skill?: { id: string; content: string } };

    expect(response.status).toBe(201);
    expect(payload.skill?.content).toBe(
      "---\nname: Meeting Notes\ndescription: Summarize meetings.\n---\n\nCapture action items.\n"
    );
    expect(existsSync(join(getBotSkillsDir(bot), "meeting-notes", "SKILL.md"))).toBe(true);
  });

  it("rejects invalid create payloads and name collisions", async () => {
    const { user, bot } = await createUserWithBot("skillsinvalid");
    requireUserMock.mockResolvedValue(user);
    seedWorkspaceSkill(bot, "taken", "Existing");

    const { POST } = await import("@/app/api/bots/[botId]/skills/route");
    const invalid = await POST(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Only Name" })
      }),
      buildBotContext(bot.id)
    );
    const collision = await POST(
      new Request("http://localhost/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Taken", description: "d", instructions: "i" })
      }),
      buildBotContext(bot.id)
    );

    expect(invalid.status).toBe(400);
    expect(collision.status).toBe(400);
    expect(((await collision.json()) as { error: string }).error).toContain("already exists");
  });

  it("patches fields, merges with existing content, and renames folders on name change", async () => {
    const { user, bot } = await createUserWithBot("skillspatcher");
    requireUserMock.mockResolvedValue(user);
    seedWorkspaceSkill(
      bot,
      "old-name",
      "---\nname: Old Name\ndescription: Old description.\n---\n\nOld instructions."
    );

    const { PATCH } = await import("@/app/api/bots/[botId]/skills/[skillId]/route");
    const skillId = `botws-${bot.id}-old-name`;
    const partial = await PATCH(
      new Request("http://localhost/", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "New description." })
      }),
      buildSkillContext(bot.id, skillId)
    );

    expect(partial.status).toBe(200);
    const partialPayload = (await partial.json()) as { skill?: { content: string } };
    expect(partialPayload.skill?.content).toBe(
      "---\nname: Old Name\ndescription: New description.\n---\n\nOld instructions.\n"
    );

    const renamed = await PATCH(
      new Request("http://localhost/", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "New Name" })
      }),
      buildSkillContext(bot.id, skillId)
    );

    expect(renamed.status).toBe(200);
    const renamedPayload = (await renamed.json()) as { skill?: { id: string } };
    expect(renamedPayload.skill?.id).toBe(`botws-${bot.id}-new-name`);
    expect(existsSync(join(getBotSkillsDir(bot), "old-name"))).toBe(false);
    expect(listBotWorkspaceSkills(bot).map((skill) => skill.name)).toEqual(["New Name"]);
  });

  it("returns 404 for unknown or malformed skill ids", async () => {
    const { user, bot } = await createUserWithBot("skillsmissing");
    requireUserMock.mockResolvedValue(user);

    const { PATCH, DELETE } = await import("@/app/api/bots/[botId]/skills/[skillId]/route");
    const unknown = await PATCH(
      new Request("http://localhost/", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Whatever" })
      }),
      buildSkillContext(bot.id, `botws-${bot.id}-ghost`)
    );
    const malformed = await DELETE(
      new Request("http://localhost/", { method: "DELETE" }),
      buildSkillContext(bot.id, "../escape")
    );

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
  });

  it("deletes a skill folder", async () => {
    const { user, bot } = await createUserWithBot("skillsdeleter");
    requireUserMock.mockResolvedValue(user);
    seedWorkspaceSkill(bot, "doomed", "Body");

    const { DELETE } = await import("@/app/api/bots/[botId]/skills/[skillId]/route");
    const response = await DELETE(
      new Request("http://localhost/", { method: "DELETE" }),
      buildSkillContext(bot.id, `botws-${bot.id}-doomed`)
    );
    const second = await DELETE(
      new Request("http://localhost/", { method: "DELETE" }),
      buildSkillContext(bot.id, `botws-${bot.id}-doomed`)
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as { success: boolean }).success).toBe(true);
    expect(existsSync(join(getBotSkillsDir(bot), "doomed"))).toBe(false);
    expect(second.status).toBe(404);
  });
});
