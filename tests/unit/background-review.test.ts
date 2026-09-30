import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat-turn", () => ({ startChatTurn: vi.fn() }));
vi.mock("@/lib/ws-singleton", () => ({ getConversationManager: vi.fn(() => ({})) }));

import {
  AUTHORING_STANDARDS,
  buildCuratorConsolidationPrompt,
  buildLearnPrompt,
  buildSkillCatalog,
  buildSkillReviewPrompt,
  CURATOR_REVIEW_PROMPT,
  DO_NOT_CAPTURE_BLOCK,
  libraryStats,
  NOTHING_TO_SAVE,
  scheduleSkillReview,
  SKILL_REVIEW_PROMPT,
  SKILL_REVIEW_TOOLS,
  THREE_HOMES_BLOCK
} from "@/lib/skill-review";
import {
  SKILL_AUTHORING_CONTENT,
  SKILL_AUTHORING_DESCRIPTION,
  SKILL_AUTHORING_REF,
  ensureAuthoringSkillInstalled
} from "@/lib/skill-authoring";
import { buildSkillMarkdown, createLibrarySkill, ensureLibraryReady, listLibrarySkills } from "@/lib/skill-library";
import { setPinned } from "@/lib/skill-usage";
import {
  createConversation,
  createMessage,
  listMessageActionsForMessageIds,
  listMessages
} from "@/lib/conversations";
import { createBot } from "@/lib/bots";
import { createLocalUser } from "@/lib/users";

const owner = "user_review_a";

