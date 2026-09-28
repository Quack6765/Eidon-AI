import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchWorkspace } = vi.hoisted(() => ({ searchWorkspace: vi.fn() }));

vi.mock("@/lib/semantic-index", () => ({
  searchWorkspace,
  isSemanticRecallAvailable: vi.fn(() => true)
}));

import { createBot } from "@/lib/bots";
import { buildToolDefinitions } from "@/lib/tool-definitions";
import { createLocalUser } from "@/lib/users";
import { executeSearchWorkspace, executeToolCall } from "@/lib/tool-executors";

function definitionInput(overrides: Partial<Parameters<typeof buildToolDefinitions>[0]> = {}) {
  return {
    mcpToolSets: [],
    skills: [],
    loadedSkillIds: new Set<string>(),
    memoriesEnabled: true,
    effectiveVisionMode: "none" as const,
    ...overrides
  };
}

function toolNames(input: Parameters<typeof buildToolDefinitions>[0]) {
  return buildToolDefinitions(input).map((tool) => tool.function.name);
}

describe("search_workspace tool", () => {
  beforeEach(() => {
    searchWorkspace.mockReset();
  });

  it("is registered only when semantic recall is available", () => {
    expect(toolNames(definitionInput())).not.toContain("search_workspace");
    expect(toolNames(definitionInput({ semanticRecallAvailable: false }))).not.toContain("search_workspace");
    const names = toolNames(definitionInput({ semanticRecallAvailable: true }));
    expect(names).toContain("search_workspace");
    expect(names.indexOf("search_workspace")).toBeLessThan(names.indexOf("create_memory"));
  });

  it("formats grouped results with titles, snippets and references", async () => {
    searchWorkspace.mockResolvedValue([
      {
        kind: "memory",
        title: "Memory (work)",
        snippet: "We picked TypeScript",
        conversationId: null,
        memoryId: "mem_1",
        score: 0.91,
        date: "2026-03-01T10:00:00.000Z"
      },
      {
        kind: "message",
        title: "Architecture decision",
        snippet: "Decision: deploy on Kubernetes",
        conversationId: "conv_1",
        memoryId: null,
        score: 0.77,
        date: "2026-02-01T10:00:00.000Z"
      }
    ]);
    const onActionStart = vi.fn(async () => "handle_1");
    const onActionComplete = vi.fn();

    const result = await executeToolCall(
      { id: "call_1", name: "search_workspace", arguments: JSON.stringify({ query: "backend stack", limit: 50 }) },
      {
        input: { skills: [], mcpToolSets: [], memoryUserId: "user_a", onActionStart, onActionComplete },
        mcpServers: [],
        loadedSkillIds: new Set(),
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: 3,
        promptMessages: [],
        memoryUserId: "user_a"
      }
    );

    expect(searchWorkspace).toHaveBeenCalledWith({ userId: "user_a", query: "backend stack", limit: 20, memoryBotId: null });
    expect(onActionStart).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "mcp_tool_call", toolName: "search_workspace", label: "Search workspace" })
    );
    expect(onActionComplete).toHaveBeenCalledWith("handle_1", expect.objectContaining({ detail: "backend stack" }));
    expect(result.toolSucceeded).toBe(true);
    expect(result.nextSortOrder).toBe(4);
    const content = result.promptMessages.at(-1)?.content as string;
    expect(content).toContain("1. [memory] Memory (work) (2026-03-01, memory mem_1, score 0.91)");
    expect(content).toContain("We picked TypeScript");
    expect(content).toContain("2. [message] Architecture decision (2026-02-01, conversation conv_1, score 0.77)");
  });

  it("scopes memory matches to the bot when searching from a bot conversation", async () => {
    const user = await createLocalUser({ username: "searchbotowner", password: "password-123", role: "user" as const });
    const bot = createBot({ name: "Searcher", title: "Recall" }, user.id);
    searchWorkspace.mockResolvedValue([]);

    await executeSearchWorkspace(
      "call",
      { query: "what did I learn" },
      { input: { memoryUserId: user.id, conversationId: bot.homeConversationId }, timelineSortOrder: 0, promptMessages: [] }
    );

    expect(searchWorkspace).toHaveBeenCalledWith({
      userId: user.id,
      query: "what did I learn",
      limit: 8,
      memoryBotId: bot.id
    });
  });

  it("reports empty results, invalid input, missing owner and unavailable index without throwing", async () => {
    const context = {
      input: { memoryUserId: "user_a" },
      timelineSortOrder: 0,
      promptMessages: []
    };

    searchWorkspace.mockResolvedValue([]);
    const empty = await executeSearchWorkspace("call", { query: "anything" }, context);
    expect(empty.promptMessages[0].content).toBe("No matching content found in the workspace.");
    expect(empty.toolSucceeded).toBe(true);
    expect(searchWorkspace).toHaveBeenCalledWith({ userId: "user_a", query: "anything", limit: 8, memoryBotId: null });

    const blank = await executeSearchWorkspace("call", { query: "   " }, context);
    expect(blank.toolSucceeded).toBe(false);
    expect(blank.promptMessages[0].content).toContain("query is required");

    const noOwner = await executeSearchWorkspace("call", { query: "x" }, { ...context, input: {} });
    expect(noOwner.toolSucceeded).toBe(false);
    expect(noOwner.promptMessages[0].content).toContain("owned conversations");

    searchWorkspace.mockResolvedValue(null);
    const onActionError = vi.fn();
    const unavailable = await executeSearchWorkspace("call", { query: "x" }, {
      ...context,
      input: { memoryUserId: "user_a", onActionError }
    });
    expect(unavailable.toolSucceeded).toBe(false);
    expect(unavailable.promptMessages[0].content).toBe("Error: Semantic index is unavailable");
    expect(onActionError).toHaveBeenCalled();
  });
});
