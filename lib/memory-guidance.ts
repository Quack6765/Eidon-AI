import type { MemoryRigor } from "@/lib/types";

const PROPOSAL_MODEL_NOTE =
  "Memory changes do not apply immediately: each call to create_memory, update_memory, or delete_memory creates a pending proposal the user can approve or dismiss. Never claim you saved, updated, or deleted a memory without calling the matching tool in that same response. The user can review and manage all memories and proposals in their settings.";

const DURABLE_FACT_EXAMPLES =
  "name, location, timezone, language, profession or role, long-term projects and goals, skills, and stable preferences (how they like things done, formatting, tools, or communication style)";

const SYSTEM_GUIDANCE: Record<MemoryRigor, string> = {
  low:
    "Only propose a memory when the user explicitly asks you to remember something, or when a fact is unmistakably durable and recurring (for example, the user corrects their name or location). Otherwise, do not create memory proposals.",
  balanced:
    `Proactively capture durable facts about the user that will recur in future conversations — ${DURABLE_FACT_EXAMPLES}. When the user states or reveals such a fact for the first time, or corrects a fact you already know, propose a memory in the same response. Do not store transient details about the current task, one-off requests, or content the user is merely discussing.`,
  high:
    `Capture broadly and proactively. Whenever the user reveals personal context, preferences, goals, ongoing work, environment, or recurring needs — even if only implied — propose a memory so future conversations benefit. Still skip transient task state and one-off content, but lean toward saving anything that could plausibly recur. Focus on durable facts such as ${DURABLE_FACT_EXAMPLES}.`
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
    "Save a durable fact about the user for future conversations (name, location, role, goals, stable preferences). Call this proactively when the user reveals such a fact for the first time. Do not save transient task details.",
  high:
    "Save anything about the user that could plausibly recur across conversations (personal context, preferences, goals, work, environment). Be proactive — capture implied as well as stated facts. Skip only pure transient task state."
};

export function buildCreateMemoryDescription(rigor: MemoryRigor): string {
  return TOOL_DESCRIPTIONS[rigor] ?? TOOL_DESCRIPTIONS.balanced;
}
