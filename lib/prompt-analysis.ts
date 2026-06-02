import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { isFreshImageGenerationRequest } from "@/lib/image-generation/follow-up-context";
import type { PromptMessage, Skill } from "@/lib/types";

const SHELL_SKILL_INTENT_PATTERN =
  /\b(browser|website|web site|webpage|web page|url|link|click|navigate|navigation|screenshot|snapshot|inspect|form|login|dom)\b/i;
const URLISH_PATTERN = /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})(?:\/\S*)?/i;
const MEMORY_INTENT_WITHOUT_TOOL_PATTERN =
  /\b(?:let me|i(?:'ll| will| can| should|(?: am|'m) going to))\s+(?:save|remember|store|update|delete|remove)\b|\b(?:remember|save|store|update|delete|remove)\s+(?:that|this|it)\s+(?:for later|in memory|as memory)\b|\b(?:i(?:'ve| have)|we(?:'ve| have))\s+proposed\s+to\s+(?:add|save|store|update|delete|remove)\b.*\bmemory\b|\bit(?:'ll| will)\s+be\s+saved\s+once\s+you\s+approve\s+it\b/i;
const IMAGE_BYTE_OUTPUT_PATTERN =
  /\b(?:base64|data\s*:?\s*url|data:image\/|image\s+bytes|raw\s+bytes)\b/i;
const NEGATED_IMAGE_BYTE_OUTPUT_PATTERN =
  /\b(?:do\s+not|don't|dont|avoid)\b[\s\S]{0,24}\b(?:base64|data\s*:?\s*url|data:image\/|image\s+bytes|raw\s+bytes)\b|\bwithout\b[\s\S]{0,12}\b(?:base64|data\s*:?\s*url|data:image\/|image\s+bytes|raw\s+bytes)\b|\bno\s+(?:base64|data\s*:?\s*url|data:image\/|image\s+bytes|raw\s+bytes)\b/i;
const POSITIVE_IMAGE_BYTE_OUTPUT_REQUEST_PATTERN =
  /\b(?:give|send|return|provide|output|reply|respond|share|embed|inline|format)\b[\s\S]{0,40}\b(?:base64|data\s*:?\s*url|data:image\/|image\s+bytes|raw\s+bytes)\b|\b(?:as|in)\s+(?:a\s+)?(?:base64|data\s*:?\s*url|data:image\/|image\s+bytes|raw\s+bytes)\b/i;

function getSkillAllowedCommandPrefixes(skill: Skill) {
  return parseSkillContentMetadata(skill.content).shellCommandPrefixes;
}

function getSkillResolvedName(skill: Skill) {
  return parseSkillContentMetadata(skill.content).name?.trim() || skill.name;
}

function getSkillResolvedDescription(skill: Skill) {
  return parseSkillContentMetadata(skill.content).description?.trim() || skill.description;
}

export {
  SHELL_SKILL_INTENT_PATTERN,
  URLISH_PATTERN,
  MEMORY_INTENT_WITHOUT_TOOL_PATTERN,
  IMAGE_BYTE_OUTPUT_PATTERN,
  NEGATED_IMAGE_BYTE_OUTPUT_PATTERN,
  POSITIVE_IMAGE_BYTE_OUTPUT_REQUEST_PATTERN,
  getSkillAllowedCommandPrefixes,
  getSkillResolvedName,
  getSkillResolvedDescription
};

export function getLatestUserPromptContent(promptMessages: PromptMessage[]) {
  for (let index = promptMessages.length - 1; index >= 0; index -= 1) {
    const message = promptMessages[index];

    if (message.role === "user") {
      if (typeof message.content === "string") {
        return message.content.trim();
      }

      return message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
    }
  }

  return "";
}

export function getLatestUserPromptIndex(promptMessages: PromptMessage[]) {
  for (let index = promptMessages.length - 1; index >= 0; index -= 1) {
    if (promptMessages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

export function shouldAddInlineAttachmentDirective(promptMessages: PromptMessage[]) {
  const latestUserContent = getLatestUserPromptContent(promptMessages);
  if (!latestUserContent) {
    return false;
  }

  if (!IMAGE_BYTE_OUTPUT_PATTERN.test(latestUserContent)) {
    return true;
  }

  if (NEGATED_IMAGE_BYTE_OUTPUT_PATTERN.test(latestUserContent)) {
    return true;
  }

  return !POSITIVE_IMAGE_BYTE_OUTPUT_REQUEST_PATTERN.test(latestUserContent);
}

export function hasRecentAssistantImageContext(promptMessages: PromptMessage[]) {
  const latestUserIndex = getLatestUserPromptIndex(promptMessages);
  if (latestUserIndex <= 0) {
    return false;
  }

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = promptMessages[index];
    if (!message || (message.role !== "assistant" && message.role !== "tool")) {
      continue;
    }

    const content = typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");

    if (/\b(generated|created|made|rendered)\b[\s\S]{0,40}\b(image|images|picture|pictures|photo|photos|render|renders)\b|\b(image|images|picture|pictures|photo|photos|render|renders)\b[\s\S]{0,40}\b(generated|created|made|rendered)\b|\bshould appear above\b/i.test(content)) {
      return true;
    }
  }

  return false;
}

export function filterSkillsForTurn(skills: Skill[], promptMessages: PromptMessage[]) {
  const latestUserContent = getLatestUserPromptContent(promptMessages).toLowerCase();

  return skills.filter((skill) => {
    const shellPrefixes = getSkillAllowedCommandPrefixes(skill);

    if (!shellPrefixes.length) {
      return true;
    }

    const resolvedName = getSkillResolvedName(skill).toLowerCase();
    const resolvedDescription = getSkillResolvedDescription(skill).toLowerCase();

    if (latestUserContent.includes(resolvedName)) {
      return true;
    }

    if (URLISH_PATTERN.test(latestUserContent) || SHELL_SKILL_INTENT_PATTERN.test(latestUserContent)) {
      return resolvedName.includes("browser") || resolvedDescription.includes("browser");
    }

    return false;
  });
}

export function hasUnfulfilledMemoryIntent(answer: string) {
  return MEMORY_INTENT_WITHOUT_TOOL_PATTERN.test(answer);
}

export function hasUnfulfilledImageGenerationIntent(promptMessages: PromptMessage[]) {
  const latestUserContent = getLatestUserPromptContent(promptMessages);
  if (!latestUserContent) {
    return false;
  }

  return isFreshImageGenerationRequest(latestUserContent, hasRecentAssistantImageContext(promptMessages));
}
