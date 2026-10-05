import { createConversation, createMessageAction, deleteConversation, getMessage, listMessages } from "@/lib/conversations";
import { discoverLibrarySkillRefs, ensureLibraryReady, listLibrarySkills } from "@/lib/skill-library";
import { getCuratorConfig, touchCuratorActivity } from "@/lib/skill-curator";
import { ensureSkillMaintenanceScheduler } from "@/lib/skill-maintenance";
import { getSkillResolvedName, getSkillState, getSkillUsage, isSkillPinned } from "@/lib/skill-runtime";
import type { ChatTurnResult } from "@/lib/chat-turn";
import type { Bot } from "@/lib/types";

export const NOTHING_TO_SAVE = "Nothing to save.";

export const DO_NOT_CAPTURE_BLOCK = `Things that are NOT durable rules and must never become skill content:

  • Environment-dependent failures (missing package, unset env var, wrong working directory, a service that was down). The user can fix these — they are not durable rules.
  • Negative claims about tools or features ('browser tools do not work', 'X tool is broken', 'cannot use Y from execute_code'). These harden into refusals the agent cites against itself for months after the actual problem was fixed.
  • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
  • One-off task narratives. A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill.
  • Unresolved failures: if the session ended WITHOUT actually finding a working method — you tried several things, none worked, and told the user to check manually — do NOT write those attempts up as a 'reliable workflow' or 'recommended approach'. That presents an untested sequence of failures as validated guidance a future session will trust and repeat. Either say 'Nothing to save', or, only if you are independently confident of a real working alternative (not something you are merely guessing might work), capture ONLY that alternative — never the dead ends, and never dressed up as best practice.

If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.`;

export const THREE_HOMES_BLOCK = `Where a lesson belongs — three homes, and a lesson goes in exactly one:

- INSTRUCTIONS govern how you behave: tone, verbosity, language, output format, and standing behavioral directives such as "always answer in French", "always end with next steps", or "use this output format". That is an instruction change — not a skill, and not a memory. This review cannot write instructions; report such a lesson in your summary instead of folding it into a skill.
- MEMORY holds who the user is: identity, environment, long-running projects, stable facts and tastes such as "I'm vegetarian" or "I work in French". Facts, not procedures. This review cannot write memory either; report those in your summary.
- SKILLS hold how to do a class of task for this user: the workflow, the steps, the pitfalls, and which tool to reach for.

When a preference could read either way, treat it as a fact about the user — unless the user explicitly frames it as a standing rule for you.

When they complain about how you handled a task, the skill that governs that task needs to carry the lesson. A user-preference lesson lives in exactly ONE place: the skill that governs the task when one exists, or instructions/memory for a cross-cutting preference no skill owns — never two. Duplicating it is how a memory file ends up restating a SKILL.md until both hit their size limits.`;

export const LESSON_LAYER_BLOCK = `Where a lesson belongs:

A pitfall is a generalizable rule plus one clause of WHY (the mechanism), in the imperative. Not a narrative of what happened this session.

Not a duplicate of what the environment already teaches: repo AGENTS.md files, tool schema descriptions, and settings already carry that. A skill carries the WORKFLOW and the pitfalls; it does not restate the codebase map or a tool's parameter list.

The same lesson learned twice is ONE rule. Before adding, search the skill for the rule it would duplicate, and strengthen or clarify it rather than appending a second copy.

Fix the skill in place when it is wrong — rewrite the wrong rule — and do not append 'UPDATE: actually…'.

${THREE_HOMES_BLOCK}`;

