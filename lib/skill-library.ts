import {
  appendFileSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";

import { getBotTeamWorkspacesDir } from "@/lib/bot-sandbox";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import {
  getArchiveDir,
  getCuratorBackupsDir,
  getLedgerFilePath,
  getLocksDir,
  getMigrationMarkerPath,
  getSkillLibraryDir,
  SKILL_STATE_ENTRIES
} from "@/lib/skill-paths";
import {
  bumpPatch,
  CREATED_BY_INSTALLED,
  getUsageRecord,
  markArchived,
  markRestored,
  recordCreated,
  recordInstalled,
  forgetUsage,
  toSkillProvenance,
  toSkillUsage
} from "@/lib/skill-usage";
import { deriveDescription, listEnabledSkills } from "@/lib/skills";
import { getSkillState } from "@/lib/skill-runtime";
import { nowIso } from "@/lib/utils";
import type { Bot, Skill } from "@/lib/types";

export const SKILL_FILE_NAME = "SKILL.md";
export const SKILL_ID_PREFIX = "teamskill-";

export const MAX_NAME_LENGTH = 64;
export const MAX_DESCRIPTION_LENGTH = 1024;
export const MAX_SKILL_CONTENT_CHARS = 100_000;
export const MAX_SKILL_FILE_BYTES = 1_048_576;
export const SKILL_PROMPT_DESC_LIMIT = 60;

export const VALID_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const NAME_RULE = "Use lowercase letters, numbers, hyphens, dots, and underscores.";
export const ALLOWED_SUBDIRS = ["references", "templates", "scripts", "assets"] as const;

export const MAX_FILE_COUNT = 50;
export const MAX_TOTAL_SIZE_KB = 5120;
export const MAX_SINGLE_FILE_KB = 256;
export const MAX_REFERENCE_FILES = 60;
export const BODY_SOFT_BUDGET_CHARS = 24_000;

const DISCOVERY_MAX_DEPTH = 4;
const LOCK_STALE_MS = 30_000;

export const ESSENTIAL_SKILLS = new Set(["agent-browser"]);

export function isEssentialSkillName(name: string) {
  return ESSENTIAL_SKILLS.has(name.trim().toLowerCase());
}

export {
  getArchiveDir,
  getCuratorBackupsDir,
  getLedgerFilePath,
  getLocksDir,
  getSkillLibraryDir,
  getUsageFilePath
} from "@/lib/skill-paths";

export type SkillOwner = Pick<Bot, "userId">;

export function ownerUserIdOf(owner: SkillOwner | null) {
  return owner?.userId ?? null;
}

export function buildSkillId(skillRef: string) {
  return `${SKILL_ID_PREFIX}${skillRef.replace(/[^a-zA-Z0-9._/-]+/g, "-")}`;
}

export function parseSkillId(skillId: string) {
  if (!skillId.startsWith(SKILL_ID_PREFIX)) {
    return null;
  }
  return normalizeSkillRef(skillId.slice(SKILL_ID_PREFIX.length));
}

export function isLibrarySkillId(skillId: string) {
  return skillId.startsWith(SKILL_ID_PREFIX);
}

export function normalizeSkillRef(reference: string) {
  const normalized = reference
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!normalized || normalized.includes("..") || normalized.includes("//")) {
    return null;
  }

  const segments = normalized.split("/");
  if (segments.length > 2) {
    return null;
  }

  for (const segment of segments) {
    if (!VALID_NAME_RE.test(segment)) {
      return null;
    }
  }

  return segments.join("/");
}

export function skillRefLeaf(skillRef: string) {
  return skillRef.split("/").at(-1) ?? skillRef;
}

export function normalizeSkillDisplayName(name: string): string | null {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH);

  return slug && VALID_NAME_RE.test(slug) ? slug : null;
}

export function skillRefCategory(skillRef: string) {
  const segments = skillRef.split("/");
  return segments.length > 1 ? segments.slice(0, -1).join("/") : null;
}

