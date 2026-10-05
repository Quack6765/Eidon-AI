import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureCompactedContextMock, streamProviderResponseMock } = vi.hoisted(() => ({
  ensureCompactedContextMock: vi.fn(),
  streamProviderResponseMock: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: streamProviderResponseMock,
  callProviderText: vi.fn()
}));

vi.mock("@/lib/compaction", () => ({
  ensureCompactedContext: ensureCompactedContextMock,
  getConversationContextUsage: vi.fn().mockReturnValue({
    contextTokens: 512,
    compactionLimit: 8192
  })
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

vi.mock("@/lib/conversation-title-generator", () => ({
  generateConversationTitle: vi.fn(),
  sanitizeGeneratedConversationTitle: vi.fn(),
  buildConversationTitlePrompt: vi.fn(),
  DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE: "Files",
  DEFAULT_CONVERSATION_TITLE: "Conversation",
  MAX_CONVERSATION_TITLE_LENGTH: 48
}));

import { createLocalUser } from "@/lib/users";
import { createBot } from "@/lib/bots";
import { createConversation } from "@/lib/conversations";
import { createLibrarySkill, ensureLibraryReady, getSkillLibraryDir } from "@/lib/skill-library";
import { buildToolDefinitions } from "@/lib/tool-definitions";
import { createProviderProfileInput } from "@/tests/provider-fixtures";
import { updateProviderCatalog } from "@/lib/settings";
import type { Skill } from "@/lib/types";

function setupProvider(skillsEnabled: boolean) {
  const profile = createProviderProfileInput({
    id: "profile_ws_skills",
    name: "Workspace Skills",
    model: "gpt-test",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    modelContextLimit: 16384,
    freshTailCount: 12,
    visionMode: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  updateProviderCatalog({
    defaultProviderProfileId: profile.id,
    skillsEnabled,
    providerProfiles: [profile]
  });
}

function stubStream(answer = "Done.") {
  streamProviderResponseMock.mockReturnValue(
    (async function* () {
      yield { type: "answer_delta", text: answer };
      return { answer, thinking: "", usage: { outputTokens: 1 } };
    })()
  );
}

function captureLastProviderCall() {
  const calls = streamProviderResponseMock.mock.calls;
  const lastCall = calls[calls.length - 1];
  const tools = ((lastCall?.[0] as { tools?: Array<{ function: { name: string; description?: string } }> })
    ?.tools) ?? [];
  const promptMessages =
    ((lastCall?.[0] as { promptMessages?: Array<{ role: string; content: unknown }> })?.promptMessages) ?? [];
  return { tools, promptMessages };
}

function toolNames(tools: Array<{ function: { name: string } }>) {
  return tools.map((tool) => tool.function.name);
}

const workspaceSkill: Skill = {
  id: "botws-bot_probe-incident-notes",
  name: "incident-notes",
  description: "Use when writing incident status notes.",
  content: "---\nname: incident-notes\ndescription: Use when writing incident status notes.\n---\n\nKeep it factual.",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

function minimalDefinitionsInput(skills: Skill[], skillManageEnabled: boolean) {
  return {
    mcpToolSets: [],
    skills,
    loadedSkillIds: new Set<string>(),
    skillManageEnabled,
    memoriesEnabled: false,
    effectiveVisionMode: "none" as const
  };
}

describe("workspace skills in chat turns", () => {
  beforeEach(async () => {
    ensureCompactedContextMock.mockReset();
    streamProviderResponseMock.mockReset();
    ensureCompactedContextMock.mockResolvedValue({
      promptMessages: [{ role: "user", content: "Hi" }],
      promptTokens: 16,
      compactionLimit: 8192,
      didCompact: false
    });
  });

  it("offers skill_manage with the workspace flag even when no skills exist yet", () => {
    const withFlag = buildToolDefinitions(minimalDefinitionsInput([workspaceSkill], true));
    expect(toolNames(withFlag)).toContain("load_skill");
    expect(toolNames(withFlag)).toContain("skill_manage");

    const withoutFlag = buildToolDefinitions(minimalDefinitionsInput([workspaceSkill], false));
    expect(toolNames(withoutFlag)).toContain("load_skill");
    expect(toolNames(withoutFlag)).not.toContain("skill_manage");

    const withoutSkills = buildToolDefinitions(minimalDefinitionsInput([], true));
    expect(toolNames(withoutSkills)).not.toContain("load_skill");
    expect(toolNames(withoutSkills)).toContain("skill_manage");

    const withoutEither = buildToolDefinitions(minimalDefinitionsInput([], false));
    expect(toolNames(withoutEither)).not.toContain("load_skill");
    expect(toolNames(withoutEither)).not.toContain("skill_manage");
  });

  it("teaches skill_manage on a first bot turn with no workspace skills, offering the builtin browser skill", async () => {
    setupProvider(true);
    const user = await createLocalUser({ username: "firstskill", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Fresh", title: "Skills" }, user.id);
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const result = await startChatTurn(manager, bot.homeConversationId, "Hello", []);

    expect(result.status).toBe("completed");
    const { tools, promptMessages } = captureLastProviderCall();
    expect(toolNames(tools)).toContain("skill_manage");

    const trailing = promptMessages.at(-1);
    expect(trailing?.role).toBe("user");
    const trailingText = typeof trailing?.content === "string" ? trailing.content : "";
    expect(trailingText).toContain("Available skills");
    expect(trailingText).toContain("Agent Browser");
    expect(trailingText).toContain("skill_manage");
  });

  it("injects shared library skills and the skill_manage tool into bot turns", async () => {
    setupProvider(true);
    const user = await createLocalUser({ username: "wsowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Archivist", title: "Skills" }, user.id);
    const skillDir = join(getSkillLibraryDir(bot.userId), "incident-notes");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: incident-notes\ndescription: Use when writing incident status notes.\n---\n\nKeep it factual.",
      "utf8"
    );
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const result = await startChatTurn(manager, bot.homeConversationId, "Help with the incident", []);

    expect(result.status).toBe("completed");
    const { tools, promptMessages } = captureLastProviderCall();
    expect(toolNames(tools)).toContain("skill_manage");

    const loadSkill = tools.find((tool) => tool.function.name === "load_skill");
    expect(loadSkill?.function.description).toContain("incident-notes");

    const trailing = promptMessages.at(-1);
    expect(trailing?.role).toBe("user");
    const trailingText = typeof trailing?.content === "string" ? trailing.content : "";
    expect(trailingText).toContain("incident-notes (shared)");
    expect(trailingText).toContain("skill_manage");
  });

  it("hides all skill tools when the global skills toggle is off", async () => {
    setupProvider(false);
    const user = await createLocalUser({ username: "noskills", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Quiet", title: "Skills" }, user.id);
    const skillDir = join(getSkillLibraryDir(bot.userId), "incident-notes");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "Just instructions.", "utf8");
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    await startChatTurn(manager, bot.homeConversationId, "Help with the incident", []);

    const { tools, promptMessages } = captureLastProviderCall();
    expect(toolNames(tools)).not.toContain("load_skill");
    expect(toolNames(tools)).not.toContain("skill_manage");

    const trailingText = promptMessages.at(-1)?.content;
    expect(typeof trailingText === "string" && trailingText.includes("Available skills")).toBe(false);
  });

  it("refreshes the skills guidance and tool list within the same turn after skill_manage", async () => {
    setupProvider(true);
    const user = await createLocalUser({ username: "liveowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Live", title: "Skills" }, user.id);

    streamProviderResponseMock
      .mockReturnValueOnce(
        (async function* () {
          return {
            answer: "",
            thinking: "",
            usage: { outputTokens: 1 },
            toolCalls: [
              {
                id: "call_save",
                name: "skill_manage",
                arguments: JSON.stringify({
                  operations: [
                    {
                      name: "google-maps-navigation",
                      action: "create",
                      content:
                        "---\nname: google-maps-navigation\ndescription: Open and navigate Google Maps.\n---\n\nUse agent-browser to open maps.\n"
                    }
                  ]
                })
              }
            ]
          };
        })()
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "answer_delta", text: "Saved." };
          return { answer: "Saved.", thinking: "", usage: { outputTokens: 1 } };
        })()
      );

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const result = await startChatTurn(manager, bot.homeConversationId, "Create a navigation skill", []);

    expect(result.status).toBe("completed");
    expect(streamProviderResponseMock.mock.calls).toHaveLength(2);

    const firstCallPromptMessages = ((streamProviderResponseMock.mock.calls[0]?.[0] as {
      promptMessages?: Array<{ role: string; content: unknown }>;
    })?.promptMessages) ?? [];
    const firstTrailing = firstCallPromptMessages.at(-1)?.content;
    expect(typeof firstTrailing === "string" && firstTrailing.includes("Agent Browser")).toBe(true);

    const { tools, promptMessages } = captureLastProviderCall();
    const trailing = promptMessages.at(-1);
    const trailingText = typeof trailing?.content === "string" ? trailing.content : "";
    expect(trailingText).toContain("google-maps-navigation (shared)");

    const loadSkill = tools.find((tool) => tool.function.name === "load_skill");
    expect(loadSkill?.function.description).toContain("google-maps-navigation");
  });

  it("does not offer skill_manage for non-bot conversations", async () => {
    setupProvider(true);
    await createLocalUser({ username: "plainuser", password: "password-123", role: "user" as const });
    const conversation = createConversation("Plain chat");
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    await startChatTurn(manager, conversation.id, "Hi", []);

    const { tools } = captureLastProviderCall();
    expect(toolNames(tools)).not.toContain("skill_manage");
  });
});


describe("a skill review turn without a bot", () => {
  it("still sees the shared library and gets skill_manage", async () => {
    setupProvider(true);
    const user = await createLocalUser({
      username: `review-turn-${Math.random().toString(36).slice(2, 8)}`,
      password: "password-123",
      role: "user" as const
    });
    const bot = createBot({ name: `Owner ${Math.random().toString(36).slice(2, 6)}` }, user.id);
    ensureLibraryReady(user.id);
    createLibrarySkill(user.id, {
      name: "shared-procedure",
      content: "---\nname: shared-procedure\ndescription: How to run the release checklist.\n---\n\nSteps.",
      agentAuthored: true
    });

    // The scratch review conversation is deliberately NOT the bot's home thread.
    const scratch = createConversation("Skill review", null, { origin: "automation", isTemporary: true }, user.id);
    stubStream("Nothing to save.");

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const result = await startChatTurn(manager, scratch.id, "review this conversation", [], undefined, {
      unattended: true,
      quietWhenBusy: true,
      toolAllowlist: ["load_skill", "skill_manage"],
      skillOwnerUserId: bot.userId ?? null,
      botRun: { record: false }
    });

    expect(result.status).toBe("completed");

    const { tools, promptMessages } = captureLastProviderCall();
    const names = toolNames(tools);
    expect(names).toContain("skill_manage");
    expect(names).toContain("load_skill");
    expect(names).not.toContain("create_memory");

    const trailing = promptMessages.map((message) => String(message.content)).join("\n");
    expect(trailing).toContain("shared-procedure");
    expect(trailing).toContain("shared");
  });
});
