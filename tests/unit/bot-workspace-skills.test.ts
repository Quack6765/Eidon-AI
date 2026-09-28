import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_BOT_WORKSPACE_SKILLS,
  MAX_SKILL_FILE_BYTES,
  buildBotWorkspaceSkillId,
  buildSkillMarkdown,
  deleteBotWorkspaceSkill,
  getBotSkillsDir,
  getBotWorkspaceSkill,
  isBotWorkspaceSkillId,
  listBotWorkspaceSkills,
  mergeSkillsWithWorkspace,
  parseBotWorkspaceSkillId,
  saveBotWorkspaceSkill,
  slugifySkillFolderName,
  upsertBotWorkspaceSkill
} from "@/lib/bot-workspace-skills";
import type { Skill } from "@/lib/types";

const bot = { id: "bot_ws_probe", userId: "user_ws_probe" };

function writeWorkspaceSkill(folder: string, content: string) {
  const skillDir = join(getBotSkillsDir(bot), folder);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
}

function globalSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_global",
    name: "Global Skill",
    description: "A global skill.",
    content: "---\nname: Global Skill\ndescription: A global skill.\n---\n\nBody",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("bot-workspace-skills", () => {
  it("returns no skills when the workspace has no skills folder", () => {
    expect(listBotWorkspaceSkills(bot)).toEqual([]);
  });

  it("discovers SKILL.md folders with frontmatter metadata and stable ids", () => {
    writeWorkspaceSkill(
      "pdf-extraction",
      "---\nname: PDF Extraction\ndescription: Use when extracting text from PDFs.\n---\n\nRun pdftotext first."
    );

    const skills = listBotWorkspaceSkills(bot);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe(buildBotWorkspaceSkillId(bot.id, "pdf-extraction"));
    expect(skills[0].name).toBe("PDF Extraction");
    expect(skills[0].description).toBe("Use when extracting text from PDFs.");
    expect(skills[0].content).toContain("Run pdftotext first.");
    expect(skills[0].enabled).toBe(true);
    expect(skills[0].createdAt).toEqual(expect.any(String));
    expect(skills[0].updatedAt).toEqual(expect.any(String));
    expect(isBotWorkspaceSkillId(skills[0].id)).toBe(true);
  });

  it("falls back to the folder name and first body line when frontmatter is missing", () => {
    writeWorkspaceSkill("release-notes", "# Release Notes\n\nSummarize merged PRs into notes.\n\nMore detail.");

    const skills = listBotWorkspaceSkills(bot);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("release-notes");
    expect(skills[0].description).toBe("Summarize merged PRs into notes.");
  });

  it("skips folders without SKILL.md, non-directory entries, and oversized files", () => {
    writeWorkspaceSkill("real-skill", "Just instructions.");
    mkdirSync(join(getBotSkillsDir(bot), "no-skill-file"));
    writeFileSync(join(getBotSkillsDir(bot), "stray-file.md"), "not a folder");
    writeWorkspaceSkill("too-big", `---\nname: Too Big\n---\n\n${"x".repeat(200 * 1024 + 1)}`);

    const skills = listBotWorkspaceSkills(bot);
    expect(skills.map((skill) => skill.name)).toEqual(["real-skill"]);
  });

  it("returns at most 50 skills in sorted folder order", () => {
    for (let index = 0; index < 51; index += 1) {
      writeWorkspaceSkill(`skill-${String(index).padStart(2, "0")}`, "Body");
    }

    const skills = listBotWorkspaceSkills(bot);
    expect(skills).toHaveLength(50);
    expect(skills[0].name).toBe("skill-00");
    expect(skills[49].name).toBe("skill-49");
  });

  it("slugifies skill folder names", () => {
    expect(slugifySkillFolderName("PDF Extraction!")).toBe("pdf-extraction");
    expect(slugifySkillFolderName("  --Leading and trailing--  ")).toBe("leading-and-trailing");
    expect(slugifySkillFolderName("!!!")).toBe("");
    expect(slugifySkillFolderName(`a`.repeat(100))).toHaveLength(64);
  });

  describe("buildSkillMarkdown", () => {
    it("wraps name and description in frontmatter above the instructions", () => {
      expect(buildSkillMarkdown("PDF Extraction", "Pull text from PDFs.", "Run pdftotext first.")).toBe(
        "---\nname: PDF Extraction\ndescription: Pull text from PDFs.\n---\n\nRun pdftotext first.\n"
      );
    });
  });

  describe("parseBotWorkspaceSkillId", () => {
    it("returns the folder slug for ids built for this bot", () => {
      const skillId = buildBotWorkspaceSkillId(bot.id, "pdf-extraction");
      expect(parseBotWorkspaceSkillId(bot, skillId)).toBe("pdf-extraction");
    });

    it("rejects ids from another bot", () => {
      const otherBotId = buildBotWorkspaceSkillId("bot_other", "pdf-extraction");
      expect(parseBotWorkspaceSkillId(bot, otherBotId)).toBeNull();
    });

    it("rejects traversal and malformed folder slugs", () => {
      const sanitizedBotId = bot.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
      expect(parseBotWorkspaceSkillId(bot, `botws-${sanitizedBotId}-..`)).toBeNull();
      expect(parseBotWorkspaceSkillId(bot, `botws-${sanitizedBotId}-../escape`)).toBeNull();
      expect(parseBotWorkspaceSkillId(bot, `botws-${sanitizedBotId}-/etc/passwd`)).toBeNull();
      expect(parseBotWorkspaceSkillId(bot, `botws-${sanitizedBotId}-Uppercase`)).toBeNull();
      expect(parseBotWorkspaceSkillId(bot, `botws-${sanitizedBotId}-`)).toBeNull();
      expect(parseBotWorkspaceSkillId(bot, "skill_db_1")).toBeNull();
    });
  });

  describe("saveBotWorkspaceSkill", () => {
    it("creates the canonical SKILL.md folder and returns the skill", () => {
      const result = saveBotWorkspaceSkill(bot, {
        name: "Meeting Notes",
        description: "Summarize meetings.",
        instructions: "Capture action items."
      });

      expect("error" in result && result.error).toBeFalsy();
      if (!("skill" in result)) throw new Error("expected skill");
      expect(result.skill.id).toBe(buildBotWorkspaceSkillId(bot.id, "meeting-notes"));
      expect(result.skill.name).toBe("Meeting Notes");
      expect(result.skill.description).toBe("Summarize meetings.");
      expect(result.skill.enabled).toBe(true);

      const written = readFileSync(join(getBotSkillsDir(bot), "meeting-notes", "SKILL.md"), "utf8");
      expect(written).toBe(buildSkillMarkdown("Meeting Notes", "Summarize meetings.", "Capture action items."));
      expect(getBotWorkspaceSkill(bot, result.skill.id)?.content).toBe(written);
    });

    it("collapses whitespace in name and description", () => {
      const result = saveBotWorkspaceSkill(bot, {
        name: "  Whitespace   Heavy  ",
        description: "  A   description.  ",
        instructions: "Body"
      });

      if (!("skill" in result)) throw new Error("expected skill");
      expect(result.skill.name).toBe("Whitespace Heavy");
      expect(result.skill.description).toBe("A description.");
    });

    it("rejects missing fields, long names, unusable slugs, and oversized content", () => {
      expect(saveBotWorkspaceSkill(bot, { name: "", description: "d", instructions: "i" })).toMatchObject({
        error: expect.any(String)
      });
      expect(saveBotWorkspaceSkill(bot, { name: "n", description: "", instructions: "i" })).toMatchObject({
        error: expect.any(String)
      });
      expect(saveBotWorkspaceSkill(bot, { name: "n", description: "d", instructions: "  " })).toMatchObject({
        error: expect.any(String)
      });
      expect(
        saveBotWorkspaceSkill(bot, { name: "x".repeat(101), description: "d", instructions: "i" })
      ).toMatchObject({ error: expect.any(String) });
      expect(
        saveBotWorkspaceSkill(bot, { name: "!!!", description: "d", instructions: "i" })
      ).toMatchObject({ error: expect.any(String) });
      expect(
        saveBotWorkspaceSkill(bot, {
          name: "Huge",
          description: "d",
          instructions: "x".repeat(MAX_SKILL_FILE_BYTES)
        })
      ).toMatchObject({ error: expect.any(String) });
    });

    it("rejects creates that collide with an existing skill folder", () => {
      writeWorkspaceSkill("collision-target", "Existing body");

      const result = saveBotWorkspaceSkill(bot, {
        name: "Collision Target",
        description: "d",
        instructions: "i"
      });

      expect(result).toMatchObject({ error: expect.stringContaining("already exists") });
      expect(readFileSync(join(getBotSkillsDir(bot), "collision-target", "SKILL.md"), "utf8")).toBe(
        "Existing body"
      );
    });

    it("renames the folder when the name changes and rejects taken target slugs", () => {
      const created = saveBotWorkspaceSkill(bot, {
        name: "Rename Me",
        description: "d",
        instructions: "i"
      });
      if (!("skill" in created)) throw new Error("expected skill");

      writeWorkspaceSkill("taken-folder", "Other skill");

      const blocked = saveBotWorkspaceSkill(
        bot,
        { name: "Taken Folder", description: "d", instructions: "i" },
        created.skill.id
      );
      expect(blocked).toMatchObject({ error: expect.stringContaining("already exists") });

      const renamed = saveBotWorkspaceSkill(
        bot,
        { name: "Renamed Skill", description: "d", instructions: "new body" },
        created.skill.id
      );
      if (!("skill" in renamed)) throw new Error("expected skill");

      expect(renamed.skill.id).toBe(buildBotWorkspaceSkillId(bot.id, "renamed-skill"));
      expect(existsSync(join(getBotSkillsDir(bot), "rename-me"))).toBe(false);
      expect(readFileSync(join(getBotSkillsDir(bot), "renamed-skill", "SKILL.md"), "utf8")).toContain("new body");
    });

    it("moves supporting files along when a rename changes the folder", () => {
      const created = saveBotWorkspaceSkill(bot, { name: "Old Name", description: "d", instructions: "i" });
      if (!("skill" in created)) throw new Error("expected skill");
      const oldDir = join(getBotSkillsDir(bot), "old-name");
      mkdirSync(join(oldDir, "scripts"), { recursive: true });
      writeFileSync(join(oldDir, "scripts", "run.sh"), "echo hi", "utf8");

      const renamed = saveBotWorkspaceSkill(
        bot,
        { name: "New Name", description: "d", instructions: "i" },
        created.skill.id
      );
      if (!("skill" in renamed)) throw new Error("expected skill");

      const newDir = join(getBotSkillsDir(bot), "new-name");
      expect(existsSync(oldDir)).toBe(false);
      expect(readFileSync(join(newDir, "scripts", "run.sh"), "utf8")).toBe("echo hi");
      expect(readFileSync(join(newDir, "SKILL.md"), "utf8")).toContain("name: New Name");
    });

    it("refuses to rename into an existing folder even without a SKILL.md", () => {
      const created = saveBotWorkspaceSkill(bot, { name: "Source", description: "d", instructions: "i" });
      if (!("skill" in created)) throw new Error("expected skill");
      mkdirSync(join(getBotSkillsDir(bot), "target", "assets"), { recursive: true });

      expect(
        saveBotWorkspaceSkill(bot, { name: "Target", description: "d", instructions: "i" }, created.skill.id)
      ).toMatchObject({ error: expect.stringContaining("already has a skills/target folder") });
      expect(existsSync(join(getBotSkillsDir(bot), "source", "SKILL.md"))).toBe(true);
    });

    it("caps new skills per bot but still allows updates and renames at the cap", () => {
      for (let index = 0; index < MAX_BOT_WORKSPACE_SKILLS; index += 1) {
        writeWorkspaceSkill(`skill-${String(index).padStart(2, "0")}`, `---\nname: skill-${index}\n---\n\nBody`);
      }
      mkdirSync(join(getBotSkillsDir(bot), "not-a-skill"), { recursive: true });

      expect(saveBotWorkspaceSkill(bot, { name: "One Too Many", description: "d", instructions: "i" })).toMatchObject({
        error: expect.stringContaining(`${MAX_BOT_WORKSPACE_SKILLS} skills`)
      });
      expect(existsSync(join(getBotSkillsDir(bot), "one-too-many"))).toBe(false);

      const existingId = buildBotWorkspaceSkillId(bot.id, "skill-00");
      expect(
        saveBotWorkspaceSkill(bot, { name: "skill-00", description: "d", instructions: "updated" }, existingId)
      ).toHaveProperty("skill");
      expect(
        saveBotWorkspaceSkill(bot, { name: "Renamed At Cap", description: "d", instructions: "i" }, existingId)
      ).toHaveProperty("skill");
      expect(listBotWorkspaceSkills(bot)).toHaveLength(MAX_BOT_WORKSPACE_SKILLS);
    });
  });

  describe("upsertBotWorkspaceSkill", () => {
    it("updates a skill saved under the same name, ignoring case", () => {
      upsertBotWorkspaceSkill(bot, { name: "Release Notes", description: "d", instructions: "Old body." });
      const updated = upsertBotWorkspaceSkill(bot, { name: "release notes", description: "d", instructions: "New body." });

      expect(updated).toHaveProperty("skill.id", buildBotWorkspaceSkillId(bot.id, "release-notes"));
      const skills = listBotWorkspaceSkills(bot);
      expect(skills).toHaveLength(1);
      expect(skills[0].content).toContain("New body.");
    });

    it("refuses a differently named skill that maps to the same folder", () => {
      upsertBotWorkspaceSkill(bot, { name: "Release Notes", description: "d", instructions: "Original." });

      expect(upsertBotWorkspaceSkill(bot, { name: "release-notes", description: "d", instructions: "Clobber." })).toMatchObject({
        error: expect.stringContaining('The skill "Release Notes" already uses this folder')
      });
      expect(listBotWorkspaceSkills(bot)[0].content).toContain("Original.");
    });
  });

  describe("deleteBotWorkspaceSkill", () => {
    it("removes the skill folder and reports whether it existed", () => {
      const created = saveBotWorkspaceSkill(bot, {
        name: "Delete Me",
        description: "d",
        instructions: "i"
      });
      if (!("skill" in created)) throw new Error("expected skill");

      expect(deleteBotWorkspaceSkill(bot, created.skill.id)).toBe(true);
      expect(existsSync(join(getBotSkillsDir(bot), "delete-me"))).toBe(false);
      expect(deleteBotWorkspaceSkill(bot, created.skill.id)).toBe(false);
    });

    it("ignores invalid ids without touching the skills dir", () => {
      expect(deleteBotWorkspaceSkill(bot, "../escape")).toBe(false);
      expect(deleteBotWorkspaceSkill(bot, "skill_db_1")).toBe(false);
    });
  });

  describe("mergeSkillsWithWorkspace", () => {
    it("returns global skills untouched when there are no workspace skills", () => {
      const globals = [globalSkill()];
      expect(mergeSkillsWithWorkspace(globals, [])).toBe(globals);
    });

    it("shadows same-named global skills and appends the rest", () => {
      const globals = [
        globalSkill({ id: "skill_a", name: "Alpha", content: "---\nname: Alpha\n---\n\nA" }),
        globalSkill({ id: "skill_b", name: "Beta", content: "---\nname: Beta\n---\n\nB" })
      ];
      const workspace = [
        {
          id: buildBotWorkspaceSkillId(bot.id, "alpha"),
          name: "alpha",
          description: "Agent-authored alpha.",
          content: "---\nname: ALPHA\ndescription: Agent-authored alpha.\n---\n\nLocal",
          enabled: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ];

      const merged = mergeSkillsWithWorkspace(globals, workspace);
      expect(merged.map((skill) => skill.id)).toEqual(["skill_b", workspace[0].id]);
    });
  });
});
