import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import type { Skill } from "@/lib/types";

export function getSkillResolvedName(skill: Skill) {
  return parseSkillContentMetadata(skill.content).name?.trim() || skill.name;
}

export function getSkillResolvedDescription(skill: Skill) {
  return parseSkillContentMetadata(skill.content).description?.trim() || skill.description;
}

export function getSkillAllowedCommandPrefixes(skill: Skill) {
  return parseSkillContentMetadata(skill.content).shellCommandPrefixes;
}
