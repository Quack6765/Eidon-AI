import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

import { parseSkillContentMetadata, stripSkillFrontmatter } from "@/lib/skill-metadata";
import {
  BODY_SOFT_BUDGET_CHARS,
  MAX_FILE_COUNT,
  MAX_REFERENCE_FILES,
  MAX_SINGLE_FILE_KB,
  MAX_TOTAL_SIZE_KB,
  SKILL_FILE_NAME,
  skillRefLeaf,
  VALID_NAME_RE,
  NAME_RULE
} from "@/lib/skill-library";

export type LintSeverity = "error" | "warning" | "low";

export type LintFinding = {
  rule: string;
  severity: LintSeverity;
  message: string;
};

const KNOWN_PLATFORMS = new Set(["linux", "macos", "windows", "darwin"]);
const MARKETING_PATTERNS = /\b(powerful|ultimate|best-in-class|seamless|revolutionary|state-of-the-art)\b/i;
const SHELL_UTILITY_PATTERNS = /\b(just run|simply run|simply use|use `?(?:curl|wget|sed|awk|grep)`? to)\b/i;
const INCIDENT_LOG_PATTERNS = /\b(\d{4}-\d{2}-\d{2}|PR #\d+|issue #\d+|https?:\/\/\S+\/pull\/\d+)\b/;
const REQUIRED_SECTIONS = ["## When to Use"];

function walkFiles(dir: string, prefix = ""): Array<{ path: string; bytes: number }> {
  const found: Array<{ path: string; bytes: number }> = [];
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const childRel = prefix ? posix.join(prefix, entry.name) : entry.name;
    const childPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      found.push(...walkFiles(childPath, childRel));
    } else {
      found.push({ path: childRel, bytes: statSync(childPath).size });
    }
  }

  return found;
}

