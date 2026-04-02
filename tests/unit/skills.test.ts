import {
  createSkill,
  deleteSkill,
  getSkill,
  listEnabledSkills,
  listSkills,
  updateSkill
} from "@/lib/skills";

describe("skills", () => {
  it("creates, lists, updates, and deletes skills", () => {
    const initialCount = listSkills().length;
    const skill = createSkill({
      name: "Code Reviewer",
      description: "Use when reviewing code changes for correctness and safety.",
      content: "Always review code for security issues."
    });

    expect(skill.name).toBe("Code Reviewer");
    expect(skill.description).toBe("Use when reviewing code changes for correctness and safety.");
    expect(skill.content).toBe("Always review code for security issues.");
    expect(skill.enabled).toBe(true);

    const all = listSkills();
    expect(all).toHaveLength(initialCount + 1);

    const fetched = getSkill(skill.id);
    expect(fetched?.name).toBe("Code Reviewer");

    updateSkill(skill.id, {
      name: "Security Reviewer",
      description: "Use when reviewing security-sensitive changes.",
      enabled: false
    });
    const updated = getSkill(skill.id);
    expect(updated?.name).toBe("Security Reviewer");
    expect(updated?.description).toBe("Use when reviewing security-sensitive changes.");
    expect(updated?.enabled).toBe(false);

    deleteSkill(skill.id);
    expect(listSkills()).toHaveLength(initialCount);
    expect(getSkill(skill.id)).toBeNull();
  });

  it("lists only enabled skills", () => {
    const initialEnabledIds = new Set(listEnabledSkills().map((skill) => skill.id));
    const s1 = createSkill({
      name: "Active",
      description: "Use when the active path applies.",
      content: "Active skill"
    });
    const s2 = createSkill({
      name: "Inactive",
      description: "Use when the inactive path applies.",
      content: "Inactive skill"
    });

    updateSkill(s2.id, { enabled: false });

    const enabled = listEnabledSkills();
    expect(enabled.some((skill) => skill.id === s1.id)).toBe(true);
    expect(enabled.some((skill) => skill.id === s2.id)).toBe(false);
    expect(enabled.map((skill) => skill.id)).toEqual(
      expect.arrayContaining([...initialEnabledIds, s1.id])
    );
  });

  it("returns null for missing skill update", () => {
    const result = updateSkill("nonexistent", { name: "X" });
    expect(result).toBeNull();
  });

  it("returns null for missing skills and falls back to reusable instructions when needed", () => {
    expect(getSkill("missing")).toBeNull();

    const skill = createSkill({
      name: "Bare",
      content: "# Bare"
    });

    expect(skill.description).toBe("Reusable skill instructions.");
  });

  it("derives a description from instructions when one is not provided", () => {
    const skill = createSkill({
      name: "Release Notes",
      content: "# Release Notes\nSummarize notable product changes for end users."
    });

    expect(skill.description).toBe("Summarize notable product changes for end users.");
  });

  it("derives skill metadata from frontmatter headers", () => {
    const skill = createSkill({
      name: "Temporary Name",
      content: `---
name: Browser Agent
description: Use for browser-driven workflows.
shell_command_prefixes:
  - agent-browser
---

# Browser Agent

Open websites and inspect them.`
    });

    expect(skill.name).toBe("Browser Agent");
    expect(skill.description).toBe("Use for browser-driven workflows.");

    const fetched = getSkill(skill.id);
    expect(fetched?.name).toBe("Browser Agent");
    expect(fetched?.description).toBe("Use for browser-driven workflows.");

    deleteSkill(skill.id);
  });

  it("updates metadata from replacement content and preserves existing descriptions when needed", () => {
    const skill = createSkill({
      name: "Skill",
      description: "Keep me",
      content: "# Heading"
    });

    const frontmatterUpdate = updateSkill(skill.id, {
      content: `---
name: Browser Agent
description: Use for browser-driven workflows.
---

# Browser Agent`
    });

    expect(frontmatterUpdate?.name).toBe("Browser Agent");
    expect(frontmatterUpdate?.description).toBe("Use for browser-driven workflows.");

    const preservedDescription = updateSkill(skill.id, {
      content: "# Browser Agent"
    });

    expect(preservedDescription?.description).toBe("Use for browser-driven workflows.");
  });
});
