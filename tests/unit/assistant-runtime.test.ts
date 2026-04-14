import type { ChatStreamEvent, ProviderProfileWithApiKey, Skill } from "@/lib/types";

const streamProviderResponse = vi.fn();
const callMcpTool = vi.fn();
const getToolResultText = vi.fn();
const executeLocalShellCommand = vi.fn();
const summarizeShellResult = vi.fn();
const getMemoryRecord = vi.fn();
const createMemoryFn = vi.fn();
const updateMemoryRecord = vi.fn();
const deleteMemoryRecord = vi.fn();
const getMemoryCountFn = vi.fn();
const getSettingsFn = vi.fn();
const searchSearxng = vi.fn();

vi.mock("@/lib/provider", () => ({
  streamProviderResponse
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool,
  getToolResultText
}));

vi.mock("@/lib/local-shell", () => ({
  executeLocalShellCommand,
  summarizeShellResult
}));

vi.mock("@/lib/memories", () => ({
  getMemory: getMemoryRecord,
  createMemory: createMemoryFn,
  updateMemory: updateMemoryRecord,
  deleteMemory: deleteMemoryRecord,
  getMemoryCount: getMemoryCountFn
}));

vi.mock("@/lib/settings", () => ({
  getSettings: getSettingsFn
}));

vi.mock("@/lib/searxng", () => ({
  searchSearxng
}));

function createProviderStream(
  events: ChatStreamEvent[],
  result: {
    answer: string;
    thinking: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  }
) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
    return {
      answer: result.answer,
      thinking: result.thinking,
      toolCalls: result.toolCalls,
      usage: result.usage
    };
  })();
}

