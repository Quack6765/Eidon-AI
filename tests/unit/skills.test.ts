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
      content: "Always review code for security issues."
    });

    expect(skill.name).toBe("Code Reviewer");
    expect(skill.content).toBe("Always review code for security issues.");
    expect(skill.enabled).toBe(true);

    const all = listSkills();
    expect(all).toHaveLength(initialCount + 1);

    const fetched = getSkill(skill.id);
    expect(fetched?.name).toBe("Code Reviewer");

    updateSkill(skill.id, { name: "Security Reviewer", enabled: false });
    const updated = getSkill(skill.id);
    expect(updated?.name).toBe("Security Reviewer");
    expect(updated?.enabled).toBe(false);

    deleteSkill(skill.id);
    expect(listSkills()).toHaveLength(initialCount);
    expect(getSkill(skill.id)).toBeNull();
  });

  it("lists only enabled skills", () => {
    const initialEnabledIds = new Set(listEnabledSkills().map((skill) => skill.id));
    const s1 = createSkill({ name: "Active", content: "Active skill" });
    const s2 = createSkill({ name: "Inactive", content: "Inactive skill" });

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
});
