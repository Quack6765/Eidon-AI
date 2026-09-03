import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { createConversation } from "@/lib/conversations";
import { getBotSkillsDir, listBotWorkspaceSkills } from "@/lib/bot-workspace-skills";
import { executeLoadSkill, executeSaveSkill, executeToolCall, type RuntimeAction } from "@/lib/tool-executors";
import type { PromptMessage } from "@/lib/types";

function buildContext(conversationId?: string) {
  const actions: RuntimeAction[] = [];
  const completions: Array<{ handle?: string; patch: { detail?: string; resultSummary?: string } }> = [];

  return {
    actions,
    completions,
    context: {
      input: {
        conversationId,
        skills: undefined as import("@/lib/types").Skill[] | undefined,
        onActionStart: (action: RuntimeAction) => {
          actions.push(action);
          return `handle_${actions.length}`;
        },
        onActionComplete: async (
          handle: string | undefined,
          patch: { detail?: string; resultSummary?: string }
        ) => {
          completions.push({ handle, patch });
        }
      },
      timelineSortOrder: 0,
      promptMessages: [] as PromptMessage[]
    }
  };
}

function resultText(promptMessages: PromptMessage[]) {
  const last = promptMessages.at(-1);
  expect(last?.role).toBe("tool");
  return typeof last?.content === "string" ? last.content : "";
}

