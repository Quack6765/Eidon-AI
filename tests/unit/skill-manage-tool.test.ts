import { existsSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { createBot } from "@/lib/bots";
import { createLocalUser } from "@/lib/users";
import {
  buildSkillMarkdown,
  ensureLibraryReady,
  findLibrarySkill,
  listLibrarySkills,
  readLedger,
  skillDirPath
} from "@/lib/skill-library";
import { normalizeSkillOperation, SKILL_MANAGE_BATCH_MAX_OPS } from "@/lib/skill-operation";
import { recordCreated, setPinned } from "@/lib/skill-usage";
import { executeSkillManage, type RuntimeAction } from "@/lib/tool-executors";
import type { PromptMessage, Skill } from "@/lib/types";

type Ctx = ReturnType<typeof buildContext>["context"];

function buildContext(conversationId?: string) {
  const actions: RuntimeAction[] = [];
  const completions: Array<{ handle?: string; patch: { detail?: string; resultSummary?: string } }> = [];
  const failures: Array<{ handle?: string; patch: { detail?: string; resultSummary?: string } }> = [];

  const context = {
    input: {
      conversationId,
      skills: undefined as Skill[] | undefined,
      skillWriteOrigin: "foreground" as "foreground" | "background-review",
      onActionStart: (action: RuntimeAction) => {
        actions.push(action);
        return `handle_${actions.length}`;
      },
      onActionComplete: async (
        handle: string | undefined,
        patch: { detail?: string; resultSummary?: string }
      ) => {
        completions.push({ handle, patch });
      },
      onActionError: async (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => {
        failures.push({ handle, patch });
      }
    },
    loadedSkillIds: new Set<string>(),
    timelineSortOrder: 0,
    promptMessages: [] as PromptMessage[]
  };

  return { actions, completions, failures, context };
}

function resultText(promptMessages: PromptMessage[]) {
  const last = promptMessages.at(-1);
  expect(last?.role).toBe("tool");
  return typeof last?.content === "string" ? last.content : "";
}

async function run(
  context: Ctx,
  operations: Array<Record<string, unknown>>
) {
  return executeSkillManage("call_1", { operations }, context);
}

describe("skill_manage tool", () => {
  let conversationId: string;
  let ownerUserId: string | null;

  beforeEach(async () => {
    const user = await createLocalUser({
      username: `skill-manage-${Math.random().toString(36).slice(2, 8)}`,
      password: "password-123",
      role: "user" as const
    });
    const bot = createBot({ name: `Bot ${Math.random().toString(36).slice(2, 6)}` }, user.id);
    conversationId = bot.homeConversationId;
    ownerUserId = bot.userId ?? null;
    ensureLibraryReady(ownerUserId);
  });

  function ref(name: string) {
    return findLibrarySkill(ownerUserId, name)?.ref ?? name;
  }

  it("creates a skill folder with SKILL.md and emits a skill_manage action", async () => {
    const { context, actions, completions } = buildContext(conversationId);
    const result = await run(context, [
      { name: "release-notes", action: "create", content: buildSkillMarkdown("release-notes", "When releasing.", "# Body") }
    ]);

    expect(result.toolSucceeded).toBe(true);
    expect(existsSync(join(skillDirPath(ownerUserId!, "release-notes"), "SKILL.md"))).toBe(true);
    expect(actions[0].kind).toBe("skill_manage");
    expect(completions[0].patch.resultSummary).toContain("created");
  });

  it("writes the skill through the tool dispatch path", async () => {
    const { executeToolCall } = await import("@/lib/tool-executors");
    const { context } = buildContext(conversationId);
    const result = await executeToolCall(
      {
        id: "call_dispatch",
        name: "skill_manage",
        arguments: JSON.stringify({
          operations: [
            { name: "dispatched", action: "create", content: buildSkillMarkdown("dispatched", "Via dispatch.", "Body.") }
          ]
        })
      } as never,
      context as never
    );
    expect(resultText(result.promptMessages)).toContain("created");
  });

  it("patches with old_string and new_string", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "patch-me", action: "create", content: buildSkillMarkdown("patch-me", "Trigger.", "Alpha.") }
    ]);
    const result = await run(context, [
      { name: "patch-me", action: "patch", old_string: "Alpha.", new_string: "Beta." }
    ]);
    expect(resultText(result.promptMessages)).toContain("(1 replacement(s).)");
    expect(findLibrarySkill(ownerUserId, "patch-me")?.skill.content).toContain("Beta.");
  });

  it("rewrites the whole SKILL.md with patch content", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "rewrite", action: "create", content: buildSkillMarkdown("rewrite", "Trigger.", "Old.") }
    ]);
    const result = await run(context, [
      { name: "rewrite", action: "patch", content: buildSkillMarkdown("rewrite", "Trigger.", "New.") }
    ]);
    expect(resultText(result.promptMessages)).toContain("updated (full rewrite)");
  });

  it("writes and removes supporting files under an allowed subdirectory", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "with-files", action: "create", content: buildSkillMarkdown("with-files", "Trigger.", "Body.") }
    ]);

    const written = await run(context, [
      { name: "with-files", action: "write_file", file_path: "references/api.md", file_content: "notes" }
    ]);
    expect(resultText(written.promptMessages)).toContain("written to skill");

    const removed = await run(context, [
      { name: "with-files", action: "remove_file", file_path: "references/api.md" }
    ]);
    expect(resultText(removed.promptMessages)).toContain("removed from skill");
  });

  it("refuses path traversal", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "safe", action: "create", content: buildSkillMarkdown("safe", "Trigger.", "Body.") }
    ]);
    const result = await run(context, [
      { name: "safe", action: "write_file", file_path: "references/../../escape.md", file_content: "x" }
    ]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("Path traversal");
  });

  it("hard-deletes in the foreground and archives in a background review", async () => {
    const foreground = buildContext(conversationId);
    await run(foreground.context, [
      { name: "gone", action: "create", content: buildSkillMarkdown("gone", "Trigger.", "Body.") }
    ]);
    const deleted = await run(foreground.context, [{ name: "gone", action: "delete" }]);
    expect(resultText(deleted.promptMessages)).toContain("deleted.");
    expect(findLibrarySkill(ownerUserId, "gone")).toBeNull();

    const background = buildContext(conversationId);
    background.context.input.skillWriteOrigin = "background-review";
    await run(background.context, [
      { name: "archived", action: "create", content: buildSkillMarkdown("archived", "Trigger.", "Body.") }
    ]);
    recordCreated(ownerUserId!, "archived", { agentCreated: true });
    await run(background.context, [
      { name: "umbrella", action: "create", content: buildSkillMarkdown("umbrella", "Trigger.", "Body.") }
    ]);
    recordCreated(ownerUserId!, "umbrella", { agentCreated: true });
    background.context.loadedSkillIds.add("teamskill-archived");
    background.context.loadedSkillIds.add("teamskill-umbrella");
    const archived = await run(background.context, [{ name: "archived", action: "delete", absorbed_into: "umbrella" }]);
    expect(resultText(archived.promptMessages)).toContain("archived (recoverable");
  });

  it("requires delete to be the sole operation", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "victim", action: "create", content: buildSkillMarkdown("victim", "Trigger.", "Body.") }
    ]);
    const result = await run(context, [
      { name: "victim", action: "delete" },
      { name: "other", action: "create", content: buildSkillMarkdown("other", "Trigger.", "Body.") }
    ]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("SOLE op");
  });

  it("caps a batch at 20 operations", async () => {
    const { context } = buildContext(conversationId);
    const operations = Array.from({ length: SKILL_MANAGE_BATCH_MAX_OPS + 1 }, (_, index) => ({
      name: `op-${index}`,
      action: "create",
      content: buildSkillMarkdown(`op-${index}`, "Trigger.", "Body.")
    }));
    const result = await run(context, operations);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("batch limit of 20");
  });

  it("rolls the whole batch back when one operation fails", async () => {
    const { context } = buildContext(conversationId);
    const result = await run(context, [
      { name: "kept-or-not", action: "create", content: buildSkillMarkdown("kept-or-not", "Trigger.", "Body.") },
      { name: "bad name!", action: "create", content: buildSkillMarkdown("bad name!", "Trigger.", "Body.") }
    ]);

    expect(result.toolSucceeded).toBe(false);
    expect(findLibrarySkill(ownerUserId, "kept-or-not")).toBeNull();
  });

  it("refuses to create over an existing skill without overwriting it", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "collide", action: "create", content: buildSkillMarkdown("collide", "Trigger.", "Original.") }
    ]);
    const result = await run(context, [
      { name: "collide", action: "create", content: buildSkillMarkdown("collide", "Trigger.", "Overwritten.") }
    ]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("already exists at collide");
    expect(findLibrarySkill(ownerUserId, "collide")?.skill.content).toContain("Original.");
  });

  it("blocks deletion of a pinned skill", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "pinned", action: "create", content: buildSkillMarkdown("pinned", "Trigger.", "Body.") }
    ]);
    setPinned(ownerUserId!, ref("pinned"), true);

    const result = await run(context, [{ name: "pinned", action: "delete" }]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("is pinned and cannot be deleted");
  });

  it("refuses a background-review edit of a user-owned skill", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "user-owned", action: "create", content: buildSkillMarkdown("user-owned", "Trigger.", "Body.") }
    ]);

    const background = buildContext(conversationId);
    background.context.input.skillWriteOrigin = "background-review";
    background.context.loadedSkillIds.add(`teamskill-${ref("user-owned")}`);

    const result = await run(background.context, [
      { name: "user-owned", action: "patch", old_string: "Body.", new_string: "Changed." }
    ]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("User-owned skills are off-limits to autonomous curation.");
  });

  it("enforces read-before-write for background reviews", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "unread", action: "create", content: buildSkillMarkdown("unread", "Trigger.", "Body.") }
    ]);
    recordCreated(ownerUserId!, "unread", { agentCreated: true });

    const background = buildContext(conversationId);
    background.context.input.skillWriteOrigin = "background-review";
    const result = await run(background.context, [
      { name: "unread", action: "patch", old_string: "Body.", new_string: "Changed." }
    ]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("has not been loaded in this review turn");
  });

  it("rejects an unknown action with the Hermes action list", async () => {
    const { context } = buildContext(conversationId);
    const result = await run(context, [{ name: "x", action: "obliterate" }]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("Unknown action 'obliterate'. Use: create, patch, delete, write_file, remove_file");
  });

  it("refuses to run outside an agent conversation", async () => {
    const { context } = buildContext(undefined);
    const result = await run(context, [
      { name: "nope", action: "create", content: buildSkillMarkdown("nope", "Trigger.", "Body.") }
    ]);
    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("only available in agent conversations");
  });

  it("records every mutation in the ledger", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "audited", action: "create", content: buildSkillMarkdown("audited", "Trigger.", "Body.") },
      { name: "audited", action: "patch", old_string: "Body.", new_string: "Patched." }
    ]);
    const ledger = readLedger(ownerUserId);
    expect(ledger.map((entry) => entry.action)).toEqual(["create", "patch"]);
    expect(ledger.every((entry) => entry.skill === "audited")).toBe(true);
  });

  it("keeps the shared library visible to every skill listing", async () => {
    const { context } = buildContext(conversationId);
    await run(context, [
      { name: "shared", action: "create", content: buildSkillMarkdown("shared", "Trigger.", "Body.") }
    ]);
    expect(listLibrarySkills(ownerUserId).map((skill) => skill.name)).toContain("shared");
  });
});

