import type { MemoryRigor } from "@/lib/types";

const PROPOSAL_MODEL_NOTE =
  "Memory changes do not apply immediately: each call to create_memory, update_memory, or delete_memory creates a pending proposal the user can approve or dismiss. Never claim you saved, updated, or deleted a memory without calling the matching tool in that same response. The user can review and manage all memories and proposals in their settings.";

const DURABLE_FACT_EXAMPLES =
  "name, location, timezone, language, profession or role, long-term projects and goals, skills, and stable preferences (how they like things done, formatting, tools, or communication style)";

const GLOBAL_MEMORY_NOTE =
  "The user's memory is global: a single store shared across every conversation, not a notebook for the current chat. Everything saved there is loaded into future conversations on unrelated topics, so only propose changes that would be useful outside this conversation.";

const LITMUS_TEST =
  "Before proposing any memory change, ask: would this fact matter in a future conversation about a completely different topic? If not, skip it.";

const SYSTEM_GUIDANCE: Record<MemoryRigor, string> = {
  low:
    "Only propose a memory when the user explicitly asks you to remember something, or when a fact is unmistakably durable and recurring (for example, the user corrects their name or location). Otherwise, do not create memory proposals.",
  balanced:
    `Proactively capture durable facts about the user that will recur in future conversations — ${DURABLE_FACT_EXAMPLES}. When the user states or reveals such a fact for the first time, or corrects a fact you already know, propose a memory in the same response. Memories must describe the user, not the topic under discussion: discussing, asking about, or working on a subject in this conversation is not by itself memory-worthy — only the user's durable relationship to it (profession, standing goal, stable preference) qualifies. Do not store transient details about the current task, one-off requests, or content the user is merely discussing.`,
  high:
    `Capture broadly and proactively. Whenever the user reveals personal context, preferences, goals, ongoing work, environment, or recurring needs — even if only implied — propose a memory so future conversations benefit. Be proactive about durable facts such as ${DURABLE_FACT_EXAMPLES}, never about the content of the current conversation: what the user discusses, asks about, or works on here is conversation content, not memory. A subject earns a memory only through repetition across conversations or a stated ongoing commitment.`
};

export function buildMemorySystemGuidance(rigor: MemoryRigor): string {
  const base = SYSTEM_GUIDANCE[rigor] ?? SYSTEM_GUIDANCE.balanced;
  return [
    "You have access to memory tools (create_memory, update_memory, delete_memory) to propose changes to the user's global long-term memory.",
    GLOBAL_MEMORY_NOTE,
    base,
    LITMUS_TEST,
    "Before proposing a new memory, check the memories listed above: if a similar fact already exists, update it instead of creating a duplicate.",
    PROPOSAL_MODEL_NOTE
  ].join(" ");
}

const TOOL_DESCRIPTIONS: Record<MemoryRigor, string> = {
  low:
    "Save a durable fact about the user to their global memory, shared across all conversations. Use rarely — only when the user explicitly asks, or for an unmistakably durable, recurring fact. Do not save anything about the topic currently under discussion.",
  balanced:
    "Save a durable fact about the user to their global memory, shared across all conversations (name, location, role, goals, stable preferences). Call this proactively when the user reveals such a fact for the first time. What the user discusses or works on in the current conversation is not a fact about the user — do not save it.",
  high:
    "Save anything durably true about the user to their global memory, shared across all conversations — personal context, preferences, goals, work, environment, stated or implied. Be proactive, but only about the user: content of the current conversation (topics discussed, tasks in progress) is never memory-worthy on its own."
};

export function buildCreateMemoryDescription(rigor: MemoryRigor): string {
  return TOOL_DESCRIPTIONS[rigor] ?? TOOL_DESCRIPTIONS.balanced;
}
