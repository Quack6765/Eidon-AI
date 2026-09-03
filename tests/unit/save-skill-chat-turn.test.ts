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
import { getBotSkillsDir } from "@/lib/bot-workspace-skills";
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

function minimalDefinitionsInput(skills: Skill[], botWorkspaceSkillsEnabled: boolean) {
  return {
    mcpToolSets: [],
    skills,
    loadedSkillIds: new Set<string>(),
    botWorkspaceSkillsEnabled,
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

  it("offers save_skill with the workspace flag even when no skills exist yet", () => {
    const withFlag = buildToolDefinitions(minimalDefinitionsInput([workspaceSkill], true));
    expect(toolNames(withFlag)).toContain("load_skill");
    expect(toolNames(withFlag)).toContain("save_skill");

    const withoutFlag = buildToolDefinitions(minimalDefinitionsInput([workspaceSkill], false));
    expect(toolNames(withoutFlag)).toContain("load_skill");
    expect(toolNames(withoutFlag)).not.toContain("save_skill");

    const withoutSkills = buildToolDefinitions(minimalDefinitionsInput([], true));
    expect(toolNames(withoutSkills)).not.toContain("load_skill");
    expect(toolNames(withoutSkills)).toContain("save_skill");

    const withoutEither = buildToolDefinitions(minimalDefinitionsInput([], false));
    expect(toolNames(withoutEither)).not.toContain("load_skill");
    expect(toolNames(withoutEither)).not.toContain("save_skill");
  });

  it("teaches save_skill on a first bot turn with no existing skills", async () => {
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
    expect(toolNames(tools)).toContain("save_skill");

    const trailing = promptMessages.at(-1);
    expect(trailing?.role).toBe("user");
    const trailingText = typeof trailing?.content === "string" ? trailing.content : "";
    expect(trailingText).toContain("No skills are available yet");
    expect(trailingText).toContain("save_skill");
  });

  it("injects bot workspace skills and the save_skill tool into bot turns", async () => {
    setupProvider(true);
    const user = await createLocalUser({ username: "wsowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Archivist", title: "Skills" }, user.id);
    const skillDir = join(getBotSkillsDir(bot), "incident-notes");
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
    expect(toolNames(tools)).toContain("save_skill");

    const loadSkill = tools.find((tool) => tool.function.name === "load_skill");
    expect(loadSkill?.function.description).toContain("incident-notes");

    const trailing = promptMessages.at(-1);
    expect(trailing?.role).toBe("user");
    const trailingText = typeof trailing?.content === "string" ? trailing.content : "";
    expect(trailingText).toContain("incident-notes (workspace)");
    expect(trailingText).toContain("save_skill");
  });

  it("hides all skill tools when the global skills toggle is off", async () => {
    setupProvider(false);
    const user = await createLocalUser({ username: "noskills", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Quiet", title: "Skills" }, user.id);
    const skillDir = join(getBotSkillsDir(bot), "incident-notes");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "Just instructions.", "utf8");
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    await startChatTurn(manager, bot.homeConversationId, "Help with the incident", []);

    const { tools, promptMessages } = captureLastProviderCall();
    expect(toolNames(tools)).not.toContain("load_skill");
    expect(toolNames(tools)).not.toContain("save_skill");

    const trailingText = promptMessages.at(-1)?.content;
    expect(typeof trailingText === "string" && trailingText.includes("Available skills")).toBe(false);
  });

  it("refreshes the skills guidance and tool list within the same turn after save_skill", async () => {
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
                name: "save_skill",
                arguments: JSON.stringify({
                  name: "google-maps-navigation",
                  description: "Open and navigate Google Maps.",
                  instructions: "Use agent-browser to open maps."
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
    expect(typeof firstTrailing === "string" && firstTrailing.includes("No skills are available yet")).toBe(true);

    const { tools, promptMessages } = captureLastProviderCall();
    const trailing = promptMessages.at(-1);
    const trailingText = typeof trailing?.content === "string" ? trailing.content : "";
    expect(trailingText).toContain("google-maps-navigation (workspace)");

    const loadSkill = tools.find((tool) => tool.function.name === "load_skill");
    expect(loadSkill?.function.description).toContain("google-maps-navigation");
  });

  it("does not offer save_skill for non-bot conversations", async () => {
    setupProvider(true);
    await createLocalUser({ username: "plainuser", password: "password-123", role: "user" as const });
    const conversation = createConversation("Plain chat");
    stubStream();

    const { startChatTurn } = await import("@/lib/chat-turn");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    await startChatTurn(manager, conversation.id, "Hi", []);

    const { tools } = captureLastProviderCall();
    expect(toolNames(tools)).not.toContain("save_skill");
  });
});