export const SKILL_REVIEW_PROMPT = `Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Target shape of the library: CLASS-LEVEL skills, each with a SKILL.md of always-on rules and a small \`references/\` set of topical depth. Not a flat list of narrow one-session skills, and not an umbrella hoarding a references/ file per session. This shapes HOW you update, not WHETHER you update.

${LESSON_LAYER_BLOCK}

Signals to look for (any one of these warrants action):
  • User corrected your style, tone, format, legibility, or verbosity. Frustration signals like 'stop doing X', 'this is too verbose', 'don't format like this', 'why are you explaining', 'just give me the answer', 'you always do Y and I hate it', or an explicit 'remember this' are FIRST-CLASS skill signals, not just memory signals. Update the relevant skill(s) to embed the preference so the next session starts already knowing.
  • User corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
  • Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from. Capture it.
  • A skill that got loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW.

Preference order — prefer the earliest action that fits, but do pick one when a signal above fired:
  1. UPDATE A CURRENTLY-LOADED SKILL. Look back through the conversation for skills you read with load_skill. If any of them covers the territory of the new learning, PATCH that one first (re-load it with load_skill during this review — see Read-before-write below). It is the skill that was in play, so it's the right one to extend — but only if it is curator-managed. Installed and user-owned skills are off-limits to you no matter how relevant (see below); for those, fall through to the next option.
  2. UPDATE AN EXISTING UMBRELLA. If no loaded skill fits but an existing class-level skill does, patch it. Add a subsection, a pitfall, or broaden a trigger.
  3. ADD A SUPPORT FILE under an existing umbrella. Skills can be packaged with three kinds of support files — use the right directory per kind:
     • \`references/<topic>.md\` — topical depth needed only sometimes: a decision table, a reproduction recipe, provider quirks, condensed domain notes or API excerpts. Name it by TOPIC and extend an existing file when one covers the topic; do not create a per-session or per-incident file, and do not paste error transcripts — distill them to the rule.
     • \`templates/<name>.<ext>\` — starter files meant to be copied and modified (boilerplate configs, scaffolding, a known-good example the agent can reproduce with modifications).
     • \`scripts/<name>.<ext>\` — statically re-runnable actions the skill can invoke directly (verification scripts, fixture generators, deterministic probes, anything the agent should run rather than hand-type each time).
     Add support files via skill_manage action=write_file with file_path starting 'references/', 'templates/', or 'scripts/'. The umbrella's SKILL.md should gain a one-line pointer to any new support file so future agents know it exists.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing skill covers the class. The name MUST be at the class level. The name MUST NOT be a specific PR number, error string, feature codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' session artifact. If the proposed name only makes sense for today's task, it's wrong — fall back to (1), (2), or (3).

Read-before-write (ENFORCED — skill_manage refuses otherwise): before you patch or edit an existing skill's SKILL.md, call load_skill(name) for that skill during this review.

${DO_NOT_CAPTURE_BLOCK}

${THREE_HOMES_BLOCK}

If nothing is worth saving, just say "${NOTHING_TO_SAVE}" and stop. "${NOTHING_TO_SAVE}" is a real option but should NOT be the default. If the session ran smoothly with no corrections and produced no new technique, just say "${NOTHING_TO_SAVE}" and stop. Otherwise, act.`;

export const CURATOR_REVIEW_PROMPT = `Run an UMBRELLA-BUILDING consolidation pass, not a passive audit and not a duplicate-finder.

Consolidation means DISTILLING: the absorbed content becomes rules (imperative + one clause of why). Incident narration, PR/issue numbers, dates and quoted chatter are dropped. Moving a file unchanged under references/ is filing, not consolidating.

DO NOT reject consolidation on the grounds that 'each skill has a distinct trigger' or 'each skill has a unique use case'. Ask instead: 'would a human maintainer write this as N separate skills, or as one skill with N labeled subsections?' When the answer is the latter, merge.

Three moves are available:
  (a) merge into an existing umbrella skill and archive the absorbed siblings;
  (b) create a new class-level umbrella SKILL.md and archive what it absorbs;
  (c) demote to references/<topic>.md (merged into the topical file — never a '<sibling-name>.md' copied verbatim), templates/ or scripts/, then archive.

DO NOT delete any skill. Archiving to .archive/ is the maximum destructive action. Archives are recoverable; deletion is not. A delete requires absorbed_into=<umbrella> naming where the content went; deletes without a verified forwarding target are refused — pruning is the deterministic staleness pass's job, never this one's.

DO NOT touch installed, pinned, or user-owned skills. DO NOT archive, delete or consolidate any essential skill.

If you end the pass with fewer than 10 archives, you stopped too early.`;

