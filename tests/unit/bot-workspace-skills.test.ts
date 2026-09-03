import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBotWorkspaceSkillId,
  getBotSkillsDir,
  isBotWorkspaceSkillId,
  listBotWorkspaceSkills,
  mergeSkillsWithWorkspace,
  slugifySkillFolderName
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