describe("save_skill tool", () => {
  it("creates a skill folder with SKILL.md and emits a save_skill action", async () => {
    const user = await createLocalUser({ username: "saveowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Curator", title: "Skills" }, user.id);
    const { actions, completions, context } = buildContext(bot.homeConversationId);

    const result = await executeSaveSkill(
      "call_1",
      {
        name: "Release Notes",
        description: "Use when drafting release notes from merged PRs.",
        instructions: "1. List merged PRs.\n2. Group by area."
      },
      context
    );

    expect(result.toolSucceeded).toBe(true);

    const skillFile = join(getBotSkillsDir(bot), "release-notes", "SKILL.md");
    expect(existsSync(skillFile)).toBe(true);
    expect(readFileSync(skillFile, "utf8")).toBe(
      "---\nname: Release Notes\ndescription: Use when drafting release notes from merged PRs.\n---\n\n1. List merged PRs.\n2. Group by area.\n"
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("save_skill");
    expect(actions[0].label).toBe("Save skill");
    expect(actions[0].detail).toBe("Release Notes");
    expect(completions.at(-1)?.patch.resultSummary).toContain("Skill saved");

    const discovered = listBotWorkspaceSkills(bot);
    expect(discovered.map((skill) => skill.name)).toEqual(["Release Notes"]);
  });

  it("overwrites an existing skill folder (create-or-update)", async () => {
    const user = await createLocalUser({ username: "updateowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Editor", title: "Skills" }, user.id);
    const { context } = buildContext(bot.homeConversationId);

    await executeSaveSkill(
      "call_1",
      { name: "triage", description: "First pass.", instructions: "Old body." },
      context
    );
    const result = await executeSaveSkill(
      "call_2",
      { name: "triage", description: "Second pass.", instructions: "New body." },
      context
    );

    expect(result.toolSucceeded).toBe(true);
    const skillFile = join(getBotSkillsDir(bot), "triage", "SKILL.md");
    expect(readFileSync(skillFile, "utf8")).toContain("New body.");
    expect(readFileSync(skillFile, "utf8")).not.toContain("Old body.");
    expect(listBotWorkspaceSkills(bot)).toHaveLength(1);
  });

  it("rejects invalid arguments with an error tool result", async () => {
    const user = await createLocalUser({ username: "argowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Validator", title: "Skills" }, user.id);
    const { actions, context } = buildContext(bot.homeConversationId);

    const missingDescription = await executeSaveSkill(
      "call_1",
      { name: "Broken", instructions: "Body." },
      context
    );
    expect(missingDescription.toolSucceeded).toBe(false);
    expect(resultText(missingDescription.promptMessages)).toContain("description is required");

    const unusableName = await executeSaveSkill(
      "call_2",
      { name: "!!!", description: "Bad name.", instructions: "Body." },
      context
    );
    expect(unusableName.toolSucceeded).toBe(false);
    expect(resultText(unusableName.promptMessages)).toContain("valid skill folder name");

    expect(actions).toHaveLength(0);
    expect(existsSync(getBotSkillsDir(bot))).toBe(false);
  });

  it("returns an error tool result for conversations without a bot workspace", async () => {
    const conversation = createConversation("Plain chat");
    const { actions, context } = buildContext(conversation.id);

    const result = await executeSaveSkill(
      "call_1",
      { name: "Nowhere", description: "No workspace.", instructions: "Body." },
      context
    );

    expect(result.toolSucceeded).toBe(false);
    expect(resultText(result.promptMessages)).toContain("only available in agent conversations");
    expect(actions).toHaveLength(0);
  });

  it("loads a skill saved mid-turn even when it is not in the turn's skill snapshot", async () => {
    const user = await createLocalUser({ username: "sameloadowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Instant", title: "Skills" }, user.id);
    const { context } = buildContext(bot.homeConversationId);

    const saveResult = await executeSaveSkill(
      "call_save",
      { name: "google-navigation", description: "Drive the browser to a place.", instructions: "Use agent-browser to open maps." },
      context
    );
    expect(saveResult.toolSucceeded).toBe(true);

    const actions: RuntimeAction[] = [];
    const loadResult = await executeLoadSkill(
      "call_load",
      { skill_name: "google-navigation" },
      {
        input: {
          skills: [],
          conversationId: bot.homeConversationId,
          onActionStart: (action) => {
            actions.push(action);
            return `handle_${actions.length}`;
          },
          onActionComplete: async () => {}
        },
        loadedSkillIds: new Set(),
        timelineSortOrder: 1,
        promptMessages: []
      }
    );

    const loadedText = resultText(loadResult.promptMessages);
    expect(loadedText).toContain("Skill loaded: google-navigation");
    expect(loadedText).toContain("Use agent-browser to open maps.");
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe("skill_load");
    expect(actions[0].skillId).toBe(listBotWorkspaceSkills(bot)[0].id);
  });

  it("lists turn and workspace skills when a load target is not found", async () => {
    const user = await createLocalUser({ username: "missingload", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Missing", title: "Skills" }, user.id);
    const { context } = buildContext(bot.homeConversationId);

    await executeSaveSkill(
      "call_save",
      { name: "known-skill", description: "Known.", instructions: "Body." },
      context
    );

    const loadResult = await executeLoadSkill(
      "call_load",
      { skill_name: "does-not-exist" },
      {
        input: {
          skills: [{
            id: "skill_global",
            name: "Global Skill",
            description: "Global.",
            content: "Global body",
            enabled: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          }],
          conversationId: bot.homeConversationId,
          onActionStart: async () => {},
          onActionComplete: async () => {}
        },
        loadedSkillIds: new Set(),
        timelineSortOrder: 0,
        promptMessages: []
      }
    );

    const loadedText = resultText(loadResult.promptMessages);
    expect(loadedText).toContain('Skill "does-not-exist" not found');
    expect(loadedText).toContain("Global Skill");
    expect(loadedText).toContain("known-skill");
  });

  it("injects the saved skill into the turn's live skill list", async () => {
    const user = await createLocalUser({ username: "injectowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Injector", title: "Skills" }, user.id);
    const turnSkills: import("@/lib/types").Skill[] = [{
      id: "skill_global_maps",
      name: "Maps Helper",
      description: "Global maps skill.",
      content: "---\nname: Maps Helper\ndescription: Global maps skill.\n---\n\nGlobal body",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }];
    const { context } = buildContext(bot.homeConversationId);
    context.input.skills = turnSkills;

    await executeSaveSkill(
      "call_1",
      { name: "Maps Helper", description: "Agent-authored replacement.", instructions: "Local body." },
      context
    );

    expect(turnSkills).toHaveLength(1);
    expect(turnSkills[0].id).toBe(`botws-${bot.id}-maps-helper`);
    expect(turnSkills[0].name).toBe("Maps Helper");
    expect(turnSkills[0].content).toContain("Local body.");

    await executeSaveSkill(
      "call_2",
      { name: "Maps Helper", description: "Updated.", instructions: "Newer body." },
      context
    );

    expect(turnSkills).toHaveLength(1);
    expect(turnSkills[0].content).toContain("Newer body.");
  });

  it("dispatches through executeToolCall", async () => {
    const user = await createLocalUser({ username: "dispatchowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Router", title: "Skills" }, user.id);
    const { context } = buildContext(bot.homeConversationId);

    const result = await executeToolCall(
      { id: "call_dispatch", name: "save_skill", arguments: JSON.stringify({ name: "Dispatched", description: "Via dispatch.", instructions: "Body." }) },
      {
        input: { ...context.input, skills: [], mcpToolSets: [] },
        mcpServers: [],
        loadedSkillIds: new Set(),
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: 0,
        promptMessages: []
      }
    );

    expect(result.toolSucceeded).toBe(true);
    expect(existsSync(join(getBotSkillsDir(bot), "dispatched", "SKILL.md"))).toBe(true);
  });
});