export const AUTHORING_STANDARDS = `Skill authoring standards:

- Length: target ~100 lines for a simple skill, ~200 for a complex one.
- A skill exists to make the agent's process more predictable. Optimize for process predictability. If a line does not change behavior, cut it.
- Prune duplication and no-ops. 'Be careful' and 'use best practices' don't change model behavior — replace with a checkable criterion or delete.
- A pitfall is a generalizable rule plus one clause of WHY (the mechanism), imperative. Not a narrative of what happened this session.
- When adding a rule, remove the old wording it replaces. Do not append 'UPDATE: actually…'.
- Prefer extending an existing skill over creating a narrow sibling. Duplicating a peer: survey the category first; extend rather than sibling.
- No router / index / hub skills. If the skill would be empty without 'load skill X instead' pointers, don't write it — the catalog and each sibling's triggers already do that job.
- If the proposed name only makes sense for today's task, it is wrong. The name MUST NOT be a specific PR number, error string, feature codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' session artifact.
- Minimum sections: "## When to Use", an actionable body, "## Pitfalls", "## Verification".
- Front matter: name (must equal the directory name, lowercase letters, digits, hyphens, dots, underscores) and description (the trigger conditions — under 60 characters so it fits the system-prompt budget).

${THREE_HOMES_BLOCK}

${DO_NOT_CAPTURE_BLOCK}`;

export const KNOWLEDGE_SKILL_STANDARDS = `Knowledge-base skill shape:

- One SKILL.md of always-on rules plus a SMALL set of topical depth under references/, templates/ and scripts/.
- Name support files by TOPIC. Extend an existing topical file when one covers the topic — do not create a per-session or per-incident file.
- Do not paste error transcripts; distil them to the rule.
- A knowledge-base SKILL.md indexing its OWN references/ files is fine. A skill that only points at other skills is not.
- Skip anything that would be padding.`;

export const SOURCE_HYGIENE = `Source hygiene:

- Inventory the sources first — the conversation, files read, pages fetched — before writing anything.
- Honour every requirement in the request; if the request is ambiguous about scope, make a reasonable choice and note it. Do not stall.
- After you write the description, COUNT the characters; if it is over 60, cut it down before saving.
- Report when done: the skill name, its category, and a one-line summary of when it applies.`;

export function buildSkillReviewPrompt(turnTranscript: string) {
  return [
    "You are reviewing one completed conversation to decide whether any reusable skill should be created or updated. You have only the skill tools — load_skill and skill_manage — and must not run shell commands. You cannot change this agent's instructions or its memory; when a lesson belongs there, say so in your summary instead of writing a skill.",
    "",
    "=== Conversation to review ===",
    turnTranscript.trim() || "(empty)",
    "=== End of conversation ===",
    "",
    SKILL_REVIEW_PROMPT,
    "",
    "When you are done — including when the answer is the no-op sentinel — reply with exactly one short summary line describing what you changed, or the sentinel."
  ].join("\n");
}

export function buildCuratorConsolidationPrompt(skillCatalog: string) {
  return [
    CURATOR_REVIEW_PROMPT,
    "",
    "=== Current library ===",
    skillCatalog,
    "=== End of library ===",
    "",
    "Reply with a human summary plus a fenced YAML block with 'consolidations:' and 'prunings:' keys."
  ].join("\n");
}

export function buildLearnPrompt(userRequest: string) {
  return [
    "The user wants you to learn a reusable skill from the request below, and save it.",
    "",
    "=== Request ===",
    userRequest.trim(),
    "=== End of request ===",
    "",
    "Steps:",
    "1. Inventory the sources with read_page, file reads and this conversation's history.",
    "1b. Honour all of the request's requirements.",
    "2. Save it with skill_manage. First check the available skills for one covering this source or topic. If one exists, load it with load_skill, then extend it with skill_manage action='patch'. Only when no matching skill exists, create one with skill_manage action='create'.",
    "2b. Pick the shape: one SKILL.md, or a knowledge-base layout with references/, templates/ and scripts/.",
    "",
    SOURCE_HYGIENE,
    "",
    AUTHORING_STANDARDS,
    "",
    KNOWLEDGE_SKILL_STANDARDS,
    "",
    "When done, tell the user the skill name, its category, a one-line summary of when it applies, and any lint findings."
  ].join("\n");
}