describe("skill review prompts", () => {
  describe("the do-not-capture block", () => {
    it("refuses one-off task narratives", () => {
      expect(DO_NOT_CAPTURE_BLOCK).toContain("One-off task narratives.");
      expect(DO_NOT_CAPTURE_BLOCK).toContain(
        "A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill."
      );
    });

    it("refuses negative claims about tools", () => {
      expect(DO_NOT_CAPTURE_BLOCK).toContain("Negative claims about tools or features");
      expect(DO_NOT_CAPTURE_BLOCK).toContain(
        "These harden into refusals the agent cites against itself for months after the actual problem was fixed."
      );
    });

    it("refuses transient and environment-dependent failures", () => {
      expect(DO_NOT_CAPTURE_BLOCK).toContain("Session-specific transient errors that resolved before the conversation ended.");
      expect(DO_NOT_CAPTURE_BLOCK).toContain("Environment-dependent failures");
    });

    it("refuses unresolved failures dressed up as a workflow", () => {
      expect(DO_NOT_CAPTURE_BLOCK).toContain("Unresolved failures:");
      expect(DO_NOT_CAPTURE_BLOCK).toContain("do NOT write those attempts up as a 'reliable workflow'");
    });

    it("is carried by both the review and the authoring standards", () => {
      expect(SKILL_REVIEW_PROMPT).toContain("One-off task narratives.");
      expect(AUTHORING_STANDARDS).toContain("One-off task narratives.");
    });
  });

  describe("the preference order", () => {
    it("makes creation the last resort", () => {
      const create = SKILL_REVIEW_PROMPT.indexOf("4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL");
      const patchLoaded = SKILL_REVIEW_PROMPT.indexOf("1. UPDATE A CURRENTLY-LOADED SKILL");
      const patchUmbrella = SKILL_REVIEW_PROMPT.indexOf("2. UPDATE AN EXISTING UMBRELLA");
      const supportFile = SKILL_REVIEW_PROMPT.indexOf("3. ADD A SUPPORT FILE");

      expect(patchLoaded).toBeGreaterThan(-1);
      expect(patchUmbrella).toBeGreaterThan(patchLoaded);
      expect(supportFile).toBeGreaterThan(patchUmbrella);
      expect(create).toBeGreaterThan(supportFile);
    });

    it("names the support file directories", () => {
      expect(SKILL_REVIEW_PROMPT).toContain("references/<topic>.md");
      expect(SKILL_REVIEW_PROMPT).toContain("templates/<name>.<ext>");
      expect(SKILL_REVIEW_PROMPT).toContain("scripts/<name>.<ext>");
    });

    it("enforces read-before-write", () => {
      expect(SKILL_REVIEW_PROMPT).toContain("Read-before-write (ENFORCED — skill_manage refuses otherwise)");
    });
  });

  describe("class-level naming", () => {
    it("forbids session-artifact names", () => {
      expect(SKILL_REVIEW_PROMPT).toContain("The name MUST be at the class level.");
      expect(SKILL_REVIEW_PROMPT).toContain("The name MUST NOT be a specific PR number, error string, feature codename");
      expect(SKILL_REVIEW_PROMPT).toContain("If the proposed name only makes sense for today's task, it's wrong");
      expect(AUTHORING_STANDARDS).toContain("No router / index / hub skills.");
      expect(AUTHORING_STANDARDS).toContain("Prefer extending an existing skill over creating a narrow sibling.");
    });
  });

  describe("the do-nothing default", () => {
    it("offers the sentinel without making it the default", () => {
      expect(NOTHING_TO_SAVE).toBe("Nothing to save.");
      expect(SKILL_REVIEW_PROMPT).toContain(`just say "${NOTHING_TO_SAVE}" and stop`);
      expect(SKILL_REVIEW_PROMPT).toContain(
        `"${NOTHING_TO_SAVE}" is a real option but should NOT be the default`
      );
      expect(SKILL_REVIEW_PROMPT).toContain("Be ACTIVE — most sessions produce at least one skill update");
    });
  });

  describe("the memory boundary", () => {
    it("separates memory from skills and forbids duplicating a lesson", () => {
      expect(SKILL_REVIEW_PROMPT).toContain("Where a lesson belongs — three homes");
      expect(SKILL_REVIEW_PROMPT).toContain("A user-preference lesson lives in exactly ONE place");
      expect(SKILL_REVIEW_PROMPT).toContain("The same lesson learned twice is ONE rule");
    });
  });

  describe("evidence and justification", () => {
    it("carries no repetition threshold or recurrence counter", () => {
      const haystack = `${SKILL_REVIEW_PROMPT}\n${AUTHORING_STANDARDS}\n${DO_NOT_CAPTURE_BLOCK}`.toLowerCase();
      expect(haystack).not.toContain("repetition threshold");
      expect(haystack).not.toContain("recurrence count");
      expect(haystack).not.toContain("times_observed");
      expect(haystack).not.toContain("repeated 3 times");
    });
  });

  describe("the consolidation pass", () => {
    it("is umbrella-building and never deletes", () => {
      expect(CURATOR_REVIEW_PROMPT).toContain(
        "UMBRELLA-BUILDING consolidation pass, not a passive audit and not a duplicate-finder"
      );
      expect(CURATOR_REVIEW_PROMPT).toContain("DO NOT delete any skill.");
      expect(CURATOR_REVIEW_PROMPT).toContain("Archiving to .archive/ is the maximum destructive action.");
      expect(CURATOR_REVIEW_PROMPT).toContain("deletes without a verified forwarding target are refused");
      expect(CURATOR_REVIEW_PROMPT).toContain("fewer than 10 archives, you stopped too early");
      expect(CURATOR_REVIEW_PROMPT).toContain("would a human maintainer write this as N separate skills");
    });
  });

  it("wraps a transcript into a review prompt", () => {
    const prompt = buildSkillReviewPrompt("user: research this site\nassistant: done");
    expect(prompt).toContain("=== Conversation to review ===");
    expect(prompt).toContain("user: research this site");
    expect(prompt).toContain(SKILL_REVIEW_PROMPT);
  });

  it("wraps the library into a consolidation prompt", () => {
    expect(buildCuratorConsolidationPrompt("- deploy [active unmanaged]")).toContain("=== Current library ===");
  });

  it("builds a learn prompt carrying the source hygiene and authoring standards", () => {
    const prompt = buildLearnPrompt("learn how we pull release notes");
    expect(prompt).toContain("=== Request ===");
    expect(prompt).toContain("learn how we pull release notes");
    expect(prompt).toContain("Source hygiene:");
    expect(prompt).toContain(AUTHORING_STANDARDS);
  });
});

describe("skill catalog and stats", () => {
  it("describes each skill with its lifecycle and provenance", () => {
    ensureLibraryReady(owner);
    createLibrarySkill(owner, {
      name: "catalogued",
      content: buildSkillMarkdown("catalogued", "Trigger.", "Body."),
      agentAuthored: true
    });
    createLibrarySkill(owner, {
      name: "hand-written",
      content: buildSkillMarkdown("hand-written", "Trigger.", "Body."),
      agentAuthored: false
    });
    setPinned(owner, "catalogued", true);

    const catalog = buildSkillCatalog(owner);
    expect(catalog).toContain("catalogued [active pinned=yes agent]");
    expect(catalog).toContain("hand-written [active learn]");

    expect(libraryStats(owner)).toMatchObject({ active: 2, stale: 0, archived: 0 });
  });

  it("reports an empty library rather than failing", () => {
    expect(buildSkillCatalog("user_review_empty")).toBe("(the library is empty)");
    expect(libraryStats("user_review_empty")).toEqual({ total: 0, active: 0, stale: 0, archived: 0 });
  });
});

