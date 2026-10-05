import {
  AUTHORING_STANDARDS,
  KNOWLEDGE_SKILL_STANDARDS,
  SOURCE_HYGIENE
} from "@/lib/skill-review";
import { createLibrarySkill, findLibrarySkill, readLibrarySkill, skillRefLeaf } from "@/lib/skill-library";
import { recordInstalled, setPinned } from "@/lib/skill-usage";

export const SKILL_AUTHORING_REF = "skill-authoring";

export const SKILL_AUTHORING_DESCRIPTION =
  "Use when the user asks to learn, capture, save, teach or write a reusable skill.";

export const SKILL_AUTHORING_CONTENT = `---
name: skill-authoring
description: Use when the user asks to learn, capture, save, teach or write a reusable skill.
author: eidon
version: 1
tags: [meta, authoring]
---

# Skill authoring

Write a reusable skill from a conversation, a request, or a body of source material.

## When to Use

- The user says "learn this", "save that as a skill", "capture this workflow", "teach this", or asks you to write a skill.
- You are about to distil a recurring workflow into instructions a future session can follow.

Load this skill first, then follow the procedure below. Creation is the LAST resort: extend an existing skill whenever one covers the class of task.

## Procedure

1. Inventory the sources first — this conversation, files read, pages fetched — before writing anything.
2. Honour every requirement in the request. If the request is ambiguous about scope, make a reasonable choice and note it. Do not stall.
3. Check the available skills for one covering this source or topic. If one exists, load it with \`load_skill\`, then extend it with \`skill_manage\` action="patch". Only when no matching skill exists, create one with \`skill_manage\` action="create".
4. Pick the shape: a single SKILL.md, or a knowledge-base layout with \`references/\`, \`templates/\` and \`scripts/\`.
5. Report when done: the skill name, its category, a one-line summary of when it applies, and any lint findings.

Read-before-write is ENFORCED: before patching an existing skill's SKILL.md, call \`load_skill\` for that skill in the same turn.

${SOURCE_HYGIENE}

${AUTHORING_STANDARDS}

${KNOWLEDGE_SKILL_STANDARDS}

## Pitfalls

- Writing a narrow one-session skill. If the proposed name only makes sense for today's task, it is wrong.
- Creating a near-sibling instead of extending the umbrella that already owns the class.
- Appending a second copy of a rule the skill already carries. The same lesson learned twice is ONE rule — strengthen or clarify it.
- Restating a tool's parameter list or the codebase map. A skill carries the WORKFLOW and the pitfalls.
- Putting a user preference in two places. It lives in the skill that governs the task, or in memory for cross-cutting preferences no skill owns — never both.
- Filing instead of consolidating: moving text unchanged under \`references/\` is not distilling.

## Verification

- The name is at class level and matches its directory exactly.
- The description states trigger conditions and fits in 60 characters.
- Every sentence changes behavior versus the default; no "be careful", no "use best practices".
- The skill has "## When to Use", an actionable body, "## Pitfalls" and "## Verification".
- Nothing in the do-not-capture list slipped in.
`;

export function ensureAuthoringSkillInstalled(ownerUserId: string | null) {
  const existing = findLibrarySkill(ownerUserId, SKILL_AUTHORING_REF);
  if (existing && skillRefLeaf(existing.ref) === SKILL_AUTHORING_REF) {
    return existing.skill;
  }

  const created = createLibrarySkill(ownerUserId, {
    name: SKILL_AUTHORING_REF,
    content: SKILL_AUTHORING_CONTENT,
    actor: "curator",
    agentAuthored: false
  });

  if ("error" in created) {
    return null;
  }

  recordInstalled(ownerUserId, created.ref);
  setPinned(ownerUserId, created.ref, true);
  return readLibrarySkill(ownerUserId, created.ref);
}
