import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getBotWorkspaceDir } from "@/lib/bot-sandbox";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { getSkillResolvedName } from "@/lib/skill-runtime";
import { deriveDescription } from "@/lib/skills";
import type { Bot, Skill } from "@/lib/types";

export const BOT_WORKSPACE_SKILL_ID_PREFIX = "botws-";

const MAX_BOT_WORKSPACE_SKILLS = 50;
const MAX_SKILL_FILE_BYTES = 200 * 1024;
const SKILL_FILE_NAME = "SKILL.md";

export function getBotSkillsDir(bot: Pick<Bot, "id" | "userId">) {
  return join(getBotWorkspaceDir(bot), "skills");
}

export function isBotWorkspaceSkillId(skillId: string) {
  return skillId.startsWith(BOT_WORKSPACE_SKILL_ID_PREFIX);
}

export function slugifySkillFolderName(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function buildBotWorkspaceSkillId(botId: string, folderSlug: string) {
  const sanitizedBotId = botId.replace(/[^a-zA-Z0-9_-]+/g, "-") || "bot";
  return `${BOT_WORKSPACE_SKILL_ID_PREFIX}${sanitizedBotId}-${folderSlug}`;
}

export function listBotWorkspaceSkills(bot: Pick<Bot, "id" | "userId">): Skill[] {
  const skillsDir = getBotSkillsDir(bot);

  let entries: Array<string>;
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];

  for (const entry of entries.sort()) {
    if (skills.length >= MAX_BOT_WORKSPACE_SKILLS) break;

    const skillFilePath = join(skillsDir, entry, SKILL_FILE_NAME);
    let fileStats: ReturnType<typeof statSync>;
    try {
      fileStats = statSync(skillFilePath);
    } catch {
      continue;
    }

    if (!fileStats.isFile() || fileStats.size > MAX_SKILL_FILE_BYTES) {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(skillFilePath, "utf8");
    } catch {
      continue;
    }

    const metadata = parseSkillContentMetadata(content);
    const timestamp = fileStats.mtime.toISOString();

    skills.push({
      id: buildBotWorkspaceSkillId(bot.id, entry),
      name: metadata.name?.trim() || entry,
      description: deriveDescription(content),
      content,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  return skills;
}

export function mergeSkillsWithWorkspace(globalSkills: Skill[], workspaceSkills: Skill[]): Skill[] {
  if (!workspaceSkills.length) return globalSkills;

  const workspaceNames = new Set(
    workspaceSkills.map((skill) => getSkillResolvedName(skill).toLowerCase())
  );

  return [
    ...globalSkills.filter(
      (skill) => !workspaceNames.has(getSkillResolvedName(skill).toLowerCase())
    ),
    ...workspaceSkills
  ];
}
