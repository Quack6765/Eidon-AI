import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveLibrarySkill,
  buildSkillId,
  buildSkillMarkdown,
  createLibrarySkill,
  discoverLibrarySkillRefs,
  ensureLibraryReady,
  findLibrarySkill,
  getSkillLibraryDir,
  hardDeleteLibrarySkill,
  listArchivedSkills,
  listLibrarySkills,
  migrateLegacyBotSkillFolders,
  normalizeSkillRef,
  parseSkillId,
  patchLibrarySkillFile,
  readLedger,
  removeLibrarySupportFile,
  restoreLibrarySkill,
  rewriteLibrarySkill,
  skillDirPath,
  validateSkillName,
  writeLibrarySupportFile
} from "@/lib/skill-library";
import { lintSkillDir } from "@/lib/skill-lint";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_SKILL_CONTENT_CHARS,
  MAX_SKILL_FILE_BYTES,
  MAX_NAME_LENGTH,
  SKILL_PROMPT_DESC_LIMIT,
  descriptionBudgetWarning
} from "@/lib/skill-library";
import { getBotTeamWorkspacesDir } from "@/lib/bot-sandbox";

const owner = "user_lib_a";

function writeSkill(ref: string, content: string) {
  const dir = skillDirPath(owner, ref);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content, "utf8");
}

function skill(name: string, body = "Do the thing.") {
  return buildSkillMarkdown(name, "When to trigger.", body);
}

