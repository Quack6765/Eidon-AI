import { describe, expect, it } from "vitest";

import { BUILTIN_AGENT_BROWSER_SKILL } from "@/lib/db-builtin-skills";
import { DEFAULT_BOT_BASE_SYSTEM_PROMPT } from "@/lib/bot-prompt-defaults";
import { filterSkillsForTurn } from "@/lib/prompt-analysis";
import type { PromptMessage, Skill } from "@/lib/types";

function browserSkill(): Skill {
  return {
    id: BUILTIN_AGENT_BROWSER_SKILL.id,
    name: BUILTIN_AGENT_BROWSER_SKILL.name,
    description: BUILTIN_AGENT_BROWSER_SKILL.description,
    content: BUILTIN_AGENT_BROWSER_SKILL.content,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function plainSkill(): Skill {
  return {
    id: "skill_plain",
    name: "Plain Skill",
    description: "No shell prefixes.",
    content: "---\nname: Plain Skill\ndescription: No shell prefixes.\n---\n\nBody",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function userMessage(text: string): PromptMessage[] {
  return [{ role: "user", content: text }];
}

describe("filterSkillsForTurn browser skill gating", () => {
  const skills = [browserSkill(), plainSkill()];

  it("keeps the browser skill on turns without browser intent when includeBrowserSkills is set", () => {
    const kept = filterSkillsForTurn(skills, userMessage("Deploy the landing page and confirm it works"), {
      includeBrowserSkills: true
    });
    expect(kept.map((skill) => skill.id)).toContain(BUILTIN_AGENT_BROWSER_SKILL.id);
    expect(kept.map((skill) => skill.id)).toContain("skill_plain");
  });

  it("keeps the browser skill when the latest user message has no browser intent and includeBrowserSkills is unset", () => {
    const kept = filterSkillsForTurn(skills, userMessage("Deploy the landing page and confirm it works"));
    expect(kept.map((skill) => skill.id)).not.toContain(BUILTIN_AGENT_BROWSER_SKILL.id);
    expect(kept.map((skill) => skill.id)).toContain("skill_plain");
  });

  it("keeps the browser skill when the latest user message mentions a url", () => {
    const kept = filterSkillsForTurn(skills, userMessage("Check https://example.com pricing"));
    expect(kept.map((skill) => skill.id)).toContain(BUILTIN_AGENT_BROWSER_SKILL.id);
  });

  it("keeps the browser skill when the latest user message names the skill", () => {
    const kept = filterSkillsForTurn(skills, userMessage("Use Agent Browser to log in"));
    expect(kept.map((skill) => skill.id)).toContain(BUILTIN_AGENT_BROWSER_SKILL.id);
  });
});

describe("DEFAULT_BOT_BASE_SYSTEM_PROMPT proactive browser validation", () => {
  it("instructs bots to validate website work themselves in their browser session", () => {
    expect(DEFAULT_BOT_BASE_SYSTEM_PROMPT).toMatch(/proactive with your browser/i);
    expect(DEFAULT_BOT_BASE_SYSTEM_PROMPT).toMatch(/never ask the user to check or validate/i);
  });

  it("keeps the dedicated browser session instruction", () => {
    expect(DEFAULT_BOT_BASE_SYSTEM_PROMPT).toContain(
      "You have your own dedicated browser session and file workspace"
    );
  });
});