export function lintSkillDir(dir: string, skillRef: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const skillFilePath = join(dir, SKILL_FILE_NAME);

  if (!existsSync(skillFilePath)) {
    findings.push({ rule: "missing-skill-file", severity: "error", message: `no ${SKILL_FILE_NAME} found in '${skillRef}'.` });
    return findings;
  }

  const content = readFileSync(skillFilePath, "utf8");
  const metadata = parseSkillContentMetadata(content);
  const body = stripSkillFrontmatter(content);
  const leaf = skillRefLeaf(skillRef);
  const frontName = metadata.name?.trim();

  if (!frontName) {
    findings.push({ rule: "missing-metadata", severity: "warning", message: "no 'name' in frontmatter." });
  } else if (!VALID_NAME_RE.test(frontName)) {
    findings.push({
      rule: "name-format",
      severity: "warning",
      message: `name '${frontName}' must be lowercase letters, digits, hyphens, and underscores only. ${NAME_RULE}`
    });
  }

  if (frontName && frontName !== leaf) {
    findings.push({
      rule: "name-dir-mismatch",
      severity: "warning",
      message: `frontmatter name '${frontName}' does not match directory '${leaf}'; they must be identical.`
    });
  }

  const description = metadata.description?.trim() ?? "";
  if (!description) {
    findings.push({ rule: "missing-metadata", severity: "warning", message: "no 'description' in frontmatter." });
  }
  if (description.length > 1024) {
    findings.push({
      rule: "description-length",
      severity: "warning",
      message: `description is ${description.length} characters; keep it under 1024.`
    });
  }
  if (MARKETING_PATTERNS.test(description)) {
    findings.push({
      rule: "description-marketing",
      severity: "warning",
      message: "description reads like marketing; state the trigger conditions instead."
    });
  }

  if (!metadata.version) {
    findings.push({ rule: "missing-metadata", severity: "warning", message: "no 'version' in frontmatter." });
  }
  if (!metadata.author) {
    findings.push({ rule: "missing-metadata", severity: "warning", message: "no 'author' in frontmatter." });
  } else if (metadata.author !== metadata.author.toLowerCase() && metadata.author === metadata.author.toUpperCase()) {
    findings.push({ rule: "author-caps", severity: "warning", message: `author '${metadata.author}' is all capitals.` });
  }
  if (!metadata.tags.length) {
    findings.push({ rule: "missing-metadata", severity: "warning", message: "no 'tags' in frontmatter." });
  }

  for (const platform of metadata.platforms) {
    if (!KNOWN_PLATFORMS.has(platform.toLowerCase())) {
      findings.push({
        rule: "platforms-value",
        severity: "warning",
        message: `unknown platform '${platform}'; expected one of ${[...KNOWN_PLATFORMS].join(", ")}.`
      });
    }
  }

  if (body.length > BODY_SOFT_BUDGET_CHARS) {
    findings.push({
      rule: "oversized-body",
      severity: "warning",
      message: `body is ${body.length} characters (soft budget: ${BODY_SOFT_BUDGET_CHARS}); move topical depth into references/.`
    });
  }

  if (SHELL_UTILITY_PATTERNS.test(body)) {
    findings.push({
      rule: "shell-utility-reference",
      severity: "warning",
      message: "body tells the reader to hand-roll a shell one-liner; prefer a script under scripts/."
    });
  }

  if (INCIDENT_LOG_PATTERNS.test(body)) {
    findings.push({
      rule: "incident-log-shape",
      severity: "warning",
      message: "body reads like an incident log; distil it to the rule and drop dates, PR numbers and chatter."
    });
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!body.includes(section)) {
      findings.push({ rule: "missing-section", severity: "warning", message: `no '${section}' section found` });
    }
  }

  const referenced = [...body.matchAll(/(?:references|templates|scripts|assets)\/[a-zA-Z0-9._-]+/g)].map((match) => match[0]);
  const files = walkFiles(dir);
  const present = new Set(files.map((file) => file.path));

  for (const ref of referenced) {
    if (!present.has(ref)) {
      findings.push({ rule: "dangling-reference", severity: "warning", message: `body references '${ref}' but the file does not exist.` });
    }
  }

  const referenceFiles = files.filter((file) => file.path.startsWith("references/"));
  if (referenceFiles.length > MAX_REFERENCE_FILES) {
    findings.push({
      rule: "references-sprawl",
      severity: "warning",
      message: `${referenceFiles.length} files under references/; that is a per-session log, not topical depth (limit: ${MAX_REFERENCE_FILES}).`
    });
  }

  if (metadata.platforms.length && !metadata.shellCommandPrefixes.length) {
    findings.push({
      rule: "platforms-gating",
      severity: "warning",
      message: "'platforms' is set but the skill declares no shell_command_prefixes, so the gate never applies."
    });
  }

  for (const file of files) {
    if (file.path === SKILL_FILE_NAME) {
      continue;
    }
    const kb = Math.ceil(file.bytes / 1024);
    if (kb > MAX_SINGLE_FILE_KB) {
      findings.push({ rule: "single-file-size", severity: "low", message: `file is ${kb}KB (limit: ${MAX_SINGLE_FILE_KB}KB)` });
    }
  }

  if (files.length > MAX_FILE_COUNT) {
    findings.push({ rule: "file-count", severity: "low", message: `skill has ${files.length} files (limit: ${MAX_FILE_COUNT})` });
  }

  const totalKb = Math.ceil(files.reduce((sum, file) => sum + file.bytes, 0) / 1024);
  if (totalKb > MAX_TOTAL_SIZE_KB) {
    findings.push({
      rule: "total-size",
      severity: "low",
      message: `skill is ${totalKb}KB total (limit: ${MAX_TOTAL_SIZE_KB}KB) — informational only: large skills are legitimate`
    });
  }

  return findings;
}

export function blockingFindings(findings: LintFinding[]) {
  return findings.filter((finding) => finding.severity === "error");
}

export function formatFindings(findings: LintFinding[]) {
  if (!findings.length) {
    return "No lint findings.";
  }
  return findings.map((finding) => `[${finding.severity}] ${finding.rule}: ${finding.message}`).join("\n");
}