const authoringOwner = "user_review_b";

describe("the bundled skill-authoring skill", () => {
  it("ships the authoring standards and is pinned and installed", () => {
    ensureLibraryReady(authoringOwner);
    const skill = ensureAuthoringSkillInstalled(authoringOwner);
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe(SKILL_AUTHORING_REF);
    expect(skill?.description).toBe(SKILL_AUTHORING_DESCRIPTION);
    expect(skill?.pinned).toBe(true);
    expect(skill?.createdBy).toBe("installed");
    expect(SKILL_AUTHORING_CONTENT).toContain("## When to Use");
    expect(SKILL_AUTHORING_CONTENT).toContain("## Pitfalls");
    expect(SKILL_AUTHORING_CONTENT).toContain("## Verification");
    expect(SKILL_AUTHORING_CONTENT).toContain(AUTHORING_STANDARDS);
  });

  it("is idempotent", () => {
    ensureLibraryReady(authoringOwner);
    ensureAuthoringSkillInstalled(authoringOwner);
    const second = ensureAuthoringSkillInstalled(authoringOwner);
    expect(second).not.toBeNull();
    expect(listLibrarySkills(authoringOwner).filter((entry) => entry.name === SKILL_AUTHORING_REF)).toHaveLength(1);
  });
});

describe("the review pass", () => {
  it("runs in a throwaway conversation, records one skill_review action, and cleans up", async () => {
    const { runSkillReviewPass } = await import("@/lib/skill-review");
    const user = await createLocalUser({
      username: `review-pass-${Math.random().toString(36).slice(2, 8)}`,
      password: "password-123",
      role: "user" as const
    });
    const bot = createBot({ name: `Reviewer ${Math.random().toString(36).slice(2, 6)}` }, user.id);
    const source = createConversation("source", undefined, undefined, user.id);
    const sourceMessage = createMessage({ conversationId: source.id, role: "assistant", content: "" });

    const calls: Array<{ conversationId: string; options?: Record<string, unknown> }> = [];
    const startChatTurn = async (
      _manager: unknown,
      conversationId: string,
      _content: string,
      _attachmentIds: string[],
      _personaId?: string,
      options?: Record<string, unknown>
    ) => {
      calls.push({ conversationId, options });
      createMessage({ conversationId, role: "assistant", content: "Updated skill deploy." });
      return { status: "completed" as const };
    };

    const summary = await runSkillReviewPass({
      bot,
      sourceConversationId: source.id,
      sourceAssistantMessageId: sourceMessage.id,
      prompt: "review this",
      manager: {},
      startChatTurn: startChatTurn as never
    });

    expect(summary).toBe("Updated skill deploy.");
    expect(calls).toHaveLength(1);
    expect(calls[0].conversationId).not.toBe(source.id);
    expect(calls[0].options).toMatchObject({ unattended: true, quietWhenBusy: true, botRun: { record: false } });

    const actions = listMessageActionsForMessageIds([sourceMessage.id]).filter(
      (action) => action.kind === "skill_review"
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      label: "Skill review",
      status: "completed",
      detail: "Updated skill deploy.",
      resultSummary: "Updated skill deploy."
    });

    const leftovers = listMessages(calls[0].conversationId);
    expect(leftovers).toHaveLength(0);
  });

  it("falls back to the no-op sentinel when the pass says nothing", async () => {
    const { runSkillReviewPass, NOTHING_TO_SAVE } = await import("@/lib/skill-review");
    const user = await createLocalUser({
      username: `review-quiet-${Math.random().toString(36).slice(2, 8)}`,
      password: "password-123",
      role: "user" as const
    });
    const bot = createBot({ name: `Quiet ${Math.random().toString(36).slice(2, 6)}` }, user.id);
    const source = createConversation("quiet", undefined, undefined, user.id);

    const summary = await runSkillReviewPass({
      bot,
      sourceConversationId: source.id,
      sourceAssistantMessageId: null,
      prompt: "review this",
      manager: {},
      startChatTurn: (async () => ({ status: "completed" as const })) as never
    });

    expect(summary).toBe(NOTHING_TO_SAVE);
  });
});

describe("the background review scheduler", () => {
  it("does not start a review turn when skill maintenance has it switched off", async () => {
    const { startChatTurn } = await import("@/lib/chat-turn");

    await expect(
      scheduleSkillReview({
        bot: { id: "bot_review", userId: owner } as never,
        conversationId: "conv_review",
        assistantMessageId: null
      })
    ).resolves.toBeNull();

    expect(startChatTurn).not.toHaveBeenCalled();
  });
});