export function buildSkillCatalog(ownerUserId: string | null) {
  const skills = listLibrarySkills(ownerUserId, { includeArchived: false });
  if (!skills.length) {
    return "(the library is empty)";
  }

  return skills
    .map((skill) => {
      const usage = getSkillUsage(skill);
      const state = `${getSkillState(skill)}${isSkillPinned(skill) ? " pinned=yes" : ""} ${skill.createdBy ?? "unmanaged"}`;
      return `- ${getSkillResolvedName(skill)} [${state}] use=${usage.useCount} last_used=${usage.lastUsedAt ?? "never"}\n    ${skill.description}`;
    })
    .join("\n");
}

export function buildTurnTranscript(conversationId: string, limit = 40) {
  return listMessages(conversationId)
    .slice(-limit)
    .map((message) => `${message.role}: ${typeof message.content === "string" ? message.content : ""}`)
    .join("\n\n");
}

export type SkillReviewPassInput = {
  bot: Bot;
  sourceConversationId: string;
  sourceAssistantMessageId?: string | null;
  prompt: string;
  startChatTurn: (
    manager: unknown,
    conversationId: string,
    content: string,
    attachmentIds: string[],
    personaId?: string,
    options?: Record<string, unknown>
  ) => Promise<ChatTurnResult>;
  manager: unknown;
};

const REVIEW_CONVERSATION_TITLE = "Skill review";

export const SKILL_REVIEW_TOOLS = ["load_skill", "skill_manage"];

export async function runSkillReviewPass(input: SkillReviewPassInput): Promise<string> {
  ensureLibraryReady(input.bot.userId ?? null);
  const reviewConversation = createConversation(
    REVIEW_CONVERSATION_TITLE,
    null,
    { origin: "automation", isTemporary: true, providerProfileId: null },
    input.bot.userId ?? undefined
  );

  try {
    await input.startChatTurn(input.manager, reviewConversation.id, input.prompt, [], undefined, {
      unattended: true,
      quietWhenBusy: true,
      toolAllowlist: SKILL_REVIEW_TOOLS,
      skillOwnerUserId: input.bot.userId ?? null,
      botRun: { record: false }
    });

    const reviewMessages = listMessages(reviewConversation.id);
    const lastAssistant = [...reviewMessages].reverse().find((message) => message.role === "assistant");
    const summary = typeof lastAssistant?.content === "string" ? lastAssistant.content.trim() : NOTHING_TO_SAVE;

    if (input.sourceAssistantMessageId) {
      const sourceMessage = getMessage(input.sourceAssistantMessageId);
      if (sourceMessage) {
        createMessageAction({
          messageId: input.sourceAssistantMessageId,
          kind: "skill_review",
          status: "completed",
          label: "Skill review",
          detail: summary.split("\n")[0] ?? NOTHING_TO_SAVE,
          resultSummary: summary,
          sortOrder: 9999
        });
      }
    }

    return summary;
  } finally {
    deleteConversation(reviewConversation.id, input.bot.userId ?? undefined);
  }
}

export async function scheduleSkillReview(input: {
  bot: Bot;
  conversationId: string;
  assistantMessageId: string | null;
  memoryUserId?: string | null;
}) {
  touchCuratorActivity(input.bot.userId ?? null);
  ensureSkillMaintenanceScheduler();

  const config = getCuratorConfig();
  if (!config.backgroundReview.enabled || !config.enabled) {
    return null;
  }

  const prompt = buildSkillReviewPrompt(buildTurnTranscript(input.conversationId));
  const [{ startChatTurn }, { getConversationManager }] = await Promise.all([
    import("@/lib/chat-turn"),
    import("@/lib/ws-singleton")
  ]);

  return runSkillReviewPass({
    bot: input.bot,
    sourceConversationId: input.conversationId,
    sourceAssistantMessageId: input.assistantMessageId,
    prompt,
    manager: getConversationManager(),
    startChatTurn: startChatTurn as never
  }).catch((error) => {
    console.error("Skill review pass failed", error);
    return null;
  });
}

export function libraryStats(ownerUserId: string | null) {
  const refs = discoverLibrarySkillRefs(ownerUserId);
  const skills = listLibrarySkills(ownerUserId);
  return {
    total: refs.length,
    active: skills.filter((skill) => getSkillState(skill) === "active").length,
    stale: skills.filter((skill) => getSkillState(skill) === "stale").length,
    archived: skills.filter((skill) => getSkillState(skill) === "archived").length
  };
}
