import { createGuardedAnswerEmitter } from "@/lib/control-output";
import { streamProviderResponse } from "@/lib/provider";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderProfileWithApiKey,
  Skill
} from "@/lib/types";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

type ExtractedSkillRequest = {
  names: string[];
  leadingText: string;
};

function mergeSystemMessage(promptMessages: PromptMessage[], content: string): PromptMessage[] {
  const systemIndex = promptMessages.findIndex((message) => message.role === "system");

  if (systemIndex === -1) {
    return [{ role: "system", content }, ...promptMessages];
  }

  return promptMessages.map((message, index) =>
    index === systemIndex
      ? {
          ...message,
          content: `${message.content}\n\n${content}`
        }
      : message
  );
}

export function normalizeSkillName(name: string) {
  return name.trim().toLowerCase();
}

export function getSkillResolvedName(skill: Skill) {
  return parseSkillContentMetadata(skill.content).name?.trim() || skill.name;
}

export function getSkillResolvedDescription(skill: Skill) {
  return parseSkillContentMetadata(skill.content).description?.trim() || skill.description;
}

function uniqueSkillNames(names: string[]) {
  return [...new Set(names.map((name) => normalizeSkillName(name)).filter(Boolean))];
}

export function buildSkillsMetadataMessage(skills: Skill[]) {
  const metadata = skills
    .map(
      (skill) => {
        const shellPrefixes = getSkillAllowedCommandPrefixes(skill);
        const shellLabel = shellPrefixes.length
          ? ` (loads restricted local shell command support: ${shellPrefixes.join(", ")})`
          : "";

        return `- ${getSkillResolvedName(skill)}: ${getSkillResolvedDescription(skill)}${shellLabel}`;
      }
    )
    .join("\n");

  return [
    "Enabled skills are available with progressive disclosure.",
    "You currently have access only to skill metadata.",
    "Review the skill names and descriptions and request a full skill only when it is relevant to the current task.",
    "If you need one or more full skill bodies before answering, respond with exactly:",
    'SKILL_REQUEST: {"skills":["Skill Name"]}',
    "Do not answer the user in the same message as a skill request.",
    "Do not request a skill that has already been loaded.",
    "",
    "Available skills:",
    metadata
  ].join("\n");
}

export function buildLoadedSkillsMessage(skills: Skill[]) {
  const sections = skills.map((skill) => {
    const commandPrefixes = getSkillAllowedCommandPrefixes(skill);
    const shellLines = commandPrefixes.length
      ? [
          "",
          "Local host command execution is enabled for this skill.",
          `Allowed command prefixes: ${commandPrefixes.join(", ")}`,
          "To execute a local command, respond with exactly:",
          'SHELL_CALL: {"command":"agent-browser open https://example.com && agent-browser snapshot -i","timeoutMs":30000}',
          "Only use commands that begin with one of the allowed prefixes."
        ]
      : [];

    return [`# ${getSkillResolvedName(skill)}`, `Description: ${getSkillResolvedDescription(skill)}`, "", skill.content, ...shellLines].join("\n");
  });

  return ["Requested skill instructions are now loaded.", "", ...sections].join("\n\n");
}

export function getSkillAllowedCommandPrefixes(skill: Skill) {
  return parseSkillContentMetadata(skill.content).shellCommandPrefixes;
}

export function extractSkillRequest(answer: string): ExtractedSkillRequest | null {
  const trimmed = answer.trim();
  const markerIndex = trimmed.lastIndexOf("SKILL_REQUEST:");

  if (markerIndex === -1) {
    return null;
  }

  const leadingText = trimmed.slice(0, markerIndex).trim();
  const payloadSource = trimmed.slice(markerIndex);
  const match = payloadSource.match(/^SKILL_REQUEST:\s*(\{[\s\S]+\})$/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1]) as { skill?: string; skills?: string[] };
    const names = [
      ...(typeof parsed.skill === "string" ? [parsed.skill] : []),
      ...(Array.isArray(parsed.skills) ? parsed.skills.filter((value): value is string => typeof value === "string") : [])
    ];

    const normalized = uniqueSkillNames(names);
    return normalized.length ? { names: normalized, leadingText } : null;
  } catch {
    return null;
  }
}

export async function resolveAssistantWithSkills(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
  onEvent?: (event: ChatStreamEvent) => void;
}) {
  const loadedSkillIds = new Set<string>();
  const maxPasses = Math.max(1, input.skills.length + 1);
  let promptMessages = input.skills.length
    ? mergeSystemMessage(input.promptMessages, buildSkillsMetadataMessage(input.skills))
    : input.promptMessages;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const guardedAnswerEmitter = createGuardedAnswerEmitter(["SKILL_REQUEST:"]);
    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages
    });

    let answer = "";
    let thinking = "";
    let usage: Usage = {};

    while (true) {
      const next = await providerStream.next();

      if (next.done) {
        answer = next.value.answer;
        thinking = next.value.thinking;
        usage = next.value.usage;
        break;
      }

      if (next.value.type === "thinking_delta") {
        input.onEvent?.(next.value);
        continue;
      }

      if (next.value.type === "answer_delta") {
        const events = guardedAnswerEmitter.push(next.value.text);
        events.forEach((event) => input.onEvent?.(event));
        continue;
      }

      input.onEvent?.(next.value);
    }

    const requestedSkillRequest = extractSkillRequest(answer);

    if (requestedSkillRequest && pass < maxPasses - 1) {
      const requestedSkills = requestedSkillRequest.names
        .map((name) =>
          input.skills.find((skill) => normalizeSkillName(getSkillResolvedName(skill)) === name)
        )
        .filter((skill): skill is Skill => Boolean(skill))
        .filter((skill) => !loadedSkillIds.has(skill.id));

      if (requestedSkills.length) {
        requestedSkills.forEach((skill) => loadedSkillIds.add(skill.id));
        promptMessages = mergeSystemMessage(
          promptMessages,
          buildLoadedSkillsMessage(requestedSkills)
        );
        continue;
      }

      promptMessages = mergeSystemMessage(
        promptMessages,
        "The requested skill is unavailable or already loaded. Continue and answer the user without another SKILL_REQUEST."
      );
      continue;
    }

    guardedAnswerEmitter.flush().forEach((event) => input.onEvent?.(event));

    return {
      answer,
      thinking,
      usage
    };
  }

  return {
    answer: "",
    thinking: "",
    usage: {}
  };
}
