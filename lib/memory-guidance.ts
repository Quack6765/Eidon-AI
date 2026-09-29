import type { MemoryRigor } from "@/lib/types";

const MEMORY_SCOPE_RULE =
  "Memory is global, not tied to this conversation: memories are re-injected into every future conversation, while each new conversation otherwise starts without this conversation's context. Anything you save becomes permanent context everywhere, so a detail that only mattered here turns into noise in every other chat.";

const RELEVANCE_GATE =
  "Propose a memory only when it would change your answer in a future conversation unrelated to this one. Test each candidate fact twice:\n" +
  "1. Cross-conversation: would this still matter weeks from now, in a different chat? Facts that matter only for this task, this project, or this discussion stay in the conversation — keep using them here and save nothing.\n" +
  "2. About the user, not the topic: save facts about the person (identity, environment, stable preferences). Do not save the subject matter being discussed — the contents of a document or codebase the user shared, choices made while working together, or anything you can simply re-read above.";

const INSTRUCTIONS_VS_MEMORY =
  "Your instructions say how you work; memory says who you are working for. Identity, role, workflow, output format, and standing behavioral directives live in your instructions — stable by design, changed rarely and deliberately. Memory holds durable facts about the user and their world that your instructions do not already state.\n" +
  "Apply that split whenever you learn something:\n" +
  "1. Already covered: if the fact is already stated in your instructions, or would only restate, paraphrase, or specialize them, propose nothing — memory adds to your instructions, never copies them. The same applies to updates: never rewrite a memory to mirror your instructions.\n" +
  "2. A standing directive about how you must behave (\"always answer in French\", \"always end with next steps\", \"use this output format\") is an instruction change, not a memory: apply it with update_own_instructions and tell the user what you changed (the chief of staff changes a teammate's rules with update_bot) — or, if you cannot edit your own instructions, tell the user the rule belongs there instead of remembering it. Memory never holds behavior rules.\n" +
  "3. A fact about the user (identity, environment, projects, goals, relationships, constraints, tastes and dislikes — \"I'm vegetarian\", \"I work in French\", \"prefers concise answers\") is a memory, subject to the gates above.";

const WORTH_OFFERING =
  "Some facts are worth remembering precisely because they stay true and matter later: birthdays and important dates, things the user dislikes or is annoyed by, favourite things, allergies and dietary needs, family and relationships, and constraints they work around (hardware, tools, health, schedule). Whenever the user mentions one of these, offer to remember it — these already pass both tests, so they are the cases where you should be proactive rather than hesitant.";

const NEVER_SAVE =
  "Never propose a memory for: current task state (files, branches, commands, errors, next steps); one-off requests that apply only here; a recap of this conversation; or secrets such as passwords, API keys, and tokens unless the user explicitly asks you to remember them. Proposing nothing is the normal outcome — most turns need no memory call, and do not mention memory in a reply that proposes nothing.";

const DURABLE_FACT_EXAMPLES =
  "name, location, timezone, language, profession or role, long-running projects and goals (what they are, not their implementation details), skills, and stable preferences (how they like things done, formatting, tools, or communication style)";

const SYSTEM_GUIDANCE: Record<MemoryRigor, string> = {
  low:
    "Only propose a memory when the user explicitly asks you to remember something, or when a fact is unmistakably durable and recurring — a birthday or a stated dislike counts, as does a correction to their name, location, or timezone. Otherwise, do not propose memories.",
  balanced:
    `Proactively capture durable facts about the user that will recur in unrelated future conversations — ${DURABLE_FACT_EXAMPLES}, plus anything from the worth-remembering list above. When the user states or reveals such a fact for the first time, or corrects a fact you already know, propose a memory in the same response.`,
  high:
    "Propose memory eagerly within the same tests. Whenever the user reveals durable personal context, preferences, goals, long-running work, their environment, or recurring needs — even if only implied — propose a memory so unrelated future conversations benefit. Raise how much of the user you capture, never how much of this conversation you capture."
};

const DEDUPE_RULE =
  "Before creating a new memory, check the memories listed above (if any): if a similar fact already exists, update it instead of creating a duplicate. When updating, rewrite the memory so it still reads as a general fact about the user, and never append detail that only makes sense inside this conversation.";

const PROPOSAL_MODEL_NOTE =
  "Calling these tools is how you offer to remember something: each call shows the user a card with the exact fact, which they can approve, edit, or dismiss, and nothing is written until they approve. Propose it in the same response rather than asking for permission in words first, and never claim you saved, updated, or deleted a memory without calling the matching tool in that same response. The user can review and manage all memories and proposals in their settings.";

export function buildMemorySystemGuidance(rigor: MemoryRigor): string {
  const base = SYSTEM_GUIDANCE[rigor] ?? SYSTEM_GUIDANCE.balanced;
  return [
    "You have access to memory tools (create_memory, update_memory, delete_memory) to propose changes to the user's long-term memory.",
    MEMORY_SCOPE_RULE,
    RELEVANCE_GATE,
    INSTRUCTIONS_VS_MEMORY,
    WORTH_OFFERING,
    NEVER_SAVE,
    base,
    DEDUPE_RULE,
    PROPOSAL_MODEL_NOTE
  ].join("\n\n");
}

const TOOL_DESCRIPTIONS: Record<MemoryRigor, string> = {
  low:
    "Propose a new long-term memory about the user; the call itself is the offer, showing them a card they approve, edit, or dismiss. Memories are global and re-injected into every future conversation, so use this only when the user explicitly asks you to remember something, or states something unmistakably durable such as a birthday or a lasting dislike. Never save anything that only matters in this conversation. Never propose what your instructions already state — memory adds to them, never copies them.",
  balanced:
    "Propose a new long-term memory about the user; the call itself is the offer, showing them a card they approve, edit, or dismiss. Propose durable facts that will still matter in an unrelated future conversation — name, location, timezone, language, role, long-running goals, stable preferences — and the inherently memorable ones: birthdays and important dates, dislikes, favourites, allergies, family, and constraints. Never save the topic being discussed, current task state, or anything that only matters in this conversation. Never propose what your instructions already state — memory adds to them, never copies them.",
  high:
    "Propose a new long-term memory about the user; the call itself is the offer, showing them a card they approve, edit, or dismiss. Propose eagerly for durable personal context, preferences, goals, ongoing work, environment, and recurring needs — stated or implied — including inherently memorable facts such as birthdays, dislikes, favourites, allergies, family, and constraints. Capture more about the user, never more about this conversation. Never propose what your instructions already state — memory adds to them, never copies them."
};

export function buildCreateMemoryDescription(rigor: MemoryRigor): string {
  return TOOL_DESCRIPTIONS[rigor] ?? TOOL_DESCRIPTIONS.balanced;
}
