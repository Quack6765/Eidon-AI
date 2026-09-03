import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBotWorkspaceDir } from "@/lib/bot-sandbox";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { getSkillResolvedName } from "@/lib/skill-runtime";
import { deriveDescription } from "@/lib/skills";
import type { Bot, Skill } from "@/lib/types";

export const BOT_WORKSPACE_SKILL_ID_PREFIX = "botws-";

const MAX_BOT_WORKSPACE_SKILLS = 50;
export const MAX_SKILL_FILE_BYTES = 200 * 1024;
const SKILL_FILE_NAME = "SKILL.md";
const MAX_SKILL_NAME_CHARS = 100;
const FOLDER_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

export type BotWorkspaceSkillInput = {
  name: string;
  description: string;
  instructions: string;
};

export type BotWorkspaceSkillSaveResult = { skill: Skill } | { error: string };

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

export function parseBotWorkspaceSkillId(bot: Pick<Bot, "id">, skillId: string) {
  const sanitizedBotId = bot.id.replace(/[^a-zA-Z0-9_-]+/g, "-") || "bot";
  const prefix = `${BOT_WORKSPACE_SKILL_ID_PREFIX}${sanitizedBotId}-`;
  if (!skillId.startsWith(prefix)) {
    return null;
  }
  const folderSlug = skillId.slice(prefix.length);
  return FOLDER_SLUG_PATTERN.test(folderSlug) ? folderSlug : null;
}

export function buildSkillMarkdown(name: string, description: string, instructions: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}\n`;
}

function normalizeSingleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function saveBotWorkspaceSkill(
  bot: Pick<Bot, "id" | "userId">,
  input: BotWorkspaceSkillInput,
  previousSkillId?: string
): BotWorkspaceSkillSaveResult {
  const name = normalizeSingleLine(input.name);
  const description = normalizeSingleLine(input.description);
  const instructions = input.instructions.trim();

  if (!name) {
    return { error: "A skill name is required." };
  }
  if (name.length > MAX_SKILL_NAME_CHARS) {
    return { error: `Skill names must be ${MAX_SKILL_NAME_CHARS} characters or fewer.` };
  }
  if (!description) {
    return { error: "A skill description is required." };
  }
  if (!instructions) {
    return { error: "Skill instructions are required." };
  }

  const slug = slugifySkillFolderName(name);
  if (!slug) {
    return { error: "Cannot derive a valid skill folder name from this name. Use letters, digits, or hyphens." };
  }

  const content = buildSkillMarkdown(name, description, instructions);
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_FILE_BYTES) {
    return { error: "Skill instructions are too large. Keep the skill under 200 KB." };
  }

  const skillsDir = getBotSkillsDir(bot);
  const previousFolderSlug = previousSkillId ? parseBotWorkspaceSkillId(bot, previousSkillId) : null;
  const skillDir = join(skillsDir, slug);
  const skillFilePath = join(skillDir, SKILL_FILE_NAME);

  if (previousFolderSlug !== slug && existsSync(skillFilePath)) {
    return { error: "A skill with this name already exists." };
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillFilePath, content, "utf8");

  if (previousFolderSlug && previousFolderSlug !== slug) {
    rmSync(join(skillsDir, previousFolderSlug), { recursive: true, force: true });
  }

  const timestamp = statSync(skillFilePath).mtime.toISOString();
  return {
    skill: {
      id: buildBotWorkspaceSkillId(bot.id, slug),
      name,
      description,
      content,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };
}

export function deleteBotWorkspaceSkill(bot: Pick<Bot, "id" | "userId">, skillId: string) {
  const folderSlug = parseBotWorkspaceSkillId(bot, skillId);
  if (!folderSlug) {
    return false;
  }

  const skillDir = join(getBotSkillsDir(bot), folderSlug);
  const existed = existsSync(join(skillDir, SKILL_FILE_NAME));
  rmSync(skillDir, { recursive: true, force: true });
  return existed;
}

function readSkillFolder(skillsDir: string, botId: string, folderSlug: string): Skill | null {
  const skillFilePath = join(skillsDir, folderSlug, SKILL_FILE_NAME);
  let fileStats: ReturnType<typeof statSync>;
  try {
    fileStats = statSync(skillFilePath);
  } catch {
    return null;
  }

  if (!fileStats.isFile() || fileStats.size > MAX_SKILL_FILE_BYTES) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(skillFilePath, "utf8");
  } catch {
    return null;
  }

  const metadata = parseSkillContentMetadata(content);
  const timestamp = fileStats.mtime.toISOString();

  return {
    id: buildBotWorkspaceSkillId(botId, folderSlug),
    name: metadata.name?.trim() || folderSlug,
    description: deriveDescription(content),
    content,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function getBotWorkspaceSkill(bot: Pick<Bot, "id" | "userId">, skillId: string) {
  const folderSlug = parseBotWorkspaceSkillId(bot, skillId);
  if (!folderSlug) {
    return null;
  }
  return readSkillFolder(getBotSkillsDir(bot), bot.id, folderSlug);
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

    const skill = readSkillFolder(skillsDir, bot.id, entry);
    if (skill) {
      skills.push(skill);
    }
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