describe("the review turn is restricted to skill tools", () => {
  it("allows only load_skill and skill_manage", () => {
    expect(SKILL_REVIEW_TOOLS).toEqual(["load_skill", "skill_manage"]);
  });

  it("passes the allowlist through to the turn", async () => {
    const { runSkillReviewPass } = await import("@/lib/skill-review");
    const { startChatTurn } = await import("@/lib/chat-turn");
    vi.mocked(startChatTurn).mockClear();

    const user = await createLocalUser({
      username: `review-tools-${Math.random().toString(36).slice(2, 8)}`,
      password: "password-123",
      role: "user" as const
    });
    const bot = createBot({ name: `Tools ${Math.random().toString(36).slice(2, 6)}` }, user.id);
    const source = createConversation("tools", undefined, undefined, user.id);

    await runSkillReviewPass({
      bot,
      sourceConversationId: source.id,
      sourceAssistantMessageId: null,
      prompt: "review this",
      manager: {},
      startChatTurn: startChatTurn as never
    });

    expect(vi.mocked(startChatTurn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startChatTurn).mock.calls[0]?.[5]).toMatchObject({
      toolAllowlist: ["load_skill", "skill_manage"]
    });
  });

  it("still builds the skill tools for a review turn that has no bot", async () => {
    const { buildToolDefinitions } = await import("@/lib/tool-definitions");

    // A background review runs in a scratch conversation with no bot, so the
    // usual `skillsEnabled && Boolean(bot)` gate is false and no skills are
    // listed. The allowlist must still produce both tools, or the pass can
    // read a skill but never write one.
    const names = buildToolDefinitions({
      mcpToolSets: [],
      skills: [],
      loadedSkillIds: new Set<string>(),
      memoriesEnabled: true,
      skillManageEnabled: false,
      botWorkspaceSkillsEnabled: false,
      effectiveVisionMode: "none" as const,
      toolAllowlist: ["load_skill", "skill_manage"]
    }).map((tool) => tool.function.name);

    expect(names.sort()).toEqual(["load_skill", "skill_manage"]);
  });

  it("drops every other tool from the definition list", async () => {
    const { buildToolDefinitions } = await import("@/lib/tool-definitions");
    const input = {
      mcpToolSets: [],
      skills: [{ id: "s1", name: "a-skill", description: "d", content: "c", enabled: true, createdAt: "", updatedAt: "" }],
      loadedSkillIds: new Set<string>(),
      memoriesEnabled: true,
      skillManageEnabled: true,
      effectiveVisionMode: "none" as const
    };

    const unrestricted = buildToolDefinitions(input).map((tool) => tool.function.name);
    expect(unrestricted).toContain("create_memory");
    expect(unrestricted).toContain("skill_manage");

    const restricted = buildToolDefinitions({ ...input, toolAllowlist: ["load_skill", "skill_manage"] }).map(
      (tool) => tool.function.name
    );
    expect(restricted.sort()).toEqual(["load_skill", "skill_manage"]);
    expect(restricted).not.toContain("create_memory");
  });
});

describe("a lesson goes in exactly one home", () => {
  it("names the three homes and refuses to write outside skills", () => {
    expect(SKILL_REVIEW_PROMPT).toContain("Where a lesson belongs — three homes");
    expect(THREE_HOMES_BLOCK).toContain("INSTRUCTIONS govern how you behave");
    expect(THREE_HOMES_BLOCK).toContain("MEMORY holds who the user is");
    expect(THREE_HOMES_BLOCK).toContain("SKILLS hold how to do a class of task for this user");
    expect(THREE_HOMES_BLOCK).toContain("treat it as a fact about the user — unless the user explicitly frames it as a standing rule");
    expect(THREE_HOMES_BLOCK).toContain("never two");
    expect(buildSkillReviewPrompt("user: hello")).toContain(
      "You cannot change this agent's instructions or its memory"
    );
  });

  it("sends instruction and memory lessons to the summary instead of a skill", () => {
    const prompt = buildSkillReviewPrompt("user: stop being so verbose");
    expect(prompt).toContain("report such a lesson in your summary instead of folding it into a skill");
    expect(prompt).toContain("report those in your summary");
  });

  it("carries the rule into the explicit authoring path too", () => {
    expect(AUTHORING_STANDARDS).toContain("Where a lesson belongs — three homes");
  });

  it("replaced the old memory-versus-skills wording rather than duplicating it", () => {
    expect(SKILL_REVIEW_PROMPT).not.toContain("Memory versus skills:");
    expect(SKILL_REVIEW_PROMPT).not.toContain("memory captures 'who the user is");
  });
});