describe("normalizeSkillOperation", () => {
  it("accepts the flat legacy shape as well as the operations shape", () => {
    expect(normalizeSkillOperation({ name: "a", action: "create", content: "c" })).toEqual({
      name: "a",
      action: "create",
      content: "c",
      category: null
    });
    expect(normalizeSkillOperation({ name: "a", action: "patch", old_string: "x", new_string: "y" })).toMatchObject({
      action: "patch",
      oldString: "x",
      newString: "y"
    });
  });

  it("reports the missing parameter per action", () => {
    expect(normalizeSkillOperation({ name: "a", action: "create" })).toHaveProperty("error");
    expect(normalizeSkillOperation({ name: "a", action: "patch" })).toEqual({
      error: "Provide either old_string + new_string, or content for a full rewrite."
    });
    expect(normalizeSkillOperation({ name: "a", action: "write_file" })).toHaveProperty("error");
    expect(normalizeSkillOperation({ name: "a", action: "remove_file" })).toHaveProperty("error");
    expect(normalizeSkillOperation({ action: "delete" })).toHaveProperty("error");
  });

  it("treats edit as an alias for a full-rewrite patch", () => {
    expect(normalizeSkillOperation({ name: "a", action: "edit", content: "c" })).toMatchObject({ action: "patch" });
  });
});
