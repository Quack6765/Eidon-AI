import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  blockingFindings,
  formatFindings,
  lintSkillDir
} from "@/lib/skill-lint";
import { BODY_SOFT_BUDGET_CHARS, ensureLibraryReady, skillDirPath } from "@/lib/skill-library";

const owner = "user_lint_a";

function writeSkill(ref: string, content: string) {
  ensureLibraryReady(owner);
  const dir = skillDirPath(owner, ref);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content, "utf8");
  return dir;
}

function rulesFor(ref: string, content: string) {
  const dir = writeSkill(ref, content);
  return lintSkillDir(dir, ref);
}

function frontMatter(name: string, description: string, extra = "") {
  return `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n## When to Use\n\nBody.\n\n## Pitfalls\n\nNone.\n\n## Verification\n\nCheck.\n`;
}

describe("skill-lint", () => {
  beforeEach(() => {
    ensureLibraryReady(owner);
  });

  it("reports a missing SKILL.md as a blocking error", () => {
    ensureLibraryReady(owner);
    const findings = lintSkillDir(skillDirPath(owner, "absent"), "absent");
    expect(findings).toEqual([
      { rule: "missing-skill-file", severity: "error", message: "no SKILL.md found in 'absent'." }
    ]);
    expect(blockingFindings(findings)).toHaveLength(1);
  });

  it("flags name-format and name-dir-mismatch without blocking", () => {
    const findings = rulesFor("good-dir", frontMatter("Display Name", "A description."));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "name-format", severity: "warning" }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "name-dir-mismatch", severity: "warning" }));
    expect(blockingFindings(findings)).toEqual([]);
  });

  it("accepts a name that matches its directory and is valid", () => {
    const findings = rulesFor("good-dir", frontMatter("good-dir", "A description."));
    expect(findings.filter((finding) => finding.rule.startsWith("name-"))).toEqual([]);
  });

  it("warns about missing metadata and marketing copy", () => {
    const findings = rulesFor(
      "meta",
      frontMatter("meta", "The ultimate powerful solution.", "version: 1\n")
    );
    const rules = findings.map((finding) => finding.rule);
    expect(rules).toContain("description-marketing");
    expect(rules).toContain("missing-metadata");
  });

  it("flags an all-capitals author and an unknown platform", () => {
    const findings = rulesFor(
      "platformed",
      frontMatter("platformed", "A description.", "author: BOB\nversion: 1\ntags: [a]\nplatforms: [beos]\nshell_command_prefixes: [curl]\n")
    );
    expect(findings).toContainEqual(expect.objectContaining({ rule: "author-caps" }));
    expect(findings).toContainEqual(expect.objectContaining({ rule: "platforms-value" }));
  });

  it("warns when platforms are set but the shell gate is not", () => {
    const findings = rulesFor(
      "gated",
      frontMatter("gated", "A description.", "author: bob\nversion: 1\ntags: [a]\nplatforms: [linux]\n")
    );
    expect(findings).toContainEqual(expect.objectContaining({ rule: "platforms-gating" }));
  });

  it("flags an oversized body, incident-log shape and shell one-liner advice", () => {
    const body = [
      "## When to Use",
      "",
      "Just run curl to fetch it. See https://example.com/pull/123 on 2026-01-02.",
      "",
      "## Pitfalls",
      "",
      "None.",
      "",
      "## Verification",
      "",
      "x".repeat(BODY_SOFT_BUDGET_CHARS)
    ].join("\n");
    const findings = rulesFor("busy", `---\nname: busy\ndescription: A description.\n---\n\n${body}`);
    const rules = findings.map((finding) => finding.rule);
    expect(rules).toContain("oversized-body");
    expect(rules).toContain("incident-log-shape");
    expect(rules).toContain("shell-utility-reference");
  });

  it("asks for a When to Use section", () => {
    const findings = rulesFor(
      "sectionless",
      "---\nname: sectionless\ndescription: A description.\n---\n\nJust a body with no headings.\n"
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: "missing-section", message: "no '## When to Use' section found" })
    );
  });

  it("flags a dangling reference to a support file that does not exist", () => {
    const findings = rulesFor(
      "dangling",
      `---\nname: dangling\ndescription: A description.\n---\n\n## When to Use\n\nSee references/missing.md.\n\n## Pitfalls\n\nNone.\n\n## Verification\n\nCheck.\n`
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: "dangling-reference", message: expect.stringContaining("references/missing.md") })
    );
  });

  it("reports advisory size findings as low severity", () => {
    const dir = writeSkill("sized", frontMatter("sized", "A description."));
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "references", "big.md"), "x".repeat(300 * 1024), "utf8");

    const findings = lintSkillDir(dir, "sized");
    expect(findings).toContainEqual(
      expect.objectContaining({ rule: "single-file-size", severity: "low", message: expect.stringContaining("limit: 256KB") })
    );
  });

  it("formats findings for the tool result", () => {
    expect(formatFindings([])).toBe("No lint findings.");
    expect(
      formatFindings([{ rule: "name-format", severity: "warning", message: "bad name" }])
    ).toBe("[warning] name-format: bad name");
  });
});
