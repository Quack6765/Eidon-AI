import type { MemoryRigor } from "@/lib/types";

const PROPOSAL_MODEL_NOTE =
  "Memory changes do not apply immediately: each call to create_memory, update_memory, or delete_memory creates a pending proposal the user can approve or dismiss. Never claim you saved, updated, or deleted a memory without calling the matching tool in that same response. The user can review and manage all memories and proposals in their settings.";

const DURABLE_FACT_EXAMPLES =
  "name, location, timezone, language, profession or role, long-term projects and goals, skills, and stable preferences (how they like things done, formatting, tools, or communication style)";

const GLOBAL_SCOPE_NOTE =
  "Memory is global: every saved fact is injected into all future conversations, not just this chat.";

const HARD_EXCLUSIONS =
  "Do not save conversation-local content: topics merely being discussed, one-off requests, scratch notes, intermediate decisions, current task state, or anything that would not help an unrelated chat days or weeks from now.";

const DEFAULT_SKIP_RULE = "If you are unsure whether a fact is durable, do not propose a memory.";

const SYSTEM_GUIDANCE: Record<MemoryRigor, string> = {
  low:
    "Only propose a memory when the user explicitly asks you to remember something, or when a fact is unmistakably durable and recurring (for example, the user corrects their name or location). Otherwise, do not create memory proposals.",
  balanced:
    `${GLOBAL_SCOPE_NOTE} Propose a memory only for stable facts about the user that will still be true and useful in an unrelated future conversation — ${DURABLE_FACT_EXAMPLES}. ${HARD_EXCLUSIONS} Discussing a topic is not a preference about it; completing one task is not a durable skill; temporary project state is not a long-term goal. When a durable fact is clearly stated for the first time, or an existing memory is now wrong or incomplete, propose create_memory or update_memory. ${DEFAULT_SKIP_RULE}`,
  high:
    `${GLOBAL_SCOPE_NOTE} Proactively capture durable personal context so future conversations benefit — ${DURABLE_FACT_EXAMPLES}, plus stated or clearly implied goals, ongoing work, environment, and recurring needs. ${HARD_EXCLUSIONS} Prefer a small set of accurate, reusable facts over many thin notes. When a durable fact is stated or an existing memory becomes inaccurate, propose a change. ${DEFAULT_SKIP_RULE}`
};

export function buildMemorySystemGuidance(rigor: MemoryRigor): string {
  const base = SYSTEM_GUIDANCE[rigor] ?? SYSTEM_GUIDANCE.balanced;
  return [
    "You have access to memory tools (create_memory, update_memory, delete_memory) to propose changes to the user's long-term memory.",
    base,
    "Before proposing a new memory, check the memories listed above: if a similar fact already exists, update it instead of creating a duplicate.",
    PROPOSAL_MODEL_NOTE
  ].join(" ");
}

const TOOL_DESCRIPTIONS: Record<MemoryRigor, string> = {
  low:
    "Save a durable fact about the user for future conversations. Use rarely — only when the user explicitly asks, or for an unmistakably durable, recurring fact. Do not save transient task details.",
  balanced:
    "Save a durable fact about the user that will matter in unrelated future conversations (name, location, role, goals, stable preferences). Do not save discussion topics, one-off requests, or current task details. When unsure, skip.",
  high:
    "Save durable facts about the user that could help future conversations (personal context, preferences, goals, work, environment). Skip conversation-local task state and one-off content. Prefer fewer, high-value memories."
};

export function buildCreateMemoryDescription(rigor: MemoryRigor): string {
  return TOOL_DESCRIPTIONS[rigor] ?? TOOL_DESCRIPTIONS.balanced;
}

export function buildUpdateMemoryDescription(): string {
  return "Update an existing memory only when a stored durable fact is now incorrect or incomplete. Do not update memories to record temporary progress or discussion notes.";
}

export function buildDeleteMemoryDescription(): string {
  return "Delete a stored memory when it is no longer true or no longer useful across conversations. Do not delete a memory just because it is unrelated to the current chat.";
}
