import { parseSkillContentMetadata } from "@/lib/skill-metadata";

describe("skill metadata", () => {
  it("returns empty prefixes when frontmatter is absent", () => {
    expect(parseSkillContentMetadata("# No frontmatter")).toEqual({
      shellCommandPrefixes: []
    });
  });

  it("parses quoted metadata and inline command prefix arrays", () => {
    expect(
      parseSkillContentMetadata(`---
name: "Browser Agent"
description: 'Use for browser tasks.'
allowed_command_prefixes: ["agent-browser", 'agent-browser', "playwright"]
---

Body`)
    ).toEqual({
      name: "Browser Agent",
      description: "Use for browser tasks.",
      shellCommandPrefixes: ["agent-browser", "playwright"]
    });
  });

  it("parses indented command prefix lists and ignores unrelated lines", () => {
    expect(
      parseSkillContentMetadata(`---
# comment
name: Release Pilot
command_prefixes:
  - git
  -  npm

description: Use for release work.
notes: ignored
shell_command_prefixes: invalid
---

Body`)
    ).toEqual({
      name: "Release Pilot",
      description: "Use for release work.",
      shellCommandPrefixes: ["git", "npm"]
    });
  });
});