export function skillDirPath(ownerUserId: string | null, skillRef: string) {
  return join(getSkillLibraryDir(ownerUserId), ...skillRef.split("/"));
}

export function buildSkillMarkdown(name: string, description: string, instructions: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions.trim()}\n`;
}

export function validateFrontmatterName(name: string): { name: string } | { error: string } {
  const trimmed = name.trim();

  if (!trimmed) {
    return { error: "Frontmatter must include 'name' field." };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { error: `name exceeds ${MAX_NAME_LENGTH} characters.` };
  }

  return { name: trimmed };
}

export function validateSkillName(name: string): { name: string } | { error: string } {
  const trimmed = name.trim();

  if (!trimmed) {
    return { error: "A skill name is required." };
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { error: `name exceeds ${MAX_NAME_LENGTH} characters. ${NAME_RULE}` };
  }
  if (!VALID_NAME_RE.test(trimmed)) {
    return { error: `name '${trimmed}' must be lowercase letters, digits, hyphens, and underscores only. ${NAME_RULE}` };
  }

  return { name: trimmed };
}

export function validateDescription(description: string): { description: string } | { error: string } {
  const trimmed = description.trim();
  if (!trimmed) {
    return { error: "Frontmatter must include 'description' field." };
  }
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return { error: `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.` };
  }
  return { description: trimmed };
}

export function validateSkillContent(
  content: string,
  label = "SKILL.md"
): { name: string; description: string } | { error: string } {
  if (content.length > MAX_SKILL_CONTENT_CHARS) {
    return {
      error: `${label} content is ${content.length} characters (limit: ${MAX_SKILL_CONTENT_CHARS.toLocaleString("en-US")}). Consider splitting into a skill with supporting files.`
    };
  }

  const metadata = parseSkillContentMetadata(content);
  const name = validateFrontmatterName(metadata.name ?? "");
  if ("error" in name) {
    return name;
  }
  const description = validateDescription(metadata.description ?? "");
  if ("error" in description) {
    return description;
  }

  return { name: name.name, description: description.description };
}

export function validateSupportingFilePath(filePath: string): { filePath: string } | { error: string } {
  const normalized = filePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");

  if (!normalized) {
    return { error: "file_path is required." };
  }
  if (normalized.includes("..")) {
    return { error: "Path traversal ('..') is not allowed." };
  }
  if (normalized === SKILL_FILE_NAME || normalized === `${SKILL_FILE_NAME.toLowerCase()}`) {
    return { error: "Use action='patch' to change SKILL.md; file_path must be a supporting file." };
  }

  const [first, ...rest] = normalized.split("/");
  if (!(ALLOWED_SUBDIRS as readonly string[]).includes(first) || !rest.length) {
    return {
      error: `file_path must start with one of ${ALLOWED_SUBDIRS.map((entry) => `${entry}/`).join(", ")} — e.g. 'references/api.md'.`
    };
  }

  return { filePath: normalized };
}

export function validateSupportingFileContent(content: string): { error: string } | null {
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_FILE_BYTES) {
    return {
      error: `File content is ${Buffer.byteLength(content, "utf8")} bytes (limit: ${MAX_SKILL_FILE_BYTES.toLocaleString("en-US")} bytes / 1 MiB). Consider splitting into smaller files.`
    };
  }
  return null;
}

type SkillManifestEntry = { path: string; bytes: number };

function fileManifest(dir: string, prefix = ""): SkillManifestEntry[] {
  if (!existsSync(dir)) {
    return [];
  }

  const entries: SkillManifestEntry[] = [];
  const walk = (current: string, rel: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = rel ? posix.join(rel, entry.name) : entry.name;
      const childPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(childPath, childRel);
      } else if (entry.isFile()) {
        entries.push({ path: childRel, bytes: statSync(childPath).size });
      }
    }
  };

  walk(dir, prefix);
  return entries;
}

export function withSkillLock<T>(ownerUserId: string | null, skillRef: string, run: () => T): T {
  const locksDir = getLocksDir(ownerUserId);
  mkdirSync(locksDir, { recursive: true });
  const lockPath = join(locksDir, `${createHash("sha256").update(skillRef).digest("hex")}.lock`);

  const tryAcquire = () => {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(lockPath, String(Date.now()), "utf8");
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  };

  if (!tryAcquire()) {
    let stale = false;
    try {
      stale = Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
    } catch {
      stale = true;
    }
    if (stale) {
      try {
        unlinkSync(lockPath);
      } catch {
        // already released
      }
    }
    if (!tryAcquire()) {
      throw new Error(`Skill "${skillRef}" is being modified by another operation. Retry shortly.`);
    }
  }

  try {
    return run();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // already released
    }
  }
}

export type SkillMutationActor = "foreground" | "background-review" | "curator" | "user";

export function recordLedgerEntry(
  ownerUserId: string | null,
  entry: {
    actor: SkillMutationActor;
    action: string;
    skill: string;
    evidence?: string;
    before: SkillManifestEntry[];
    after: SkillManifestEntry[];
  }
) {
  const ledgerFile = getLedgerFilePath(ownerUserId);
  mkdirSync(getSkillLibraryDir(ownerUserId), { recursive: true });
  appendFileSync(
    ledgerFile,
    `${JSON.stringify({
      id: createHash("sha1").update(`${nowIso()}-${entry.skill}-${entry.action}-${Math.random()}`).digest("hex").slice(0, 12),
      ts: nowIso(),
      ...entry
    })}\n`,
    "utf8"
  );
}

export function readLedger(ownerUserId: string | null): Array<Record<string, unknown>> {
  const ledgerFile = getLedgerFilePath(ownerUserId);
  if (!existsSync(ledgerFile)) {
    return [];
  }

  return readFileSync(ledgerFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function readSkillAtDir(ownerUserId: string | null, skillRef: string, dir: string): Skill | null {
  const skillFilePath = join(dir, SKILL_FILE_NAME);
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
  const usage = getUsageRecord(ownerUserId, skillRef);
  const timestamp = fileStats.mtime.toISOString();

  return {
    id: buildSkillId(skillRef),
    name: metadata.name?.trim() || skillRefLeaf(skillRef),
    description: metadata.description?.trim() || deriveDescription(content),
    content,
    enabled: true,
    createdAt: usage?.created_at || timestamp,
    updatedAt: timestamp,
    state: usage?.state ?? "active",
    pinned: usage?.pinned ?? false,
    createdBy: toSkillProvenance(usage),
    usage: toSkillUsage(usage)
  };
}

export function readLibrarySkill(ownerUserId: string | null, skillRef: string) {
  return readSkillAtDir(ownerUserId, skillRef, skillDirPath(ownerUserId, skillRef));
}

function walkSkillFiles(root: string, depth: number, prefix: string, found: string[]) {
  if (depth > DISCOVERY_MAX_DEPTH) {
    return;
  }

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (SKILL_STATE_ENTRIES.includes(entry.name)) {
      continue;
    }

    const childRel = prefix ? posix.join(prefix, entry.name) : entry.name;
    const childPath = join(root, entry.name);

    if (entry.isDirectory()) {
      if (existsSync(join(childPath, SKILL_FILE_NAME))) {
        found.push(childRel);
        continue;
      }
      walkSkillFiles(childPath, depth + 1, childRel, found);
    }
  }
}

export function discoverLibrarySkillRefs(ownerUserId: string | null) {
  const found: string[] = [];
  walkSkillFiles(getSkillLibraryDir(ownerUserId), 0, "", found);
  return found.sort();
}

export function listLibrarySkills(ownerUserId: string | null, options: { includeArchived?: boolean } = {}) {
  const skills: Skill[] = [];

  for (const skillRef of discoverLibrarySkillRefs(ownerUserId)) {
    const skill = readLibrarySkill(ownerUserId, skillRef);
    if (!skill) {
      continue;
    }
    if (!options.includeArchived && getSkillState(skill) === "archived") {
      continue;
    }
    skills.push(skill);
  }

  if (options.includeArchived) {
    for (const archivedName of listArchivedSkills(ownerUserId)) {
      const skill = readSkillAtDir(ownerUserId, archivedName, join(getArchiveDir(ownerUserId), archivedName));
      if (skill) {
        skills.push({ ...skill, state: "archived" });
      }
    }
  }

  return skills;
}

export function findLibrarySkill(ownerUserId: string | null, reference: string) {
  const trimmed = reference.trim();
  const asRef = normalizeSkillRef(trimmed);
  if (asRef) {
    const direct = readLibrarySkill(ownerUserId, asRef);
    if (direct) {
      return { skill: direct, ref: asRef };
    }
  }

  const target = trimmed.toLowerCase();
  for (const skillRef of discoverLibrarySkillRefs(ownerUserId)) {
    const skill = readLibrarySkill(ownerUserId, skillRef);
    if (!skill) {
      continue;
    }
    if (
      skillRef.toLowerCase() === target ||
      skillRefLeaf(skillRef).toLowerCase() === target ||
      skill.name.toLowerCase() === target
    ) {
      return { skill, ref: skillRef };
    }
  }

  return null;
}

export function resolveLibrarySkill(ownerUserId: string | null, idOrRef: string) {
  const ref = parseSkillId(idOrRef) ?? idOrRef;
  return findLibrarySkill(ownerUserId, ref);
}

export function descriptionBudgetWarning(description: string) {
  if (description.length <= SKILL_PROMPT_DESC_LIMIT) {
    return null;
  }
  return `Description is ${description.length} chars — new skills must fit the ${SKILL_PROMPT_DESC_LIMIT}-char system-prompt budget. Cut it down before saving.`;
}

export type SkillWriteResult = { skill: Skill; ref: string; warning?: string } | { error: string };

export function createLibrarySkill(
  ownerUserId: string | null,
  input: { name: string; category?: string | null; content: string; actor?: SkillMutationActor; agentAuthored?: boolean }
): SkillWriteResult {
  const nameResult = validateSkillName(input.name);
  if ("error" in nameResult) {
    return nameResult;
  }

  const contentResult = validateSkillContent(input.content);
  if ("error" in contentResult) {
    return contentResult;
  }

  const category = input.category?.trim() ? normalizeSkillRef(input.category.trim()) : null;
  if (input.category?.trim() && !category) {
    return { error: `category '${input.category}' is invalid. ${NAME_RULE}` };
  }
  const skillRef = category ? `${category}/${nameResult.name}` : nameResult.name;

  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    const skillFilePath = join(dir, SKILL_FILE_NAME);

    if (existsSync(skillFilePath)) {
      return { error: `A skill named '${nameResult.name}' already exists at ${skillRef}.` };
    }

    const before = fileManifest(getSkillLibraryDir(ownerUserId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(skillFilePath, input.content, "utf8");
    recordCreated(ownerUserId, skillRef, { agentCreated: input.agentAuthored === true });

    recordLedgerEntry(ownerUserId, {
      actor: input.actor ?? "foreground",
      action: "create",
      skill: skillRef,
      before,
      after: fileManifest(getSkillLibraryDir(ownerUserId))
    });

    const skill = readLibrarySkill(ownerUserId, skillRef);
    if (!skill) {
      return { error: `Failed to read back skill '${nameResult.name}'.` };
    }

    const warning = descriptionBudgetWarning(contentResult.description) ?? undefined;
    return warning ? { skill, ref: skillRef, warning } : { skill, ref: skillRef };
  });
}

export function rewriteLibrarySkill(
  ownerUserId: string | null,
  skillRef: string,
  input: { content: string; actor?: SkillMutationActor }
): SkillWriteResult {
  const contentResult = validateSkillContent(input.content);
  if ("error" in contentResult) {
    return contentResult;
  }

  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    const skillFilePath = join(dir, SKILL_FILE_NAME);
    if (!existsSync(skillFilePath)) {
      return { error: `Skill '${skillRef}' not found in the shared skills library.` };
    }

    const before = fileManifest(dir);
    writeFileSync(skillFilePath, input.content, "utf8");
    bumpPatch(ownerUserId, skillRef);

    recordLedgerEntry(ownerUserId, {
      actor: input.actor ?? "foreground",
      action: "patch",
      skill: skillRef,
      before,
      after: fileManifest(dir)
    });

    const skill = readLibrarySkill(ownerUserId, skillRef);
    return skill ? { skill, ref: skillRef } : { error: `Failed to read back skill '${skillRef}'.` };
  });
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function matchPatchTarget(content: string, oldString: string) {
  const occurrences = content.split(oldString).length - 1;
  if (occurrences > 0) {
    return { needle: oldString, occurrences, source: content };
  }

  const normalizedContent = normalizeLineEndings(content);
  const normalizedNeedle = normalizeLineEndings(oldString);
  const normalizedOccurrences = normalizedContent.split(normalizedNeedle).length - 1;
  if (normalizedOccurrences > 0) {
    return { needle: normalizedNeedle, occurrences: normalizedOccurrences, source: normalizedContent };
  }

  return null;
}

export type SkillPatchResult = { replacements: number; ref: string; filePath: string } | { error: string };

export function patchLibrarySkillFile(
  ownerUserId: string | null,
  skillRef: string,
  input: {
    oldString: string;
    newString: string;
    replaceAll?: boolean;
    filePath?: string | null;
    actor?: SkillMutationActor;
  }
): SkillPatchResult {
  if (!input.oldString) {
    return { error: "old_string is required." };
  }
  if (typeof input.newString !== "string") {
    return { error: "new_string is required." };
  }

  let targetRel = SKILL_FILE_NAME;
  if (input.filePath?.trim()) {
    const validated = validateSupportingFilePath(input.filePath);
    if ("error" in validated) {
      return validated;
    }
    targetRel = validated.filePath;
    const contentCheck = validateSupportingFileContent(input.newString);
    if (contentCheck) {
      return contentCheck;
    }
  }

  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    const targetPath = targetRel === SKILL_FILE_NAME ? join(dir, SKILL_FILE_NAME) : join(dir, ...targetRel.split("/"));

    if (!existsSync(join(dir, SKILL_FILE_NAME))) {
      return { error: `Skill '${skillRef}' not found in the shared skills library.` };
    }
    if (!existsSync(targetPath)) {
      return { error: `File not found: ${targetRel}` };
    }

    const before = fileManifest(dir);
    const content = readFileSync(targetPath, "utf8");
    const match = matchPatchTarget(content, input.oldString);

    if (!match) {
      const preview = content.slice(0, 400);
      return {
        error: `old_string not found in ${targetRel}. It must appear verbatim. File preview:\n${preview}`
      };
    }

    const useCount = input.replaceAll ? match.occurrences : 1;
    const next = input.replaceAll
      ? match.source.split(match.needle).join(input.newString)
      : match.source.replace(match.needle, input.newString);

    writeFileSync(targetPath, next, "utf8");
    bumpPatch(ownerUserId, skillRef);

    recordLedgerEntry(ownerUserId, {
      actor: input.actor ?? "foreground",
      action: "patch",
      skill: skillRef,
      evidence: targetRel,
      before,
      after: fileManifest(dir)
    });

    return { replacements: useCount, ref: skillRef, filePath: targetRel };
  });
}

export type SkillSupportFileResult = { ref: string; filePath: string } | { error: string };

export function writeLibrarySupportFile(
  ownerUserId: string | null,
  skillRef: string,
  input: { filePath: string; fileContent: string; actor?: SkillMutationActor }
): SkillSupportFileResult {
  const validated = validateSupportingFilePath(input.filePath);
  if ("error" in validated) {
    return validated;
  }
  const contentCheck = validateSupportingFileContent(input.fileContent);
  if (contentCheck) {
    return contentCheck;
  }

  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    if (!existsSync(join(dir, SKILL_FILE_NAME))) {
      return { error: `Skill '${skillRef}' not found in the shared skills library. Create it first with action='create'.` };
    }

    const before = fileManifest(dir);
    const targetPath = join(dir, ...validated.filePath.split("/"));
    mkdirSync(join(targetPath, ".."), { recursive: true });
    writeFileSync(targetPath, input.fileContent, "utf8");
    bumpPatch(ownerUserId, skillRef);

    recordLedgerEntry(ownerUserId, {
      actor: input.actor ?? "foreground",
      action: "write_file",
      skill: skillRef,
      evidence: validated.filePath,
      before,
      after: fileManifest(dir)
    });

    return { ref: skillRef, filePath: validated.filePath };
  });
}

export function removeLibrarySupportFile(
  ownerUserId: string | null,
  skillRef: string,
  input: { filePath: string; actor?: SkillMutationActor }
): SkillSupportFileResult {
  const validated = validateSupportingFilePath(input.filePath);
  if ("error" in validated) {
    return validated;
  }

  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    const targetPath = join(dir, ...validated.filePath.split("/"));

    if (!existsSync(targetPath)) {
      return { error: `File '${validated.filePath}' not found in skill '${skillRef}'.` };
    }

    const before = fileManifest(dir);
    unlinkSync(targetPath);
    bumpPatch(ownerUserId, skillRef);

    recordLedgerEntry(ownerUserId, {
      actor: input.actor ?? "foreground",
      action: "remove_file",
      skill: skillRef,
      evidence: validated.filePath,
      before,
      after: fileManifest(dir)
    });

    return { ref: skillRef, filePath: validated.filePath };
  });
}

export function hardDeleteLibrarySkill(
  ownerUserId: string | null,
  skillRef: string,
  actor: SkillMutationActor = "foreground"
): { ref: string } | { error: string } {
  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    if (!existsSync(join(dir, SKILL_FILE_NAME))) {
      return { error: `Skill '${skillRef}' not found in the shared skills library.` };
    }

    const before = fileManifest(dir);
    rmSync(dir, { recursive: true, force: true });
    forgetUsage(ownerUserId, skillRef);

    recordLedgerEntry(ownerUserId, {
      actor,
      action: "delete",
      skill: skillRef,
      before,
      after: []
    });

    return { ref: skillRef };
  });
}

export function archiveLibrarySkill(
  ownerUserId: string | null,
  skillRef: string
): { ref: string; archivedPath: string } | { error: string } {
  return withSkillLock(ownerUserId, skillRef, () => {
    const dir = skillDirPath(ownerUserId, skillRef);
    if (!existsSync(join(dir, SKILL_FILE_NAME))) {
      return { error: `Skill '${skillRef}' not found in the shared skills library.` };
    }

    const archiveRoot = getArchiveDir(ownerUserId);
    mkdirSync(archiveRoot, { recursive: true });
    const leaf = skillRef.replace(/\//g, "-");
    let target = join(archiveRoot, leaf);
    if (existsSync(target)) {
      target = join(archiveRoot, `${leaf}-${Date.now()}`);
    }

    const before = fileManifest(dir);
    renameSync(dir, target);
    markArchived(ownerUserId, skillRef);

    recordLedgerEntry(ownerUserId, {
      actor: "curator",
      action: "archive",
      skill: skillRef,
      before,
      after: []
    });

    return { ref: skillRef, archivedPath: target };
  });
}

export function restoreLibrarySkill(
  ownerUserId: string | null,
  archivedName: string
): { ref: string } | { error: string } {
  const archiveRoot = getArchiveDir(ownerUserId);
  const source = join(archiveRoot, archivedName);
  if (!existsSync(join(source, SKILL_FILE_NAME))) {
    return { error: `No archived skill named '${archivedName}'.` };
  }

  const leaf = archivedName.replace(/-\d+$/, "");
  const ref = normalizeSkillRef(leaf);
  if (!ref) {
    return { error: `Cannot derive a skill name from archive '${archivedName}'.` };
  }

  return withSkillLock(ownerUserId, ref, () => {
    const dir = skillDirPath(ownerUserId, ref);
    if (existsSync(join(dir, SKILL_FILE_NAME))) {
      return { error: `A skill named '${skillRefLeaf(ref)}' already exists at ${ref}.` };
    }

    mkdirSync(dir, { recursive: true });
    cpSync(source, dir, { recursive: true });
    rmSync(source, { recursive: true, force: true });
    markRestored(ownerUserId, ref);

    recordLedgerEntry(ownerUserId, {
      actor: "curator",
      action: "restore",
      skill: ref,
      before: [],
      after: fileManifest(dir)
    });

    return { ref };
  });
}

export function listArchivedSkills(ownerUserId: string | null) {
  const archiveRoot = getArchiveDir(ownerUserId);
  try {
    return readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(archiveRoot, entry.name, SKILL_FILE_NAME)))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function resolveArchivedName(ownerUserId: string | null, refOrName: string) {
  const archived = listArchivedSkills(ownerUserId);
  const target = refOrName.trim().toLowerCase();

  if (archived.includes(refOrName.trim())) {
    return refOrName.trim();
  }

  for (const name of archived) {
    const skill = readSkillAtDir(ownerUserId, name, join(getArchiveDir(ownerUserId), name));
    if (
      name.toLowerCase() === target ||
      skillRefLeaf(name).toLowerCase() === target ||
      (skill && skill.name.toLowerCase() === target)
    ) {
      return name;
    }
  }

  return null;
}

export function snapshotLibrary(ownerUserId: string | null, reason: string) {
  const backupsDir = getCuratorBackupsDir(ownerUserId);
  mkdirSync(backupsDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, "-");
  const target = join(backupsDir, `${stamp}-${reason}`);
  mkdirSync(target, { recursive: true });

  for (const skillRef of discoverLibrarySkillRefs(ownerUserId)) {
    const dir = skillDirPath(ownerUserId, skillRef);
    cpSync(dir, join(target, skillRef.replace(/\//g, "-")), { recursive: true });
  }

  return target;
}

export function listSnapshots(ownerUserId: string | null) {
  const backupsDir = getCuratorBackupsDir(ownerUserId);
  try {
    return readdirSync(backupsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function restoreLibrarySnapshot(
  ownerUserId: string | null,
  snapshotName: string
): { restored: string[] } | { error: string } {
  const backupsDir = getCuratorBackupsDir(ownerUserId);
  const source = join(backupsDir, snapshotName);
  if (!existsSync(source) || !snapshotName) {
    return { error: `No snapshot named '${snapshotName}'.` };
  }

  const restored: string[] = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const normalized = normalizeSkillRef(entry.name);
    if (!normalized) {
      continue;
    }
    const target = skillDirPath(ownerUserId, normalized);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    cpSync(join(source, entry.name), target, { recursive: true });
    restored.push(normalized);
  }

  recordLedgerEntry(ownerUserId, {
    actor: "curator",
    action: "rollback",
    skill: snapshotName,
    before: [],
    after: fileManifest(getSkillLibraryDir(ownerUserId))
  });

  return { restored };
}

export function pruneSnapshots(ownerUserId: string | null, keep: number) {
  const snapshots = listSnapshots(ownerUserId);
  const excess = snapshots.slice(0, Math.max(0, snapshots.length - keep));
  const backupsDir = getCuratorBackupsDir(ownerUserId);
  for (const name of excess) {
    rmSync(join(backupsDir, name), { recursive: true, force: true });
  }
  return excess;
}

export function migrateLegacyBotSkillFolders(ownerUserId: string | null) {
  const libraryDir = getSkillLibraryDir(ownerUserId);
  mkdirSync(libraryDir, { recursive: true });
  const marker = getMigrationMarkerPath(ownerUserId);
  if (existsSync(marker)) {
    return { migrated: [], skipped: [] as string[] };
  }

  const teamDir = getBotTeamWorkspacesDir({ userId: ownerUserId });
  const migrated: string[] = [];
  const skipped: string[] = [];

  let botDirs: string[] = [];
  try {
    botDirs = readdirSync(teamDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "shared" && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    botDirs = [];
  }

  for (const botDir of botDirs.sort()) {
    const legacySkillsDir = join(teamDir, botDir, "skills");
    let slugs: string[] = [];
    try {
      slugs = readdirSync(legacySkillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const slug of slugs.sort()) {
      const source = join(legacySkillsDir, slug);
      const skillFile = join(source, SKILL_FILE_NAME);
      if (!existsSync(skillFile)) {
        continue;
      }

      const content = readFileSync(skillFile, "utf8");
      const normalized = normalizeSkillRef(slug);
      if (!normalized) {
        skipped.push(`${botDir}/${slug}`);
        continue;
      }

      let targetRef = normalized;
      let targetDir = skillDirPath(ownerUserId, targetRef);

      if (existsSync(join(targetDir, SKILL_FILE_NAME))) {
        const existing = readFileSync(join(targetDir, SKILL_FILE_NAME), "utf8");
        if (existing === content) {
          rmSync(source, { recursive: true, force: true });
          skipped.push(targetRef);
          continue;
        }

        let suffix = 2;
        while (existsSync(join(skillDirPath(ownerUserId, `${normalized}-${suffix}`), SKILL_FILE_NAME))) {
          suffix += 1;
        }
        targetRef = `${normalized}-${suffix}`;
        targetDir = skillDirPath(ownerUserId, targetRef);
      }

      mkdirSync(targetDir, { recursive: true });
      cpSync(source, targetDir, { recursive: true });
      rmSync(source, { recursive: true, force: true });

      const created = statSync(join(targetDir, SKILL_FILE_NAME)).mtime.toISOString();
      recordCreated(ownerUserId, targetRef, { agentCreated: false, timestamp: created });
      migrated.push(targetRef);
    }
  }

  writeFileSync(marker, `${nowIso()}\n`, "utf8");
  return { migrated, skipped };
}

export function ensureLibraryReady(ownerUserId: string | null) {
  mkdirSync(getSkillLibraryDir(ownerUserId), { recursive: true });
  migrateLegacyBotSkillFolders(ownerUserId);
}

export function mergeSkillsWithLibrary(globalSkills: Skill[], librarySkills: Skill[]): Skill[] {
  if (!librarySkills.length) {
    return globalSkills;
  }

  const libraryNames = new Set(librarySkills.map((skill) => skill.name.toLowerCase()));

  return [
    ...globalSkills.filter((skill) => !libraryNames.has(skill.name.toLowerCase())),
    ...librarySkills
  ];
}

export function listConversationSkills(owner: SkillOwner | null) {
  ensureLibraryReady(ownerUserIdOf(owner));
  return mergeSkillsWithLibrary(
    listEnabledSkills().map((skill) => ({ ...skill, createdBy: CREATED_BY_INSTALLED })),
    owner ? listLibrarySkills(ownerUserIdOf(owner)) : []
  );
}

export function listSkillRefs(ownerUserId: string | null) {
  return discoverLibrarySkillRefs(ownerUserId).map((ref) => ({
    ref,
    leaf: skillRefLeaf(ref),
    category: skillRefCategory(ref),
    usage: getUsageRecord(ownerUserId, ref)
  }));
}

export function ownerOfBot(bot: Bot): SkillOwner {
  return { userId: bot.userId };
}