describe("skill-library", () => {
  beforeEach(() => {
    ensureLibraryReady(owner);
  });

  describe("name and reference validation", () => {
    it("accepts Hermes VALID_NAME_RE names and rejects everything else", () => {
      expect(validateSkillName("release-notes")).toEqual({ name: "release-notes" });
      expect(validateSkillName("a.b_c-1")).toEqual({ name: "a.b_c-1" });
      expect(validateSkillName("")).toHaveProperty("error");
      expect(validateSkillName("Release Notes")).toHaveProperty("error");
      expect(validateSkillName("-leading")).toHaveProperty("error");
      expect(validateSkillName("x".repeat(MAX_NAME_LENGTH + 1))).toHaveProperty("error");
    });

    it("normalizes references to at most category/name", () => {
      expect(normalizeSkillRef("devops/deploy")).toBe("devops/deploy");
      expect(normalizeSkillRef("/devops/deploy/")).toBe("devops/deploy");
      expect(normalizeSkillRef("a/b/c")).toBeNull();
      expect(normalizeSkillRef("../etc/passwd")).toBeNull();
      expect(normalizeSkillRef("Bad Name")).toBeNull();
    });

    it("round-trips skill ids through the relative path", () => {
      expect(parseSkillId(buildSkillId("devops/deploy"))).toBe("devops/deploy");
      expect(parseSkillId("skill-123")).toBeNull();
    });
  });

  describe("limits at their exact thresholds", () => {
    it("enforces MAX_NAME_LENGTH and MAX_DESCRIPTION_LENGTH", () => {
      expect(validateSkillName("n".repeat(MAX_NAME_LENGTH))).toEqual({ name: "n".repeat(MAX_NAME_LENGTH) });
      const content = buildSkillMarkdown("ok-name", "d".repeat(MAX_DESCRIPTION_LENGTH + 1), "body");
      expect(createLibrarySkill(owner, { name: "ok-name", content })).toEqual({
        error: `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`
      });
    });

    it("enforces MAX_SKILL_CONTENT_CHARS with the Hermes wording", () => {
      const content = `---\nname: big\ndescription: d\n---\n\n${"x".repeat(MAX_SKILL_CONTENT_CHARS)}`;
      const result = createLibrarySkill(owner, { name: "big", content });
      expect(result).toEqual({
        error: expect.stringContaining(`content is ${content.length} characters (limit: 100,000)`)
      });
    });

    it("enforces MAX_SKILL_FILE_BYTES on supporting files", () => {
      writeSkill("holder", skill("holder"));
      const result = writeLibrarySupportFile(owner, "holder", {
        filePath: "references/big.md",
        fileContent: "x".repeat(MAX_SKILL_FILE_BYTES + 1)
      });
      expect(result).toEqual({ error: expect.stringContaining("(limit: 1,048,576 bytes / 1 MiB)") });
    });

    it("raises the description budget warning only past the prompt limit", () => {
      expect(descriptionBudgetWarning("d".repeat(SKILL_PROMPT_DESC_LIMIT))).toBeNull();
      expect(descriptionBudgetWarning("d".repeat(SKILL_PROMPT_DESC_LIMIT + 1))).toContain(
        `${SKILL_PROMPT_DESC_LIMIT}-char system-prompt budget`
      );
    });
  });

  describe("create and collision", () => {
    it("creates a skill and refuses to overwrite an existing one", () => {
      const created = createLibrarySkill(owner, { name: "deploy", content: skill("deploy") });
      expect(created).toHaveProperty("ref", "deploy");

      const collision = createLibrarySkill(owner, { name: "deploy", content: skill("deploy") });
      expect(collision).toEqual({ error: "A skill named 'deploy' already exists at deploy." });
    });

    it("lets a display name differ from the directory and reports it as a lint finding", () => {
      const created = createLibrarySkill(owner, {
        name: "deploy-x-dir",
        content: buildSkillMarkdown("Deploy X", "When to trigger.", "Body.")
      });
      expect(created).toHaveProperty("ref", "deploy-x-dir");

      const findings = lintSkillDir(skillDirPath(owner, "deploy-x-dir"), "deploy-x-dir");
      expect(findings).toContainEqual(
        expect.objectContaining({ rule: "name-dir-mismatch", severity: "warning" })
      );
    });

    it("supports a category subdirectory", () => {
      const created = createLibrarySkill(owner, {
        name: "deploy",
        category: "devops",
        content: skill("deploy")
      });
      expect(created).toHaveProperty("ref", "devops/deploy");
      expect(existsSync(join(getSkillLibraryDir(owner), "devops", "deploy", "SKILL.md"))).toBe(true);
    });

    it("appends a ledger entry with before and after manifests", () => {
      createLibrarySkill(owner, { name: "audited", content: skill("audited") });
      const ledger = readLedger(owner);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ action: "create", skill: "audited", actor: "foreground" });
      expect(Array.isArray(ledger[0].before)).toBe(true);
      expect(Array.isArray(ledger[0].after)).toBe(true);
    });
  });

  describe("patch, support files and delete", () => {
    beforeEach(() => {
      createLibrarySkill(owner, { name: "patchable", content: skill("patchable", "Alpha line.\nBeta line.") });
    });

    it("patches a substring and reports the replacement count", () => {
      const result = patchLibrarySkillFile(owner, "patchable", {
        oldString: "Alpha line.",
        newString: "Gamma line."
      });
      expect(result).toEqual({ replacements: 1, ref: "patchable", filePath: "SKILL.md" });
      expect(readFileSync(join(skillDirPath(owner, "patchable"), "SKILL.md"), "utf8")).toContain("Gamma line.");
    });

    it("reports a file preview when old_string is missing", () => {
      const result = patchLibrarySkillFile(owner, "patchable", {
        oldString: "nope",
        newString: "x"
      });
      expect(result).toEqual({ error: expect.stringContaining("old_string not found") });
    });

    it("refuses path traversal in supporting file paths", () => {
      const result = writeLibrarySupportFile(owner, "patchable", {
        filePath: "references/../../escape.md",
        fileContent: "x"
      });
      expect(result).toEqual({ error: "Path traversal ('..') is not allowed." });
    });

    it("requires a supporting file path under an allowed subdirectory", () => {
      const result = writeLibrarySupportFile(owner, "patchable", {
        filePath: "notes.md",
        fileContent: "x"
      });
      expect(result).toEqual({ error: expect.stringContaining("must start with one of references/") });
    });

    it("writes and removes a supporting file", () => {
      expect(writeLibrarySupportFile(owner, "patchable", { filePath: "references/api.md", fileContent: "notes" })).toEqual({
        ref: "patchable",
        filePath: "references/api.md"
      });
      expect(removeLibrarySupportFile(owner, "patchable", { filePath: "references/api.md" })).toEqual({
        ref: "patchable",
        filePath: "references/api.md"
      });
      expect(removeLibrarySupportFile(owner, "patchable", { filePath: "references/api.md" })).toEqual({
        error: "File 'references/api.md' not found in skill 'patchable'."
      });
    });

    it("hard deletes and forgets the usage record", () => {
      expect(hardDeleteLibrarySkill(owner, "patchable")).toEqual({ ref: "patchable" });
      expect(findLibrarySkill(owner, "patchable")).toBeNull();
    });
  });

  describe("archive and restore", () => {
    it("archives a skill out of discovery and restores it", () => {
      createLibrarySkill(owner, { name: "oldie", content: skill("oldie") });
      writeFileSync(join(skillDirPath(owner, "oldie"), "SKILL.md"), skill("oldie"), "utf8");

      expect(archiveLibrarySkill(owner, "oldie")).toHaveProperty("ref", "oldie");

      expect(listLibrarySkills(owner).map((s) => s.name)).not.toContain("oldie");
      expect(listArchivedSkills(owner)).toContain("oldie");

      expect(restoreLibrarySkill(owner, "oldie")).toEqual({ ref: "oldie" });
      expect(listLibrarySkills(owner).map((s) => s.name)).toContain("oldie");
      expect(listArchivedSkills(owner)).not.toContain("oldie");
    });
  });

  describe("migration from per-bot skill folders", () => {
    const migratingOwner = "user_lib_migrate";

    function seedLegacy(botId: string, slug: string, content: string) {
      const dir = join(getBotTeamWorkspacesDir({ userId: migratingOwner }), botId, "skills", slug);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), content, "utf8");
    }

    it("moves legacy folders, drops byte-identical duplicates and suffixes name collisions", () => {
      seedLegacy("bot_one", "tone", skill("tone", "From bot one."));
      seedLegacy("bot_two", "tone", skill("tone", "From bot two."));
      seedLegacy("bot_three", "tone", skill("tone", "From bot one."));

      const result = migrateLegacyBotSkillFolders(migratingOwner);
      expect([...new Set(result.migrated)].sort()).toEqual(["tone", "tone-2"].sort());
      expect(result.skipped).toEqual(["tone"]);

      const names = discoverLibrarySkillRefs(migratingOwner);
      expect(names.sort()).toEqual(["tone", "tone-2"].sort());
    });

    it("is idempotent behind the migration marker", () => {
      seedLegacy("bot_one", "once", skill("once"));
      migrateLegacyBotSkillFolders(migratingOwner);
      const second = migrateLegacyBotSkillFolders(migratingOwner);
      expect(second.migrated).toEqual([]);
    });

    it("tags migrated skills as user-owned so the curator leaves them alone", () => {
      seedLegacy("bot_two", "owned", skill("owned"));
      migrateLegacyBotSkillFolders(migratingOwner);
      const found = findLibrarySkill(migratingOwner, "owned");
      expect(found?.skill.createdBy).toBe("learn");
    });
  });

  describe("rewrite and listing", () => {
    it("rewrites a skill and marks a patch in usage", () => {
      createLibrarySkill(owner, { name: "rewrite-me", content: skill("rewrite-me") });
      const result = rewriteLibrarySkill(owner, "rewrite-me", { content: skill("rewrite-me", "New body.") });
      expect(result).toHaveProperty("ref", "rewrite-me");
      expect(findLibrarySkill(owner, "rewrite-me")?.skill.content).toContain("New body.");
    });

    it("finds a skill by leaf name inside a category", () => {
      createLibrarySkill(owner, { name: "deep", category: "nested", content: skill("deep") });
      expect(findLibrarySkill(owner, "deep")?.ref).toBe("nested/deep");
    });

    it("lists skills and excludes archived ones unless asked", () => {
      createLibrarySkill(owner, { name: "live", content: skill("live") });
      createLibrarySkill(owner, { name: "gone", content: skill("gone") });
      archiveLibrarySkill(owner, "gone");

      expect(listLibrarySkills(owner).map((s) => s.name)).toEqual(["live"]);
      expect(listLibrarySkills(owner, { includeArchived: true })).toHaveLength(2);
    });
  });
});
