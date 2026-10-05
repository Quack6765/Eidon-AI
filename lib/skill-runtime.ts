import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import type { Skill, SkillLifecycleState, SkillUsage } from "@/lib/types";

export function getSkillResolvedName(skill: Skill) {
  return parseSkillContentMetadata(skill.content).name?.trim() || skill.name;
}

export function getSkillResolvedDescription(skill: Skill) {
  return parseSkillContentMetadata(skill.content).description?.trim() || skill.description;
}

export function getSkillAllowedCommandPrefixes(skill: Skill) {
  return parseSkillContentMetadata(skill.content).shellCommandPrefixes;
}

export const EMPTY_SKILL_USAGE: SkillUsage = {
  useCount: 0,
  viewCount: 0,
  lastUsedAt: null,
  lastViewedAt: null,
  patchCount: 0,
  lastPatchedAt: null
};

export function getSkillState(skill: Skill): SkillLifecycleState {
  return skill.state ?? "active";
}

export function isSkillPinned(skill: Skill) {
  return skill.pinned === true;
}

export function getSkillUsage(skill: Skill): SkillUsage {
  return skill.usage ?? EMPTY_SKILL_USAGE;
}