function createSettings(): ProviderProfileWithApiKey {
  return {
    id: "profile_test",
    name: "Test profile",
    apiBaseUrl: "https://api.example.com/v1",
    apiKeyEncrypted: "",
    apiKey: "sk-test",
    model: "gpt-5-mini",
    apiMode: "responses",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium",
    reasoningSummaryEnabled: true,
    modelContextLimit: 16000,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    tokenizerModel: "gpt-tokenizer",
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "native" as const,
    visionMcpServerId: null,
    providerKind: "openai_compatible",
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_release_notes",
    name: "Release Notes",
    description: "Use when writing customer-facing summaries of product changes.",
    content: "Summarize changes for end users in concise release notes.",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("assistant runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    streamProviderResponse.mockReset();
    callMcpTool.mockReset();
    getToolResultText.mockReset();
    executeLocalShellCommand.mockReset();
    summarizeShellResult.mockReset();
    getMemoryRecord.mockReset();
    createMemoryFn.mockReset();
    updateMemoryRecord.mockReset();
    deleteMemoryRecord.mockReset();
    getMemoryCountFn.mockReset();
    getSettingsFn.mockReset();
    getMemoryCountFn.mockReturnValue(0);
    getSettingsFn.mockReturnValue({ memoriesMaxCount: 100 });
    searchSearxng.mockReset();
    getToolResultText.mockImplementation((result: { content?: Array<{ text?: string }> }) => {
      return result.content?.[0]?.text ?? "done";
    });
    summarizeShellResult.mockImplementation((result: { stdout?: string; stderr?: string }) => {
      return result.stdout || result.stderr || "done";
    });
  });

  it("loads skills via native function calling before returning the final answer", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "load_skill", arguments: JSON.stringify({ skill_name: "Release Notes" }) }],
          usage: { inputTokens: 10 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done",
          thinking: "",
          usage: { inputTokens: 20, outputTokens: 1 }
        })
      );

    const started: Array<{ kind: string; label: string; detail?: string }> = [];
    const completed: Array<{ handle?: string; resultSummary?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Write release notes" }],
      skills: [createSkill()],
      mcpToolSets: [],
      onEvent: () => {},
      onActionStart: (action) => { started.push(action); return "act_skill"; },
      onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(2);
    expect(started).toEqual([expect.objectContaining({ kind: "skill_load", label: "Load skill", detail: "Release Notes" })]);
    expect(completed).toEqual([{ handle: "act_skill", resultSummary: "Skill instructions loaded." }]);
    expect(result.answer).toBe("Done");
  });

  it("injects enum values into MCP tool descriptions", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Done" }], {
        answer: "Done",
        thinking: "",
        usage: { inputTokens: 10, outputTokens: 1 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Search" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_exa", slug: "exa", name: "Exa", url: "https://exa.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{
          name: "web_search",
          title: "Web Search",
          description: "Search the web",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              freshness: { type: "string", enum: ["24h", "week", "month", "year", "any"], description: "Recency filter" }
            },
            required: ["query"]
          },
          annotations: { readOnlyHint: true }
        }]
      }],
      onEvent: () => {},
      onActionStart: () => {},
      onActionComplete: () => {}
    });

    const toolDefs = streamProviderResponse.mock.calls[0][0].tools!;
    const webSearchTool = toolDefs.find((t: any) => t.function.name === "mcp_exa_web_search")!;
    expect(webSearchTool.function.description).toContain("Valid values for freshness: 24h, week, month, year, any.");
  });

  it("registers a native SearXNG web search tool when configured", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Done" }], {
        answer: "Done",
        thinking: "",
        usage: { inputTokens: 10, outputTokens: 1 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Search the web" }],
      skills: [],
      mcpToolSets: [],
      searxngBaseUrl: "https://search.example.com",
      onEvent: () => {},
      onActionStart: () => {},
      onActionComplete: () => {}
    });

    const toolDefs = streamProviderResponse.mock.calls[0][0].tools!;
    const webSearchTool = toolDefs.find((tool: any) => tool.function.name === "web_search");
    expect(webSearchTool).toBeDefined();
    expect(webSearchTool.function.description).toContain("SearXNG");
  });

  it("executes MCP tool calls via native function calling", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Final answer" }], {
          answer: "Final answer",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );
    callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found MCP docs" }] });

    const started: Array<{ label: string; detail?: string; serverId?: string | null }> = [];
    const completed: Array<{ handle?: string; resultSummary?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", title: "Search docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }],
      onEvent: () => {},
      onActionStart: (action) => { started.push(action); return "act_tool"; },
      onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
    });

    expect(callMcpTool).toHaveBeenCalledWith(expect.objectContaining({ id: "mcp_docs" }), "search_docs", { query: "MCP" }, undefined);
    expect(started).toEqual([expect.objectContaining({ label: "Search docs", serverId: "mcp_docs" })]);
    expect(completed).toEqual([{ handle: "act_tool", resultSummary: "Found MCP docs" }]);
    expect(result.answer).toBe("Final answer");
  });

  it("executes native SearXNG web search tool calls", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "Eidon" }) }],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Final answer" }], {
          answer: "Final answer",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );
    searchSearxng.mockResolvedValue("SearXNG result text");

    const started: Array<{ label: string; detail?: string; serverId?: string | null }> = [];
    const completed: Array<{ handle?: string; resultSummary?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find Eidon" }],
      skills: [],
      mcpToolSets: [],
      searxngBaseUrl: "https://search.example.com",
      onEvent: () => {},
      onActionStart: (action) => {
        started.push(action);
        return "act_web_search";
      },
      onActionComplete: (handle, patch) => {
        completed.push({ handle, resultSummary: patch.resultSummary });
      }
    });

    expect(searchSearxng).toHaveBeenCalledWith({
      baseUrl: "https://search.example.com",
      query: "Eidon",
      maxResults: undefined
    });
    expect(started).toEqual([
      expect.objectContaining({
        label: "Web search",
        serverId: "builtin_web_search_searxng"
      })
    ]);
    expect(completed).toEqual([{ handle: "act_web_search", resultSummary: "SearXNG result text" }]);
    expect(result.answer).toBe("Final answer");
  });

  it("executes unrestricted shell commands via native function calling", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "execute_shell_command", arguments: JSON.stringify({ command: "curl -I https://example.com" }) }],
          usage: { inputTokens: 7 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Probed the endpoint." }], {
          answer: "Probed the endpoint.",
          thinking: "",
          usage: { inputTokens: 8, outputTokens: 2 }
        })
      );
    executeLocalShellCommand.mockResolvedValue({
      stdout: "HTTP/2 200",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      isError: false
    });

    const started: Array<{ kind: string; label: string; detail?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Probe the remote API with curl" }],
      skills: [],
      mcpToolSets: [],
      onActionStart: (action) => { started.push(action); return "act_shell"; },
      onActionComplete: () => undefined
    });

    expect(started).toEqual([
      expect.objectContaining({ kind: "shell_command", label: "Local command", detail: "curl -I https://example.com" })
    ]);
    expect(executeLocalShellCommand).toHaveBeenCalledWith({
      command: "curl -I https://example.com",
      timeoutMs: undefined
    });
    expect(result.answer).toBe("Probed the endpoint.");
  });

  it("keeps load_skill hidden for ordinary factual chat turns while shell remains available", async () => {
    const seenToolNames: string[][] = [];

    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      seenToolNames.push((tools ?? []).map((tool) => tool.function.name));

      return createProviderStream([{ type: "answer_delta", text: "It is rainy." }], {
        answer: "It is rainy.",
        thinking: "",
        usage: { inputTokens: 4, outputTokens: 2 }
      });
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "What's the weather in Montreal right now?" }],
      skills: [
        createSkill({
          id: "builtin-agent-browser",
          name: "Agent Browser",
          description: "Use for browser automation and page inspection.",
          content: `---
name: Agent Browser
description: Use for browser automation and page inspection.
shell_command_prefixes:
  - agent-browser
---

Run browser commands.`
        })
      ],
      mcpToolSets: []
    });

    expect(seenToolNames[0] ?? []).not.toContain("load_skill");
    expect(seenToolNames[0] ?? []).toContain("execute_shell_command");
    expect(result.answer).toBe("It is rainy.");
  });

  it("exposes shell-enabled skills when the user explicitly asks for browser inspection", async () => {
    const seenToolNames: string[][] = [];

    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      seenToolNames.push((tools ?? []).map((tool) => tool.function.name));

      return createProviderStream([{ type: "answer_delta", text: "I can inspect that site." }], {
        answer: "I can inspect that site.",
        thinking: "",
        usage: { inputTokens: 4, outputTokens: 2 }
      });
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Inspect https://example.com in the browser and tell me what you find." }],
      skills: [
        createSkill({
          id: "builtin-agent-browser",
          name: "Agent Browser",
          description: "Use for browser automation and page inspection.",
          content: `---
name: Agent Browser
description: Use for browser automation and page inspection.
shell_command_prefixes:
  - agent-browser
---

Run browser commands.`
        })
      ],
      mcpToolSets: []
    });

    expect(seenToolNames[0] ?? []).toContain("load_skill");
    expect(result.answer).toBe("I can inspect that site.");
  });

  it("reports MCP tool execution errors through the error callback", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 5 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "Recovered answer",
          thinking: "",
          usage: { inputTokens: 4, outputTokens: 2 }
        })
      );
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "permission denied" }],
      isError: true
    });

    const errored: Array<{ handle?: string; resultSummary?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use MCP" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }],
      onActionStart: () => "act_tool",
      onActionError: (handle, patch) => { errored.push({ handle, resultSummary: patch.resultSummary }); }
    });

    expect(errored).toEqual([{ handle: "act_tool", resultSummary: "permission denied" }]);
    expect(result.answer).toBe("Recovered answer");
  });

  it("retries when the first post-tool model pass is empty", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 5 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          usage: { inputTokens: 4 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Final answer after retry" }], {
          answer: "Final answer after retry",
          thinking: "",
          usage: { inputTokens: 6, outputTokens: 4 }
        })
      );
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Found MCP docs" }]
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use MCP" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }]
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(3);
    expect(result.answer).toBe("Final answer after retry");
  });

  it("suppresses repeated successful calls to the same read-only MCP tool within one turn", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 5 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_2", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP again" }) }],
          usage: { inputTokens: 4 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Final answer" }], {
          answer: "Final answer",
          thinking: "",
          usage: { inputTokens: 6, outputTokens: 2 }
        })
      );
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Found MCP docs" }]
    });

    const started: Array<{ label: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use MCP" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }],
      onActionStart: (action) => {
        started.push({ label: action.label });
        return "act_tool";
      }
    });

    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(started).toEqual([{ label: "search_docs" }]);
    expect(streamProviderResponse).toHaveBeenCalledTimes(3);
    expect(result.answer).toBe("Final answer");
  });

  it("returns an error result for unknown MCP tool calls", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_missing_server_missing_tool", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 5 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "Fallback answer",
          thinking: "",
          usage: { inputTokens: 3, outputTokens: 2 }
        })
      );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use MCP" }],
      skills: [],
      mcpToolSets: []
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(2);
    expect(result.answer).toBe("Fallback answer");
  });

  it("resolves MCP tool calls against the most specific matching slug", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_exa_docs_search", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 5 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "Resolved the specific server",
          thinking: "",
          usage: { inputTokens: 3, outputTokens: 2 }
        })
      );
    callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found MCP docs" }] });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use MCP" }],
      skills: [],
      mcpToolSets: [
        {
          server: {
            id: "mcp_exa",
            slug: "exa",
            name: "Exa",
            url: "https://exa.example.com",
            headers: {},
            transport: "streamable_http",
            command: null,
            args: null,
            env: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          tools: [{ name: "docs_search", description: "Search docs", inputSchema: { type: "object" } }]
        },
        {
          server: {
            id: "mcp_exa_docs",
            slug: "exa_docs",
            name: "Exa Docs",
            url: "https://exa-docs.example.com",
            headers: {},
            transport: "streamable_http",
            command: null,
            args: null,
            env: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object" } }]
        }
      ]
    });

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mcp_exa_docs" }),
      "search",
      { query: "MCP" },
      undefined
    );
    expect(result.answer).toBe("Resolved the specific server");
  });

  it("returns a tool error when execute_shell_command is called without a command", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "execute_shell_command", arguments: JSON.stringify({}) }],
          usage: { inputTokens: 4 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Need a command." }], {
          answer: "Need a command.",
          thinking: "",
          usage: { inputTokens: 5, outputTokens: 2 }
        })
      );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Run a command" }],
      skills: [],
      mcpToolSets: [],
      onActionStart: () => "act_shell"
    });

    expect(executeLocalShellCommand).not.toHaveBeenCalled();
    expect(result.answer).toBe("Need a command.");
  });

  it("stops after the maximum number of control steps", async () => {
    const { MAX_ASSISTANT_CONTROL_STEPS } = await import("@/lib/constants");

    streamProviderResponse.mockImplementation(() =>
      createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{ id: "call_loop", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "loop" }) }],
        usage: { inputTokens: 1 }
      })
    );
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Loop result" }]
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await expect(
      resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Loop forever" }],
        skills: [],
        mcpToolSets: [{
          server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
        }]
      })
    ).rejects.toThrow("Assistant exceeded the maximum number of tool steps");

    expect(streamProviderResponse).toHaveBeenCalledTimes(MAX_ASSISTANT_CONTROL_STEPS + 1);
  });

  it("forces a final direct answer when the tool loop would otherwise exhaust the step budget", async () => {
    const { MAX_ASSISTANT_CONTROL_STEPS } = await import("@/lib/constants");

    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      if (!tools?.length) {
        return createProviderStream([{ type: "answer_delta", text: "Final answer without more tools" }], {
          answer: "Final answer without more tools",
          thinking: "",
          usage: { inputTokens: 2, outputTokens: 4 }
        });
      }

      return createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{ id: `call_${Math.random()}`, name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "loop" }) }],
        usage: { inputTokens: 1 }
      });
    });
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Loop result" }]
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Loop forever" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" } }]
      }]
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(MAX_ASSISTANT_CONTROL_STEPS + 1);
    expect(result.answer).toBe("Final answer without more tools");
  });

  it("retries when the provider returns an empty direct answer without tool calls", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "Reasoning only",
          usage: { inputTokens: 5, reasoningTokens: 4 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Connected" }], {
          answer: "Connected",
          thinking: "",
          usage: { inputTokens: 3, outputTokens: 1 }
        })
      );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Reply with connected." }],
      skills: [],
      mcpToolSets: [],
      onEvent: () => {}
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(2);
    expect(streamProviderResponse.mock.calls[1][0].promptMessages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Do not emit an empty response.")
      })
    );
    expect(result.answer).toBe("Connected");
  });

  it("streams thinking and answer deltas before the provider finishes", async () => {
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    let resolveGate: () => void;
    const gate = new Promise<void>((resolve) => { resolveGate = resolve; });

    streamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "thinking_delta", text: "Thinking " } satisfies ChatStreamEvent;
        yield { type: "answer_delta", text: "Hello" } satisfies ChatStreamEvent;
        await gate;
        return {
          answer: "Hello",
          thinking: "Thinking ",
          usage: { outputTokens: 1, reasoningTokens: 1 }
        };
      })()
    );

    const emitted: ChatStreamEvent[] = [];

    const pending = resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Say hello" }],
      skills: [],
      mcpToolSets: [],
      onEvent: (event) => emitted.push(event)
    });

    await vi.waitFor(() => {
      expect(emitted).toEqual([
        { type: "thinking_delta", text: "Thinking " },
        { type: "answer_delta", text: "Hello" }
      ]);
    });

    resolveGate!();

    const result = await pending;

    expect(result.answer).toBe("Hello");
    expect(result.thinking).toBe("Thinking ");
  });

  it("uses coerced MCP args in the runtime action trail", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_exa_search", arguments: JSON.stringify({ query: "test", freshness: "today" }) }],
          usage: { inputTokens: 10 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Results" }], {
          answer: "Results",
          thinking: "",
          usage: { inputTokens: 20, outputTokens: 1 }
        })
      );
    callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found results" }] });

    const started: Array<Record<string, unknown>> = [];
    const completed: Array<Record<string, unknown>> = [];

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Search recent" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_exa", slug: "exa", name: "Exa", url: "https://exa.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{
          name: "search",
          title: "Search",
          description: "Search",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Query" },
              freshness: { type: "string", enum: ["24h", "week", "month", "year", "any"], description: "Recency" }
            },
            required: ["query"]
          },
          annotations: { readOnlyHint: true }
        }]
      }],
      onEvent: () => {},
      onActionStart: (action) => {
        started.push(action);
      },
      onActionComplete: (_handle, patch) => {
        completed.push(patch);
      }
    });

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mcp_exa" }),
      "search",
      { query: "test", freshness: "month" },
      undefined
    );
    expect(started).toEqual([expect.objectContaining({
      detail: "query=test",
      arguments: {
        query: "test",
        freshness: "month"
      }
    })]);
    expect(completed).toEqual([expect.objectContaining({
      detail: "query=test"
    })]);
  });

  it("commits answer text that appears before tool calls", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Let me search." }], {
          answer: "Let me search.",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
          usage: { inputTokens: 7 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Here are the results." }], {
          answer: "Here are the results.",
          thinking: "",
          usage: { inputTokens: 9, outputTokens: 5 }
        })
      );
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Found MCP docs" }]
    });

    const persistedSegments: string[] = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }],
      onEvent: () => {},
      onAnswerSegment: (segment) => { persistedSegments.push(segment); }
    });

    expect(persistedSegments).toEqual([
      "Let me search.",
      "Here are the results."
    ]);
  });

  describe("memory tools", () => {
    it("includes memory tools when memoriesEnabled is true", async () => {
      const seenToolNames: string[][] = [];
      streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
        seenToolNames.push((tools ?? []).map((tool) => tool.function.name));
        return createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
        });
      });

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
      await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Hello" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onActionStart: () => {},
        onActionComplete: () => {}
      });

      expect(seenToolNames[0]).toContain("create_memory");
      expect(seenToolNames[0]).toContain("update_memory");
      expect(seenToolNames[0]).toContain("delete_memory");
    });

    it("does not include memory tools when memoriesEnabled is false", async () => {
      const seenToolNames: string[][] = [];
      streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
        seenToolNames.push((tools ?? []).map((tool) => tool.function.name));
        return createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
        });
      });

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
      await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Hello" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: false,
        onEvent: () => {},
        onActionStart: () => {},
        onActionComplete: () => {}
      });

      expect(seenToolNames[0]).not.toContain("create_memory");
    });

    it("proposes create_memory tool calls instead of writing immediately", async () => {
      streamProviderResponse
        .mockReturnValueOnce(
          createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{ id: "call_1", name: "create_memory", arguments: JSON.stringify({ content: "User lives in Montreal", category: "location" }) }],
            usage: { inputTokens: 10 }
          })
        )
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "Saved" }], {
            answer: "Saved", thinking: "", usage: { inputTokens: 5, outputTokens: 1 }
          })
        );

      const started: Array<Record<string, unknown>> = [];
      const completed: Array<{ handle?: string; resultSummary?: string }> = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "I live in Montreal" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onActionStart: (action) => { started.push(action); return "act_mem"; },
        onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
      });

      expect(createMemoryFn).not.toHaveBeenCalled();
      expect(started).toEqual([expect.objectContaining({
        kind: "create_memory",
        status: "pending",
        proposalState: "pending",
        proposalPayload: {
          operation: "create",
          targetMemoryId: null,
          proposedMemory: {
            content: "User lives in Montreal",
            category: "location"
          }
        }
      })]);
      expect(completed).toEqual([]);
      expect(result.answer).toBe("Saved");
    });

    it("does not force a second assistant pass when a memory proposal already has a direct answer", async () => {
      streamProviderResponse.mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Nice to meet you, Charles." }], {
          answer: "Nice to meet you, Charles.",
          thinking: "",
          toolCalls: [
            {
              id: "call_1",
              name: "create_memory",
              arguments: JSON.stringify({
                content: "User name is Charles",
                category: "personal"
              })
            }
          ],
          usage: { inputTokens: 10, outputTokens: 5 }
        })
      );

      const started: Array<Record<string, unknown>> = [];
      const persistedSegments: string[] = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Hi, my name is Charles." }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onAnswerSegment: (segment) => {
          persistedSegments.push(segment);
        },
        onActionStart: (action) => {
          started.push(action);
          return "act_mem";
        }
      });

      expect(streamProviderResponse).toHaveBeenCalledTimes(1);
      expect(persistedSegments).toEqual(["Nice to meet you, Charles."]);
      expect(started).toEqual([
        expect.objectContaining({
          kind: "create_memory",
          status: "pending",
          proposalState: "pending"
        })
      ]);
      expect(result.answer).toBe("Nice to meet you, Charles.");
    });

    it("retries when the model narrates a memory save without calling a memory tool", async () => {
      streamProviderResponse
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "Let me save that for later." }], {
            answer: "Let me save that for later.",
            thinking: "",
            usage: { inputTokens: 8, outputTokens: 5 }
          })
        )
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "Nice to meet you, Charles." }], {
            answer: "Nice to meet you, Charles.",
            thinking: "",
            toolCalls: [
              {
                id: "call_1",
                name: "create_memory",
                arguments: JSON.stringify({
                  content: "User name is Charles",
                  category: "personal"
                })
              }
            ],
            usage: { inputTokens: 10, outputTokens: 5 }
          })
        );

      const started: Array<Record<string, unknown>> = [];
      const persistedSegments: string[] = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Hi, my name is Charles." }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onAnswerSegment: (segment) => {
          persistedSegments.push(segment);
        },
        onActionStart: (action) => {
          started.push(action);
          return "act_mem";
        }
      });

      expect(streamProviderResponse).toHaveBeenCalledTimes(2);
      expect(persistedSegments).toEqual(["Nice to meet you, Charles."]);
      expect(started).toEqual([
        expect.objectContaining({
          kind: "create_memory",
          status: "pending",
          proposalState: "pending"
        })
      ]);
      expect(result.answer).toBe("Nice to meet you, Charles.");
    });

    it("retries when the model claims it proposed a memory change without calling a memory tool", async () => {
      streamProviderResponse
        .mockReturnValueOnce(
          createProviderStream(
            [{ type: "answer_delta", text: "I've proposed to add your DevOps Engineer role back to your work memories. It'll be saved once you approve it." }],
            {
              answer: "I've proposed to add your DevOps Engineer role back to your work memories. It'll be saved once you approve it.",
              thinking: "",
              usage: { inputTokens: 8, outputTokens: 19 }
            }
          )
        )
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "I can add that back to memory." }], {
            answer: "I can add that back to memory.",
            thinking: "",
            toolCalls: [
              {
                id: "call_1",
                name: "create_memory",
                arguments: JSON.stringify({
                  content: "User works as a DevOps Engineer",
                  category: "work"
                })
              }
            ],
            usage: { inputTokens: 10, outputTokens: 8 }
          })
        );

      const started: Array<Record<string, unknown>> = [];
      const persistedSegments: string[] = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "lets add it back" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onAnswerSegment: (segment) => {
          persistedSegments.push(segment);
        },
        onActionStart: (action) => {
          started.push(action);
          return "act_mem";
        }
      });

      expect(streamProviderResponse).toHaveBeenCalledTimes(2);
      expect(persistedSegments).toEqual(["I can add that back to memory."]);
      expect(started).toEqual([
        expect.objectContaining({
          kind: "create_memory",
          status: "pending",
          proposalState: "pending"
        })
      ]);
      expect(result.answer).toBe("I can add that back to memory.");
    });

    it("proposes update_memory tool calls instead of writing immediately", async () => {
      getMemoryRecord.mockReturnValue({ id: "mem_test", content: "Old fact", category: "personal" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      streamProviderResponse
        .mockReturnValueOnce(
          createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{ id: "call_1", name: "update_memory", arguments: JSON.stringify({ id: "mem_test", content: "Updated fact" }) }],
            usage: { inputTokens: 10 }
          })
        )
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "Updated" }], {
            answer: "Updated", thinking: "", usage: { inputTokens: 5, outputTokens: 1 }
          })
        );

      const started: Array<Record<string, unknown>> = [];
      const completed: Array<{ handle?: string; resultSummary?: string }> = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "I moved to Toronto" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onActionStart: (action) => { started.push(action); return "act_mem"; },
        onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
      });

      expect(updateMemoryRecord).not.toHaveBeenCalled();
      expect(started).toEqual([expect.objectContaining({
        kind: "update_memory",
        status: "pending",
        proposalState: "pending",
        proposalPayload: {
          operation: "update",
          targetMemoryId: "mem_test",
          currentMemory: {
            id: "mem_test",
            content: "Old fact",
            category: "personal"
          },
          proposedMemory: {
            content: "Updated fact",
            category: "personal"
          }
        }
      })]);
      expect(completed).toEqual([]);
      expect(result.answer).toBe("Updated");
    });

    it("proposes delete_memory tool calls instead of writing immediately", async () => {
      getMemoryRecord.mockReturnValue({ id: "mem_test", content: "Outdated fact", category: "other" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      streamProviderResponse
        .mockReturnValueOnce(
          createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{ id: "call_1", name: "delete_memory", arguments: JSON.stringify({ id: "mem_test" }) }],
            usage: { inputTokens: 10 }
          })
        )
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "Deleted" }], {
            answer: "Deleted", thinking: "", usage: { inputTokens: 5, outputTokens: 1 }
          })
        );

      const started: Array<Record<string, unknown>> = [];
      const completed: Array<{ handle?: string; resultSummary?: string }> = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Forget that thing" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {},
        onActionStart: (action) => { started.push(action); return "act_mem"; },
        onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
      });

      expect(deleteMemoryRecord).not.toHaveBeenCalled();
      expect(started).toEqual([expect.objectContaining({
        kind: "delete_memory",
        status: "pending",
        proposalState: "pending",
        proposalPayload: {
          operation: "delete",
          targetMemoryId: "mem_test",
          currentMemory: {
            id: "mem_test",
            content: "Outdated fact",
            category: "other"
          }
        }
      })]);
      expect(completed).toEqual([]);
      expect(result.answer).toBe("Deleted");
    });

    it("rejects create_memory when memory limit is reached", async () => {
      getMemoryCountFn.mockReturnValue(100);
      streamProviderResponse
        .mockReturnValueOnce(
          createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{ id: "call_1", name: "create_memory", arguments: JSON.stringify({ content: "One more", category: "other" }) }],
            usage: { inputTokens: 10 }
          })
        )
        .mockReturnValueOnce(
          createProviderStream([{ type: "answer_delta", text: "Try updating instead" }], {
            answer: "Try updating instead", thinking: "", usage: { inputTokens: 5, outputTokens: 1 }
          })
        );

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Remember this" }],
        skills: [],
        mcpToolSets: [],
        memoriesEnabled: true,
        onEvent: () => {}
      });

      expect(createMemoryFn).not.toHaveBeenCalled();
      expect(result.answer).toBe("Try updating instead");
    });
  });

  it("stops before executing a tool call when cancellation is requested", async () => {
    const abortController = new AbortController();

    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{ id: "call_1", name: "mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
        usage: { inputTokens: 9 }
      })
    );

    const { ChatTurnStoppedError, createChatTurnControl } = await import("@/lib/chat-turn-control");
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    const control = createChatTurnControl("conv_1", abortController);
    control.requestStop();

    await expect(resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }],
      skills: [],
      mcpToolSets: [],
      abortSignal: abortController.signal,
      throwIfStopped: control.throwIfStopped
    })).rejects.toBeInstanceOf(ChatTurnStoppedError);

    expect(callMcpTool).not.toHaveBeenCalled();
  });
});
