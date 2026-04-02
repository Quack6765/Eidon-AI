import type { Skill } from "@/lib/types";

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_release_notes",
    name: "Release Notes",
    description: "Use when writing customer-facing summaries of product changes.",
    content: "Summarize changes for end users in concise release notes.",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("skill runtime", () => {
  it("resolves skill name from frontmatter metadata", async () => {
    const { getSkillResolvedName } = await import("@/lib/skill-runtime");

    expect(getSkillResolvedName(createSkill())).toBe("Release Notes");

    const skillWithMetadata = createSkill({
      content: `---
name: Browser Agent
description: Use for browser-driven workflows.
---

Open websites and inspect them.`
    });
    expect(getSkillResolvedName(skillWithMetadata)).toBe("Browser Agent");
  });

  it("resolves skill description from frontmatter metadata", async () => {
    const { getSkillResolvedDescription } = await import("@/lib/skill-runtime");

    expect(getSkillResolvedDescription(createSkill())).toBe("Use when writing customer-facing summaries of product changes.");

    const skillWithMetadata = createSkill({
      content: `---
name: Browser Agent
description: Use for browser-driven workflows.
---

Open websites and inspect them.`
    });
    expect(getSkillResolvedDescription(skillWithMetadata)).toBe("Use for browser-driven workflows.");
  });

  it("reads shell command prefixes from skill frontmatter metadata", async () => {
    const { getSkillAllowedCommandPrefixes } = await import("@/lib/skill-runtime");

    expect(getSkillAllowedCommandPrefixes(createSkill())).toEqual([]);

    const skillWithPrefixes = createSkill({
      content: `---
name: Browser Agent
description: Use for browser-driven workflows.
shell_command_prefixes:
  - agent-browser
---

Open websites and inspect them.`
    });
    expect(getSkillAllowedCommandPrefixes(skillWithPrefixes)).toEqual(["agent-browser"]);
  });
});
