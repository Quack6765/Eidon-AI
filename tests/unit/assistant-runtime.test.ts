import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderResponseItem,
  RuntimeProviderProfile,
  Skill
} from "@/lib/types";
import { createRuntimeAppSettings, createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const streamProviderResponse = vi.fn();
const callProviderText = vi.fn();
const callMcpTool = vi.fn();
const discoverMcpTools = vi.fn();
const getToolResultText = vi.fn();
const localShellMocks = vi.hoisted(() => ({
  executeLocalShellCommand: vi.fn(),
  summarizeShellResult: vi.fn()
}));
const getMemoryRecord = vi.fn();
const createMemoryFn = vi.fn();
const updateMemoryRecord = vi.fn();
const deleteMemoryRecord = vi.fn();
const getMemoryCountFn = vi.fn();
const getSettingsFn = vi.fn();
const searchSearxng = vi.fn();
const generateGoogleNanoBananaImages = vi.fn();
const createAttachments = vi.fn();
const bindAttachmentsToMessage = vi.fn();
const deleteAttachmentById = vi.fn();
const resolveAttachmentPath = vi.fn();
const resolveAbsoluteImagePathPart = vi.fn();

vi.mock("@/lib/provider", () => ({
  streamProviderResponse,
  callProviderText
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool,
  discoverMcpTools,
  getToolResultText,
  MAX_MCP_RESULT_CHARS: 32_000
}));

vi.mock("@/lib/local-shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/local-shell")>();
  return {
    ...actual,
    executeLocalShellCommand: localShellMocks.executeLocalShellCommand,
    summarizeShellResult: localShellMocks.summarizeShellResult
  };
});

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

vi.mock("@/lib/image-generation/google-nano-banana", () => ({
  generateGoogleNanoBananaImages
}));

vi.mock("@/lib/attachments", () => ({
  createAttachments,
  bindAttachmentsToMessage,
  deleteAttachmentById,
  resolveAttachmentPath,
  resolveAbsoluteImagePathPart
}));

function createProviderStream(
  events: ChatStreamEvent[],
  result: {
    answer: string;
    thinking: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    responseItems?: ProviderResponseItem[];
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
      responseItems: result.responseItems,
      usage: result.usage
    };
  })();
}

function createSettings(): RuntimeProviderProfile {
  return createRuntimeProviderProfile({
    id: "profile_test",
    name: "Test profile",
    model: "gpt-5-mini",
    systemPrompt: "Be exact.",
    temperature: 0.2,
    maxOutputTokens: 512,
    modelContextLimit: 16000,
    freshTailCount: 12
  });
}

function createAppSettings(overrides = {}) {
  return createRuntimeAppSettings({
    skillsEnabled: false,
    conversationRetention: "30d",
    memoriesEnabled: false,
    mcpTimeout: 30000,
    imageGeneration: {
      providerId: "google_nano_banana",
      credentials: { apiKey: "google-secret" }
    },
    ...overrides
  });
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
    callProviderText.mockReset();
    callMcpTool.mockReset();
    discoverMcpTools.mockReset();
    getToolResultText.mockReset();
    localShellMocks.executeLocalShellCommand.mockReset();
    localShellMocks.summarizeShellResult.mockReset();
    getMemoryRecord.mockReset();
    createMemoryFn.mockReset();
    updateMemoryRecord.mockReset();
    deleteMemoryRecord.mockReset();
    getMemoryCountFn.mockReset();
    getSettingsFn.mockReset();
    getMemoryCountFn.mockReturnValue(0);
    getSettingsFn.mockReturnValue({ memoriesMaxCount: 100 });
    searchSearxng.mockReset();
    generateGoogleNanoBananaImages.mockReset();
    createAttachments.mockReset();
    bindAttachmentsToMessage.mockReset();
    deleteAttachmentById.mockReset();
    resolveAttachmentPath.mockReset();
    resolveAttachmentPath.mockImplementation(({ relativePath }: { relativePath: string }) => `/tmp/${relativePath}`);
    resolveAbsoluteImagePathPart.mockReset();
    resolveAbsoluteImagePathPart.mockImplementation((absolutePath: string) => ({
      type: "image" as const,
      attachmentId: "att_mock",
      filename: absolutePath.split("/").pop() ?? "photo.png",
      mimeType: "image/png",
      relativePath: absolutePath.replace(/^\/tmp\//, "")
    }));
    callProviderText.mockImplementation(({ prompt }: { prompt: string }) => {
      const latestUserLine = prompt.match(/Latest user request:\s*user:\s*([\s\S]*)$/)?.[1]?.trim() ?? "";
      return `\`\`\`json
${JSON.stringify({
  imagePrompt: latestUserLine || "compiled image",
  negativePrompt: "",
  assistantText: "",
  aspectRatio: "1:1",
  count: 1
})}
\`\`\``;
    });
    getToolResultText.mockImplementation((result: { content?: Array<{ text?: string }> }) => {
      return result.content?.[0]?.text ?? "done";
    });
    localShellMocks.summarizeShellResult.mockImplementation((result: { stdout?: string; stderr?: string }) => {
      return result.stdout || result.stderr || "done";
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("reports the final provider call's usage, not the sum across tool steps", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "load_skill", arguments: JSON.stringify({ skill_name: "Release Notes" }) }],
          usage: { inputTokens: 100 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done",
          thinking: "",
          usage: { inputTokens: 5000, outputTokens: 200 }
        })
      );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Write release notes" }],
      skills: [createSkill()],
      mcpToolSets: [],
      onEvent: () => {},
      onActionStart: () => "act_skill",
      onActionComplete: () => {}
    });

    expect(result.usage.inputTokens).toBe(5000);
    expect(result.usage.outputTokens).toBe(200);
  });

  it("keeps assistant reasoning on the replayed tool-call message", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "Need to load the release-notes skill.",
          toolCalls: [{ id: "call_1", name: "load_skill", arguments: JSON.stringify({ skill_name: "Release Notes" }) }],
          responseItems: [{
            id: "fc_1",
            type: "function_call",
            call_id: "call_1",
            name: "load_skill",
            arguments: JSON.stringify({ skill_name: "Release Notes" })
          }],
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

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Write release notes" }],
      skills: [createSkill()],
      mcpToolSets: [],
      onEvent: () => {},
      onActionStart: () => "act_skill",
      onActionComplete: () => {}
    });

    const replayMessages = (streamProviderResponse.mock.calls[1]?.[0]?.promptMessages ?? []) as PromptMessage[];
    const assistantReplay = replayMessages.find((message) => message.role === "assistant");

    expect(assistantReplay).toEqual(
      expect.objectContaining({
        role: "assistant",
        reasoningContent: "Need to load the release-notes skill.",
        responseItems: [{
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "load_skill",
          arguments: JSON.stringify({ skill_name: "Release Notes" })
        }],
        toolCalls: [{ id: "call_1", name: "load_skill", arguments: JSON.stringify({ skill_name: "Release Notes" }) }]
      })
    );
    expect(replayMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", toolCallId: "call_1" })
      ])
    );
  });

  it("tells the model when a configured MCP server requires authentication", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Done" }], {
        answer: "Done",
        thinking: "",
        usage: { inputTokens: 10, outputTokens: 1 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    const composioServer = {
      id: "mcp_composio",
      slug: "composio",
      name: "Composio",
      url: "https://connect.composio.dev/mcp",
      headers: {},
      transport: "streamable_http" as const,
      command: null,
      args: null,
      env: null,
      enabled: true,
      isVisionMcp: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Use Composio" }],
      skills: [],
      mcpServers: [composioServer],
      mcpToolSets: [{ server: composioServer, tools: [], authRequired: true }],
      onEvent: () => {},
      onActionStart: () => {},
      onActionComplete: () => {}
    });

    const firstCallMessages = streamProviderResponse.mock.calls[0][0].promptMessages as Array<{
      role: string;
      content: string;
    }>;
    const systemMessage = firstCallMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("- Composio (requires authentication");
    expect(systemMessage?.content).toContain("Settings → MCP");
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
        server: { id: "mcp_exa", slug: "exa", name: "Exa", url: "https://exa.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      onEvent: () => {},
      onActionStart: () => {},
      onActionComplete: () => {}
    });

    const toolDefs = streamProviderResponse.mock.calls[0][0].tools!;
    const webSearchTool = toolDefs.find((tool: any) => tool.function.name === "web_search");
    expect(webSearchTool).toBeDefined();
    expect(webSearchTool.function.description).toContain("configured provider");
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
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
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
      maxResults: undefined,
      abortSignal: expect.any(AbortSignal)
    });
    expect(started).toEqual([
      expect.objectContaining({
        label: "Web search",
        serverId: "integration_web_search",
        toolName: "web_search"
      })
    ]);
    expect(completed).toEqual([{ handle: "act_web_search", resultSummary: "SearXNG result text" }]);
    expect(result.answer).toBe("Final answer");
  });

  it("executes Tavily through the stable web search action", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_1",
            name: "web_search",
            arguments: JSON.stringify({ query: "latest AI" })
          }],
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
    discoverMcpTools.mockResolvedValue([{ name: "tavily_search" }]);
    callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found AI news" }] });

    const started: Array<{ label: string; serverId?: string | null; toolName?: string | null }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find AI news" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings({
        webSearch: {
          providerId: "tavily",
          credentials: { apiKey: "tavily-test-key" }
        }
      }),
      onEvent: () => {},
      onActionStart: (action) => {
        started.push(action);
        return "act_tool";
      }
    });

    expect(started).toEqual([
      expect.objectContaining({
        label: "Web search",
        serverId: "integration_web_search",
        toolName: "web_search"
      })
    ]);
    expect(result.answer).toBe("Final answer");
  });

  it("recovers the turn with an error tool result when a Tavily search never settles", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_1",
            name: "web_search",
            arguments: JSON.stringify({ query: "latest AI" })
          }],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Answer without search" }], {
          answer: "Answer without search",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );
    discoverMcpTools.mockResolvedValue([{ name: "tavily_search" }]);
    callMcpTool.mockImplementation(() => new Promise(() => {}));

    const errored: Array<{ handle?: string; resultSummary?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find AI news" }],
      skills: [],
      mcpToolSets: [],
      mcpTimeout: 500,
      appSettings: createAppSettings({
        webSearch: {
          providerId: "tavily",
          credentials: { apiKey: "tavily-test-key" }
        }
      }),
      onEvent: () => {},
      onActionStart: () => "act_tool",
      onActionError: (handle, patch) => {
        errored.push({ handle, resultSummary: patch.resultSummary });
      }
    });

    expect(errored).toEqual([
      { handle: "act_tool", resultSummary: expect.stringMatching(/Web search timed out after \d+ seconds/) }
    ]);
    expect(result.answer).toBe("Answer without search");
  }, 15_000);

  it("exposes the parallel queries tool schema while the pipeline is active", async () => {
    const { buildToolDefinitions } = await import("@/lib/tool-definitions");

    const tools = buildToolDefinitions({
      mcpToolSets: [],
      skills: [],
      loadedSkillIds: new Set(),
      memoriesEnabled: false,
      webSearchEnabled: true,
      webSearchPipelineMode: "auto",
      effectiveVisionMode: "provider"
    });
    const webSearchTool = tools.find((tool) => tool.function.name === "web_search")!;

    expect(webSearchTool.function.description).toContain("parallel");
    expect(webSearchTool.function.parameters).toMatchObject({
      properties: {
        query: { type: "string" },
        queries: { type: "array", items: { type: "string" } }
      }
    });
    expect(webSearchTool.function.parameters).not.toHaveProperty("required");
  });

  it("keeps the legacy tool schema when the pipeline is off", async () => {
    const { buildToolDefinitions } = await import("@/lib/tool-definitions");

    const tools = buildToolDefinitions({
      mcpToolSets: [],
      skills: [],
      loadedSkillIds: new Set(),
      memoriesEnabled: false,
      webSearchEnabled: true,
      webSearchPipelineMode: "off",
      effectiveVisionMode: "provider"
    });
    const webSearchTool = tools.find((tool) => tool.function.name === "web_search")!;

    expect(webSearchTool.function.parameters).toMatchObject({
      properties: { query: { type: "string" } },
      required: ["query"]
    });
    expect((webSearchTool.function.parameters!.properties as Record<string, unknown>)).not.toHaveProperty("queries");
  });

  it("fans a single web search out into parallel sub-queries via the planner", async () => {
    callProviderText.mockResolvedValueOnce(
      '{"action":"fan_out","subqueries":["vision pro price","vision pro review 2026"]}'
    );
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "vision pro" }) }],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Synthesized answer" }], {
          answer: "Synthesized answer",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );
    searchSearxng.mockResolvedValue("SearXNG result text");

    const started: Array<{ label: string; detail?: string }> = [];
    const completed: Array<{ handle?: string; resultSummary?: string }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "What about the vision pro?" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      onEvent: () => {},
      onActionStart: (action) => {
        started.push(action);
        return "act_web_search";
      },
      onActionComplete: (handle, patch) => {
        completed.push({ handle, resultSummary: patch.resultSummary });
      }
    });

    expect(callProviderText).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "web_search_planning"
    }));
    const searchedQueries = searchSearxng.mock.calls.map((call) => call[0].query);
    expect(searchedQueries).toEqual(["vision pro price", "vision pro review 2026"]);
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(completed[0].resultSummary).toContain("Parallel web search results (2 queries: 2 succeeded, 0 failed)");
    expect(result.answer).toBe("Synthesized answer");
  });

  it("executes same-step web search calls concurrently", async () => {
    const started: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    searchSearxng.mockImplementation(async ({ query }: { query: string }) => {
      started.push(query);
      await gate;
      return `result ${query}`;
    });

    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [
            { id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "alpha query" }) },
            { id: "call_2", name: "web_search", arguments: JSON.stringify({ query: "beta query" }) }
          ],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const runPromise = resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "search two things" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      onEvent: () => {},
      onActionStart: () => "act_ws"
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(started).toEqual(["alpha query", "beta query"]);

    release();
    const result = await runPromise;
    expect(result.answer).toBe("Done");

    const followUpMessages = streamProviderResponse.mock.calls[1][0].promptMessages as Array<{
      role: string;
      content: unknown;
    }>;
    const toolResults = followUpMessages.filter((message) => message.role === "tool");
    expect(toolResults.map((message) => message.content)).toEqual([
      "result alpha query",
      "result beta query"
    ]);
  });

  it("keeps mixed steps sequential and appends results in call order", async () => {
    searchSearxng.mockResolvedValue("SearXNG result text");
    localShellMocks.executeLocalShellCommand.mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      isError: false
    });
    localShellMocks.summarizeShellResult.mockReturnValue("shell ok");

    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [
            { id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "mixed search" }) },
            {
              id: "call_2",
              name: "execute_shell_command",
              arguments: JSON.stringify({ command: "echo hi" })
            }
          ],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "search and run a command" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      onEvent: () => {},
      onActionStart: () => "act_mixed"
    });

    expect(result.answer).toBe("Done");

    const followUpMessages = streamProviderResponse.mock.calls[1][0].promptMessages as Array<{
      role: string;
      content: unknown;
    }>;
    const toolResults = followUpMessages.filter((message) => message.role === "tool");
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0].content).toBe("SearXNG result text");
    expect(String(toolResults[1].content)).toContain("shell ok");
  });

  it("tells the model to answer now after a successful web search", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{ id: "call_1", name: "web_search", arguments: JSON.stringify({ query: "breaking news" }) }],
          usage: { inputTokens: 9 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Here is the news." }], {
          answer: "Here is the news.",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );
    searchSearxng.mockResolvedValue("SearXNG result text");

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "news?" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      onEvent: () => {},
      onActionStart: () => "act_ws"
    });

    expect(result.answer).toBe("Here is the news.");
    const followUpMessages = streamProviderResponse.mock.calls[1][0].promptMessages as Array<{
      role: string;
      content: unknown;
    }>;
    const directiveMessage = followUpMessages.find(
      (message) =>
        message.role === "system" &&
        typeof message.content === "string" &&
        message.content.includes("Answer the user now by synthesizing the results above")
    );
    expect(directiveMessage).toBeDefined();
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
    localShellMocks.executeLocalShellCommand.mockResolvedValue({
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
    expect(localShellMocks.executeLocalShellCommand).toHaveBeenCalledWith({
      command: "curl -I https://example.com",
      timeoutMs: undefined
    });
    expect(result.answer).toBe("Probed the endpoint.");
  });

  it("labels agent-browser shell commands as Web browser", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_1",
            name: "execute_shell_command",
            arguments: JSON.stringify({ command: "agent-browser open https://example.com" })
          }],
          usage: { inputTokens: 7 }
        })
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Opened the page." }], {
          answer: "Opened the page.",
          thinking: "",
          usage: { inputTokens: 8, outputTokens: 2 }
        })
      );
    localShellMocks.executeLocalShellCommand.mockResolvedValue({
      stdout: "Page opened",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      isError: false
    });

    const started: Array<{ kind: string; label: string; detail?: string }> = [];

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Open example.com in the browser" }],
      skills: [],
      mcpToolSets: [],
      onActionStart: (action) => { started.push(action); return "act_shell"; },
      onActionComplete: () => undefined
    });

    expect(started).toEqual([
      expect.objectContaining({
        kind: "shell_command",
        label: "Web browser",
        detail: "agent-browser open https://example.com"
      })
    ]);
    expect(result.answer).toBe("Opened the page.");
  });

  it("allows generate_image only once per turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:34:56Z"));

    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      providerCallCount += 1;
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];

      if (providerCallCount === 1) {
        expect(toolNames).toContain("generate_image");
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_1",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "a simple blue square" })
          }],
          usage: { inputTokens: 9 }
        });
      }

      if (providerCallCount === 2) {
        expect(toolNames).not.toContain("generate_image");
        const systemPrompt = String(streamProviderResponse.mock.calls[1]?.[0]?.promptMessages?.[0]?.content ?? "");
        expect(systemPrompt).toContain("Image generation is available in this environment");
        expect(systemPrompt).toContain("Do not claim that image generation is unavailable");
        return createProviderStream([{ type: "answer_delta", text: "Here is the generated image." }], {
          answer: "Here is the generated image.",
          thinking: "",
          usage: { outputTokens: 5 }
        });
      }

      throw new Error(`Unexpected provider invocation ${providerCallCount}`);
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate a simple blue square" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("Here is the generated image.");
    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
    expect(createAttachments).toHaveBeenCalledTimes(1);
    expect(bindAttachmentsToMessage).toHaveBeenCalledWith("conv_image", "msg_assistant_image", ["att_1"]);
  });

  it("removes generated attachments when cancellation arrives after the file write", async () => {
    const controller = new AbortController();
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{
          id: "call_image_abort",
          name: "generate_image",
          arguments: JSON.stringify({ prompt: "a blue square" })
        }],
        usage: { inputTokens: 5 }
      })
    );
    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation(() => {
      controller.abort();
      return [{ id: "att_abort", filename: "generated-1.png" }];
    });

    const { ChatTurnStoppedError } = await import("@/lib/chat-turn-control");
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await expect(resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate a blue square" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image_abort",
      assistantMessageId: "msg_image_abort",
      abortSignal: controller.signal
    })).rejects.toBeInstanceOf(ChatTurnStoppedError);

    expect(deleteAttachmentById).toHaveBeenCalledWith("att_abort", {
      allowAssigned: true
    });
    expect(bindAttachmentsToMessage).not.toHaveBeenCalled();
  });

  it("injects the mermaid diagram directive into the system prompt", async () => {
    streamProviderResponse.mockImplementation(({ promptMessages }: { promptMessages?: Array<{ content: string }> }) => {
      const systemPrompt = String(promptMessages?.[0]?.content ?? "");
      expect(systemPrompt).toContain("mermaid");
      expect(systemPrompt).toContain("graph TD");
      expect(systemPrompt).toContain("Always prefer mermaid diagrams over ASCII art");
      return createProviderStream([{ type: "answer_delta", text: "Done." }], {
        answer: "Done.",
        thinking: "",
        usage: { outputTokens: 2 }
      });
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Draw a flowchart" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_mermaid",
      assistantMessageId: "msg_mermaid"
    });

    expect(result.answer).toBe("Done.");
  });

  it("binds every generated assistant attachment to the provided assistant message id", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(() => {
      providerCallCount += 1;

      if (providerCallCount === 1) {
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_multi",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "two blue squares", count: 2 })
          }],
          usage: { inputTokens: 8 }
        });
      }

      return createProviderStream([{ type: "answer_delta", text: "Attached two images." }], {
        answer: "Attached two images.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [
        {
          bytes: Buffer.from("png-one"),
          mimeType: "image/png",
          filename: "generated-1.png"
        },
        {
          bytes: Buffer.from("png-two"),
          mimeType: "image/png",
          filename: "generated-2.png"
        }
      ]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate two blue squares" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("Attached two images.");
    expect(bindAttachmentsToMessage).toHaveBeenCalledWith(
      "conv_image",
      "msg_assistant_image",
      ["att_1", "att_2"]
    );
  });

  it("recompiles image generation from the latest user request even if the model combines earlier prompts", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(() => {
      providerCallCount += 1;

      if (providerCallCount === 1) {
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_latest_only",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "generate a picture of a mage and generate a picture of a cat", count: 2 })
          }],
          usage: { inputTokens: 7 }
        });
      }

      return createProviderStream([{ type: "answer_delta", text: "Here is the cat." }], {
        answer: "Here is the cat.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [
        { role: "user", content: "generate a picture of a mage" },
        { role: "assistant", content: "Generated 1 image." },
        { role: "user", content: "generate a picture of a cat" }
      ],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(generateGoogleNanoBananaImages).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.objectContaining({
        imagePrompt: "generate a picture of a cat",
        count: 1
      })
    }));
  });

  it("rejects repeated generate_image tool calls in the same model response", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      providerCallCount += 1;
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];

      if (providerCallCount === 1) {
        expect(toolNames).toContain("generate_image");
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [
            {
              id: "call_image_1",
              name: "generate_image",
              arguments: JSON.stringify({ prompt: "a simple blue square" })
            },
            {
              id: "call_image_2",
              name: "generate_image",
              arguments: JSON.stringify({ prompt: "a second blue square" })
            }
          ],
          usage: { inputTokens: 12 }
        });
      }

      expect(toolNames).not.toContain("generate_image");
      return createProviderStream([{ type: "answer_delta", text: "Image already generated." }], {
        answer: "Image already generated.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate the same square twice" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("Image already generated.");
    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
    expect(createAttachments).toHaveBeenCalledTimes(1);
  });

  it("keeps generate_image available after a failed image generation attempt", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      providerCallCount += 1;
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];

      if (providerCallCount === 1) {
        expect(toolNames).toContain("generate_image");
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_failed",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "a simple blue square" })
          }],
          usage: { inputTokens: 6 }
        });
      }

      expect(toolNames).toContain("generate_image");
      const systemPrompt = String(streamProviderResponse.mock.calls[1]?.[0]?.promptMessages?.[0]?.content ?? "");
      expect(systemPrompt).not.toContain("a generated image is already attached in this turn");
      return createProviderStream([{ type: "answer_delta", text: "Image generation failed." }], {
        answer: "Image generation failed.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockRejectedValue(new Error("backend failed"));

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate a simple blue square" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("Image generation failed.");
    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
  });

  it("stops forcing generate_image after one retry and accepts the model's text answer instead of looping", async () => {
    let providerCallCount = 0;
    const emittedEvents: ChatStreamEvent[] = [];
    streamProviderResponse.mockImplementation(() => {
      providerCallCount += 1;
      return createProviderStream(
        [{ type: "answer_delta", text: "Here is some advice instead." }],
        { answer: "Here is some advice instead.", thinking: "", usage: { outputTokens: 4 } }
      );
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate an image of a red square" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image",
      onEvent: (event) => emittedEvents.push(event)
    });

    expect(providerCallCount).toBe(2);
    expect(result.answer).toBe("Here is some advice instead.");
    expect(emittedEvents.filter((event) => event.type === "answer_reset")).toHaveLength(1);
  });

  it("does not force generate_image again after a failed generation attempt and accepts the failure explanation", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(() => {
      providerCallCount += 1;
      if (providerCallCount === 1) {
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_fail",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "a red square" })
          }],
          usage: { inputTokens: 6 }
        });
      }
      return createProviderStream(
        [{ type: "answer_delta", text: "Sorry, image generation is unavailable right now." }],
        { answer: "Sorry, image generation is unavailable right now.", thinking: "", usage: { outputTokens: 4 } }
      );
    });

    generateGoogleNanoBananaImages.mockRejectedValue(new Error("backend failed"));

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate an image of a red square" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(providerCallCount).toBe(2);
    expect(result.answer).toBe("Sorry, image generation is unavailable right now.");
    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
  });

  it("requires generate_image for another-one follow-up requests instead of accepting a hallucinated success message", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(({ tools, promptMessages }: {
      tools?: Array<{ function: { name: string } }>;
      promptMessages?: Array<{ content: string | Array<{ type: string; text?: string }> }>;
    }) => {
      providerCallCount += 1;
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];
      const systemPrompt = String(promptMessages?.[0]?.content ?? "");

      if (providerCallCount === 1) {
        expect(toolNames).toContain("generate_image");
        return createProviderStream([], {
          answer: "I've generated another image for you. It should appear above.",
          thinking: "",
          usage: { inputTokens: 8 }
        });
      }

      if (providerCallCount === 2) {
        expect(toolNames).toContain("generate_image");
        expect(systemPrompt).toContain("The latest user request requires generating a new image");
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_followup",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "another dreamy forest scene" })
          }],
          usage: { inputTokens: 6 }
        });
      }

      return createProviderStream([{ type: "answer_delta", text: "Here is another image." }], {
        answer: "Here is another image.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [
        { role: "user", content: "Generate an image of a Japanese garden at sunset" },
        { role: "assistant", content: "I've generated an image for you." },
        { role: "user", content: "Nice! Create another one" }
      ],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("Here is another image.");
    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
  });

  it("does not force generate_image for follow-up questions about a previous image", async () => {
    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];
      expect(toolNames).toContain("generate_image");
      return createProviderStream([{ type: "answer_delta", text: "The latest image was a Japanese garden at sunset." }], {
        answer: "The latest image was a Japanese garden at sunset.",
        thinking: "",
        usage: { inputTokens: 5, outputTokens: 6 }
      });
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [
        { role: "user", content: "Generate an image of a Japanese garden at sunset" },
        { role: "assistant", content: "I've generated an image for you." },
        { role: "user", content: "What is the latest image you generated?" }
      ],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("The latest image was a Japanese garden at sunset.");
    expect(generateGoogleNanoBananaImages).not.toHaveBeenCalled();
  });

  it("restricts fresh image requests to the generate_image tool until generation succeeds", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      providerCallCount += 1;
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];

      if (providerCallCount === 1) {
        expect(toolNames).toEqual(["generate_image"]);
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_restricted",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "a red square" })
          }],
          usage: { inputTokens: 5 }
        });
      }

      expect(toolNames).toContain("execute_shell_command");
      expect(toolNames).not.toContain("generate_image");
      return createProviderStream([{ type: "answer_delta", text: "Here is the image." }], {
        answer: "Here is the image.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate an image of a red square" }],
      skills: [createSkill()],
      mcpToolSets: [],
      memoriesEnabled: true,
      appSettings: createAppSettings({
        webSearch: {
          providerId: "searxng",
          configuration: { baseUrl: "https://search.example.com" }
        }
      }),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image"
    });

    expect(result.answer).toBe("Here is the image.");
    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
  });

  it("starts a visible image action before the model returns its generate_image tool call and reuses the same handle", async () => {
    const started: Array<{ kind: string; label: string; detail?: string }> = [];
    const completed: Array<{ handle?: string; detail?: string; resultSummary?: string }> = [];
    let providerCallCount = 0;

    streamProviderResponse.mockImplementation(({ tools }: { tools?: Array<{ function: { name: string } }> }) => {
      providerCallCount += 1;
      const toolNames = tools?.map((tool) => tool.function.name) ?? [];

      expect(started).toHaveLength(1);
      expect(started[0]).toEqual(expect.objectContaining({
        kind: "image_generation",
        label: "Generate image"
      }));

      if (providerCallCount === 1) {
        expect(toolNames).toEqual(["generate_image"]);
        return createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_image_visible",
            name: "generate_image",
            arguments: JSON.stringify({ prompt: "a red square" })
          }],
          usage: { inputTokens: 6 }
        });
      }

      return createProviderStream([{ type: "answer_delta", text: "Here is the image." }], {
        answer: "Here is the image.",
        thinking: "",
        usage: { outputTokens: 4 }
      });
    });

    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("png-bytes"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });
    createAttachments.mockImplementation((_conversationId: string, files: Array<{ filename: string }>) =>
      files.map((file, index) => ({
        id: `att_${index + 1}`,
        filename: file.filename
      }))
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Generate an image of a red square" }],
      skills: [],
      mcpToolSets: [],
      appSettings: createAppSettings(),
      conversationId: "conv_image",
      assistantMessageId: "msg_assistant_image",
      onActionStart: (action) => {
        started.push(action);
        return "act_image_visible";
      },
      onActionComplete: (handle, patch) => {
        completed.push({ handle, detail: patch.detail, resultSummary: patch.resultSummary });
      }
    });

    expect(result.answer).toBe("Here is the image.");
    expect(started).toHaveLength(1);
    expect(completed).toEqual([
      expect.objectContaining({
        handle: "act_image_visible",
        detail: "Generate an image of a red square"
      })
    ]);
  });

  it("rewrites image prompts for vision MCP mode before calling the provider", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "I inspected the image." }], {
        answer: "I inspected the image.",
        thinking: "",
        usage: { inputTokens: 4, outputTokens: 2 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const mcpVisionSettings = {
      ...createSettings(),
      visionMode: "mcp" as const
    };

    await resolveAssistantTurn({
      settings: mcpVisionSettings,
      promptMessages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            {
              type: "image",
              attachmentId: "att_image",
              filename: "photo.png",
              mimeType: "image/png",
              relativePath: "conv_image/photo.png"
            }
          ]
        }
      ],
      skills: [],
      mcpToolSets: [],
      visionMcpServers: [
        {
          id: "vision_server",
          slug: "vision",
          name: "Vision MCP",
          url: "https://vision.example.com",
          headers: {},
          transport: "streamable_http",
          command: null,
          args: null,
          env: null,
          enabled: true,
          isVisionMcp: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    expect(firstCall.promptMessages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Vision MCP servers:")
      })
    );
    expect(firstCall.promptMessages[0].content).toContain("- Vision MCP");
    expect(firstCall.promptMessages[0].content).toContain("images or videos");
    expect(firstCall.promptMessages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "text", text: "Attached image: photo.png" }
      ]
    });
  });

  it("uses the non-native vision directive when native vision is set on a non-vision model", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "I cannot view images." }], {
        answer: "I cannot view images.",
        thinking: "",
        usage: { inputTokens: 4, outputTokens: 4 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: { ...createSettings(), model: "gpt-3.5-turbo", visionMode: "native" as const },
      promptMessages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            { type: "image", attachmentId: "att_image", filename: "photo.png", mimeType: "image/png", relativePath: "conv_image/photo.png" }
          ]
        }
      ],
      skills: [],
      mcpToolSets: [],
      visionMcpServers: []
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    expect(firstCall.promptMessages[0].content).toContain("cannot inspect attached images directly");
    expect(firstCall.promptMessages[0].content).not.toContain("Vision MCP servers:");
  });

  it("excludes vision-flagged MCP tools in native mode but keeps other MCP tools", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "done" }], {
        answer: "done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
      })
    );
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const visionServer = { id: "v", slug: "vision", name: "Vision MCP", url: "", headers: {}, transport: "streamable_http" as const, command: null, args: null, env: null, enabled: true, isVisionMcp: true, createdAt: "t", updatedAt: "t" };
    const plainServer = { ...visionServer, id: "p", slug: "plain", name: "Plain", isVisionMcp: false };

    await resolveAssistantTurn({
      settings: { ...createSettings(), visionMode: "native" as const },
      promptMessages: [
        { role: "user", content: [
          { type: "text", text: "hi" },
          { type: "image", attachmentId: "a", filename: "p.png", mimeType: "image/png", relativePath: "c/p.png" }
        ] }
      ],
      skills: [],
      mcpToolSets: [
        { server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object", properties: {} } }] },
        { server: plainServer, tools: [{ name: "do_thing", description: "do", inputSchema: { type: "object", properties: {} } }] }
      ],
      visionMcpServers: [visionServer]
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    const toolNames = (firstCall.tools ?? []).map((t: { function: { name: string } }) => t.function.name);
    expect(toolNames.some((n: string) => n.includes("analyze_image"))).toBe(false);
    expect(toolNames.some((n: string) => n.includes("do_thing"))).toBe(true);
  });

  it("includes vision-flagged MCP tools in mcp mode", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "done" }], {
        answer: "done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
      })
    );
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
    const visionServer = { id: "v", slug: "vision", name: "Vision MCP", url: "", headers: {}, transport: "streamable_http" as const, command: null, args: null, env: null, enabled: true, isVisionMcp: true, createdAt: "t", updatedAt: "t" };

    await resolveAssistantTurn({
      settings: { ...createSettings(), visionMode: "mcp" as const },
      promptMessages: [
        { role: "user", content: [
          { type: "text", text: "hi" },
          { type: "image", attachmentId: "a", filename: "p.png", mimeType: "image/png", relativePath: "c/p.png" }
        ] }
      ],
      skills: [],
      mcpToolSets: [
        { server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object", properties: {} } }] }
      ],
      visionMcpServers: [visionServer]
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    const toolNames = (firstCall.tools ?? []).map((t: { function: { name: string } }) => t.function.name);
    expect(toolNames.some((n: string) => n.includes("analyze_image"))).toBe(true);
  });

  it("omits vision-flagged servers from the capabilities message in native mode", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "done" }], {
        answer: "done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
      })
    );
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const visionServer = { id: "v", slug: "vision", name: "Vision MCP", url: "", headers: {}, transport: "streamable_http" as const, command: null, args: null, env: null, enabled: true, isVisionMcp: true, createdAt: "t", updatedAt: "t" };
    const plainServer = { ...visionServer, id: "p", slug: "plain", name: "Plain", isVisionMcp: false };

    await resolveAssistantTurn({
      settings: { ...createSettings(), visionMode: "native" as const },
      promptMessages: [
        { role: "user", content: [
          { type: "text", text: "hi" },
          { type: "image", attachmentId: "a", filename: "p.png", mimeType: "image/png", relativePath: "c/p.png" }
        ] }
      ],
      skills: [],
      mcpToolSets: [
        { server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object", properties: {} } }] },
        { server: plainServer, tools: [{ name: "do_thing", description: "do", inputSchema: { type: "object", properties: {} } }] }
      ],
      visionMcpServers: [visionServer]
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    const content: string = firstCall.promptMessages[0].content;
    expect(content).toContain("- Plain");
    expect(content).not.toContain("- Vision MCP");
  });

  it("includes vision-flagged servers in the capabilities message in mcp mode", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "done" }], {
        answer: "done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
      })
    );
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const visionServer = { id: "v", slug: "vision", name: "Vision MCP", url: "", headers: {}, transport: "streamable_http" as const, command: null, args: null, env: null, enabled: true, isVisionMcp: true, createdAt: "t", updatedAt: "t" };
    const plainServer = { ...visionServer, id: "p", slug: "plain", name: "Plain", isVisionMcp: false };

    await resolveAssistantTurn({
      settings: { ...createSettings(), visionMode: "mcp" as const },
      promptMessages: [
        { role: "user", content: [
          { type: "text", text: "hi" },
          { type: "image", attachmentId: "a", filename: "p.png", mimeType: "image/png", relativePath: "c/p.png" }
        ] }
      ],
      skills: [],
      mcpToolSets: [
        { server: visionServer, tools: [{ name: "analyze_image", description: "analyze", inputSchema: { type: "object", properties: {} } }] },
        { server: plainServer, tools: [{ name: "do_thing", description: "do", inputSchema: { type: "object", properties: {} } }] }
      ],
      visionMcpServers: [visionServer]
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    const content: string = firstCall.promptMessages[0].content;
    expect(content).toContain("- Vision MCP");
  });

  it("passes runtime tool context only to adapters that execute tools directly", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Done" }], {
        answer: "Done",
        thinking: "",
        usage: { inputTokens: 3, outputTokens: 1 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createRuntimeProviderProfile({ providerKind: "github_copilot" }),
      promptMessages: [{ role: "user", content: "Use the configured tools." }],
      skills: [],
      mcpToolSets: [],
      mcpTimeout: 12345,
      onActionStart: () => undefined,
      onActionComplete: () => undefined,
      onActionError: () => undefined
    });

    expect(streamProviderResponse.mock.calls.at(-1)?.[0].runtimeToolContext).toEqual(
      expect.objectContaining({
        mcpToolSets: [],
        mcpTimeout: 12345
      })
    );
  });

  it("stops immediately when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await expect(
      resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Stop before starting." }],
        skills: [],
        mcpToolSets: [],
        abortSignal: controller.signal
      })
    ).rejects.toThrow();

    expect(streamProviderResponse).not.toHaveBeenCalled();
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
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
            isVisionMcp: false,
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
            isVisionMcp: false,
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

    expect(localShellMocks.executeLocalShellCommand).not.toHaveBeenCalled();
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
          server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
        }]
      })
    ).rejects.toThrow("Assistant exceeded the maximum number of tool steps");

    expect(streamProviderResponse).toHaveBeenCalledTimes(MAX_ASSISTANT_CONTROL_STEPS + 1);
  });

  it("honors a user-configured maxAssistantToolSteps override", async () => {
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
          server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
        }],
        appSettings: createAppSettings({
          maxAssistantToolSteps: 2,
          imageGeneration: { providerId: "disabled" }
        })
      })
    ).rejects.toThrow("Assistant exceeded the maximum number of tool steps");

    expect(streamProviderResponse).toHaveBeenCalledTimes(3);
  });

  it("forces a final direct answer when the tool loop would otherwise exhaust the step budget", async () => {
    const { MAX_ASSISTANT_CONTROL_STEPS } = await import("@/lib/constants");
    const onAnswerSegment = vi.fn();
    const controller = new AbortController();

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
      onAnswerSegment,
      abortSignal: controller.signal,
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" } }]
      }]
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(MAX_ASSISTANT_CONTROL_STEPS + 1);
    expect(result.answer).toBe("Final answer without more tools");
    expect(onAnswerSegment).toHaveBeenCalledWith("Final answer without more tools");
    expect(streamProviderResponse.mock.calls.at(-1)?.[0].abortSignal).toBe(controller.signal);
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

  it("fails with a clear error after one empty-answer retry instead of exhausting the step budget", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(() => {
      providerCallCount += 1;
      return createProviderStream([], {
        answer: "",
        thinking: "reasoning only",
        usage: { inputTokens: 5, reasoningTokens: 4 }
      });
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await expect(
      resolveAssistantTurn({
        settings: createSettings(),
        promptMessages: [{ role: "user", content: "Say hello" }],
        skills: [],
        mcpToolSets: [],
        appSettings: createAppSettings()
      })
    ).rejects.toThrow("Provider returned an empty response");

    expect(providerCallCount).toBe(2);
  });

  it("accepts a narrated memory answer after one retry instead of looping", async () => {
    let providerCallCount = 0;
    streamProviderResponse.mockImplementation(() => {
      providerCallCount += 1;
      return createProviderStream(
        [{ type: "answer_delta", text: "I will remember that for later." }],
        { answer: "I will remember that for later.", thinking: "", usage: { outputTokens: 4 } }
      );
    });

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Hi, my name is Charles." }],
      skills: [],
      mcpToolSets: [],
      memoriesEnabled: true,
      appSettings: createAppSettings()
    });

    expect(providerCallCount).toBe(2);
    expect(result.answer).toBe("I will remember that for later.");
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
        server: { id: "mcp_exa", slug: "exa", name: "Exa", url: "https://exa.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
      { query: "test", freshness: "24h" },
      undefined
    );
    expect(started).toEqual([expect.objectContaining({
      detail: "query=test",
      arguments: {
        query: "test",
        freshness: "24h"
      }
    })]);
    expect(completed).toEqual([expect.objectContaining({
      detail: "query=test"
    })]);
  });

  it("discards preamble answer text streamed before tool calls", async () => {
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
    const emitted: ChatStreamEvent[] = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }],
      skills: [],
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, isVisionMcp: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
      }],
      onEvent: (event) => { emitted.push(event); },
      onAnswerSegment: (segment) => { persistedSegments.push(segment); }
    });

    expect(emitted.filter((event) => event.type === "answer_delta").map((event) => event.type === "answer_delta" && event.text)).toEqual([
      "Let me search.",
      "Here are the results."
    ]);
    expect(emitted.some((event) => event.type === "answer_reset")).toBe(true);
    expect(persistedSegments).toEqual(["Here are the results."]);
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

    it("rejects normal-provider memory tools before reads or proposal writes when cancelled", async () => {
      const controller = new AbortController();
      controller.abort();
      const onActionStart = vi.fn();
      const {
        executeCreateMemory,
        executeDeleteMemory,
        executeUpdateMemory
      } = await import("@/lib/tool-executors");
      const context = {
        memoryUserId: "user-1",
        input: {
          abortSignal: controller.signal,
          onActionStart
        },
        timelineSortOrder: 0,
        promptMessages: []
      };

      await expect(executeCreateMemory(
        "create-1",
        { content: "Remember this", category: "other" },
        context
      )).rejects.toMatchObject({ name: "ChatTurnStoppedError" });
      await expect(executeUpdateMemory(
        "update-1",
        { id: "mem-1", content: "Updated" },
        context
      )).rejects.toMatchObject({ name: "ChatTurnStoppedError" });
      await expect(executeDeleteMemory(
        "delete-1",
        { id: "mem-1" },
        context
      )).rejects.toMatchObject({ name: "ChatTurnStoppedError" });

      expect(getMemoryCountFn).not.toHaveBeenCalled();
      expect(getMemoryRecord).not.toHaveBeenCalled();
      expect(onActionStart).not.toHaveBeenCalled();
    });

    it("stops a normal-provider memory proposal when cancellation arrives during persistence", async () => {
      const controller = new AbortController();
      const onActionStart = vi.fn(() => {
        controller.abort();
        return "memory-action";
      });
      const { executeCreateMemory } = await import("@/lib/tool-executors");

      await expect(executeCreateMemory(
        "create-1",
        { content: "Remember this", category: "other" },
        {
          memoryUserId: "user-1",
          input: {
            abortSignal: controller.signal,
            onActionStart
          },
          timelineSortOrder: 0,
          promptMessages: []
        }
      )).rejects.toMatchObject({ name: "ChatTurnStoppedError" });

      expect(onActionStart).toHaveBeenCalledTimes(1);
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

  describe("provider vision mode", () => {
    function imageMessage(): PromptMessage {
      return {
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          {
            type: "image",
            attachmentId: "att_photo",
            filename: "att_photo_photo.png",
            mimeType: "image/png",
            relativePath: "conv_vision/att_photo_photo.png"
          }
        ]
      };
    }

    function providerVisionSettings(): RuntimeProviderProfile {
      return {
        ...createSettings(),
        visionMode: "provider",
        visionProviderProfileId: "profile_vision"
      };
    }

    function visionProfile(overrides: Partial<RuntimeProviderProfile> = {}): RuntimeProviderProfile {
      return createRuntimeProviderProfile({
        id: "profile_vision",
        name: "Vision profile",
        model: "gpt-4o",
        credentials: { apiKey: "sk-vision" },
        ...overrides
      });
    }

    it("injects the analyze_image tool only in provider mode", async () => {
      streamProviderResponse.mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Analyzed." }], {
          answer: "Analyzed.", thinking: "", usage: { inputTokens: 4, outputTokens: 1 }
        })
      );
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      const toolNames = (streamProviderResponse.mock.calls.at(-1)?.[0].tools ?? [])
        .map((tool: { function: { name: string } }) => tool.function.name);
      expect(toolNames).toContain("analyze_image");
    });

    it("does not inject analyze_image in native or none modes", async () => {
      streamProviderResponse.mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
        })
      );
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      await resolveAssistantTurn({
        settings: { ...createSettings(), visionMode: "native" as const },
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      const toolNames = (streamProviderResponse.mock.calls.at(-1)?.[0].tools ?? [])
        .map((tool: { function: { name: string } }) => tool.function.name);
      expect(toolNames).not.toContain("analyze_image");
    });

    it("replaces images with placeholders and lists attachment paths in provider mode", async () => {
      streamProviderResponse.mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Done" }], {
          answer: "Done", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
        })
      );
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
      expect(firstCall.promptMessages[0].content).toContain("analyze_image");
      expect(firstCall.promptMessages[0].content).toContain(
        "att_photo_photo.png (path: /tmp/conv_vision/att_photo_photo.png)"
      );
      expect(firstCall.promptMessages[1]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "text", text: "Attached image: att_photo_photo.png" }
        ]
      });
    });

    it("throws when the vision profile is missing and the turn contains images", async () => {
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      await expect(resolveAssistantTurn({
        settings: providerVisionSettings(),
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      })).rejects.toThrow("Vision provider profile is not available");
    });

    it("throws when the vision profile is not ready and the turn contains images", async () => {
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      await expect(resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile({ credentials: {} }),
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      })).rejects.toThrow("Set an API key in settings before starting a chat");
    });

    it("allows text-only turns when the vision profile is missing", async () => {
      streamProviderResponse.mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Text only." }], {
          answer: "Text only.", thinking: "", usage: { inputTokens: 1, outputTokens: 1 }
        })
      );
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: providerVisionSettings(),
        promptMessages: [{ role: "user", content: "Hello" }],
        skills: [],
        mcpToolSets: []
      });

      expect(result.answer).toBe("Text only.");
    });

    it("returns the vision model answer as a tool result", async () => {
      let providerCallCount = 0;
      streamProviderResponse.mockImplementation((input: { settings?: { id?: string }; promptMessages?: PromptMessage[]; tools?: unknown }) => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{
              id: "call_analyze",
              name: "analyze_image",
              arguments: JSON.stringify({
                file_paths: ["/tmp/conv_vision/att_photo_photo.png"],
                question: "What color is the car?"
              })
            }],
            usage: { inputTokens: 12 }
          });
        }

        if (providerCallCount === 2) {
          expect(input.settings?.id).toBe("profile_vision");
          expect(input.tools).toBeUndefined();
          const systemContent = String(input.promptMessages?.[0]?.content ?? "");
          expect(systemContent).toContain("vision analysis sub-agent");
          return createProviderStream([{ type: "answer_delta", text: "The car is red." }], {
            answer: "The car is red.",
            thinking: "",
            usage: { outputTokens: 5 }
          });
        }

        return createProviderStream([{ type: "answer_delta", text: "The vision model says the car is red." }], {
          answer: "The vision model says the car is red.",
          thinking: "",
          usage: { outputTokens: 8 }
        });
      });

      const started: Array<{ kind: string; label: string; serverId?: string | null; toolName?: string | null }> = [];
      const completed: Array<{ handle?: string; resultSummary?: string }> = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        conversationId: "conv_vision",
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: [],
        onActionStart: (action) => { started.push(action); return "act_vision"; },
        onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
      });

      expect(result.answer).toBe("The vision model says the car is red.");
      expect(started).toEqual([
        expect.objectContaining({
          kind: "mcp_tool_call",
          label: "Analyze image",
          serverId: "integration_vision",
          toolName: "analyze_image"
        })
      ]);
      expect(completed).toEqual([
        expect.objectContaining({ handle: "act_vision", resultSummary: "The car is red." })
      ]);

      const finalCall = streamProviderResponse.mock.calls.at(-1)?.[0];
      const toolMessage = (finalCall.promptMessages as PromptMessage[]).find(
        (message) => message.role === "tool" && message.toolCallId === "call_analyze"
      );
      expect(toolMessage?.content).toBe("The car is red.");
    });

    it("fails the turn when the vision provider call fails", async () => {
      let providerCallCount = 0;
      streamProviderResponse.mockImplementation(() => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{
              id: "call_analyze_fail",
              name: "analyze_image",
              arguments: JSON.stringify({ file_paths: ["/tmp/conv_vision/att_photo_photo.png"] })
            }],
            usage: { inputTokens: 12 }
          });
        }

        throw new Error("Bad API key");
      });

      const errors: Array<{ handle?: string; resultSummary?: string }> = [];
      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      await expect(resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        conversationId: "conv_vision",
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: [],
        onActionStart: () => "act_vision_fail",
        onActionError: (handle, patch) => { errors.push({ handle, resultSummary: patch.resultSummary }); }
      })).rejects.toThrow("Vision analysis failed: Bad API key");

      expect(errors).toEqual([
        expect.objectContaining({ handle: "act_vision_fail", resultSummary: "Bad API key" })
      ]);
    });

    it("returns an error tool result for invalid image paths so the model can recover", async () => {
      resolveAbsoluteImagePathPart.mockImplementation(() => {
        throw new Error("Image path is outside attachment storage");
      });

      let providerCallCount = 0;
      streamProviderResponse.mockImplementation(() => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{
              id: "call_analyze_bad",
              name: "analyze_image",
              arguments: JSON.stringify({ file_paths: ["/etc/passwd"] })
            }],
            usage: { inputTokens: 12 }
          });
        }

        return createProviderStream([{ type: "answer_delta", text: "Recovered." }], {
          answer: "Recovered.",
          thinking: "",
          usage: { outputTokens: 2 }
        });
      });

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        conversationId: "conv_vision",
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      expect(result.answer).toBe("Recovered.");
      const finalCall = streamProviderResponse.mock.calls.at(-1)?.[0];
      const toolMessage = (finalCall.promptMessages as PromptMessage[]).find(
        (message) => message.role === "tool" && message.toolCallId === "call_analyze_bad"
      );
      expect(toolMessage?.content).toContain("outside attachment storage");
    });

    it("returns an error tool result without a vision call for paths from another conversation", async () => {
      resolveAbsoluteImagePathPart.mockImplementation(
        (absolutePath: string, scope?: { conversationId: string }) => {
          if (!scope?.conversationId || !absolutePath.startsWith(`/tmp/${scope.conversationId}/`)) {
            throw new Error("Image path belongs to a different conversation");
          }
          return {
            type: "image" as const,
            attachmentId: "att_photo",
            filename: "att_photo_photo.png",
            mimeType: "image/png",
            relativePath: absolutePath.replace(/^\/tmp\//, "")
          };
        }
      );

      let providerCallCount = 0;
      streamProviderResponse.mockImplementation(() => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{
              id: "call_analyze_cross",
              name: "analyze_image",
              arguments: JSON.stringify({ file_paths: ["/tmp/conv_other/att_secret_secret.png"] })
            }],
            usage: { inputTokens: 12 }
          });
        }

        return createProviderStream([{ type: "answer_delta", text: "Recovered." }], {
          answer: "Recovered.",
          thinking: "",
          usage: { outputTokens: 2 }
        });
      });

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        conversationId: "conv_vision",
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      expect(result.answer).toBe("Recovered.");
      expect(streamProviderResponse).toHaveBeenCalledTimes(2);
      expect(
        streamProviderResponse.mock.calls.some(([call]) => call?.settings?.id === "profile_vision")
      ).toBe(false);
      expect(resolveAbsoluteImagePathPart).toHaveBeenCalledWith(
        "/tmp/conv_other/att_secret_secret.png",
        { conversationId: "conv_vision" }
      );
      const finalCall = streamProviderResponse.mock.calls.at(-1)?.[0];
      const toolMessage = (finalCall.promptMessages as PromptMessage[]).find(
        (message) => message.role === "tool" && message.toolCallId === "call_analyze_cross"
      );
      expect(toolMessage?.content).toContain("belongs to a different conversation");
    });

    it("returns an error tool result when conversation context is missing", async () => {
      let providerCallCount = 0;
      streamProviderResponse.mockImplementation(() => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{
              id: "call_analyze_no_context",
              name: "analyze_image",
              arguments: JSON.stringify({ file_paths: ["/tmp/conv_vision/att_photo_photo.png"] })
            }],
            usage: { inputTokens: 12 }
          });
        }

        return createProviderStream([{ type: "answer_delta", text: "Recovered." }], {
          answer: "Recovered.",
          thinking: "",
          usage: { outputTokens: 2 }
        });
      });

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      expect(result.answer).toBe("Recovered.");
      expect(streamProviderResponse).toHaveBeenCalledTimes(2);
      expect(resolveAbsoluteImagePathPart).not.toHaveBeenCalled();
      const finalCall = streamProviderResponse.mock.calls.at(-1)?.[0];
      const toolMessage = (finalCall.promptMessages as PromptMessage[]).find(
        (message) => message.role === "tool" && message.toolCallId === "call_analyze_no_context"
      );
      expect(toolMessage?.content).toContain("conversation context is required");
    });

    it("returns an error tool result for empty file_paths", async () => {
      let providerCallCount = 0;
      streamProviderResponse.mockImplementation(() => {
        providerCallCount += 1;

        if (providerCallCount === 1) {
          return createProviderStream([], {
            answer: "",
            thinking: "",
            toolCalls: [{
              id: "call_analyze_empty",
              name: "analyze_image",
              arguments: JSON.stringify({ file_paths: [] })
            }],
            usage: { inputTokens: 8 }
          });
        }

        return createProviderStream([{ type: "answer_delta", text: "Fixed the call." }], {
          answer: "Fixed the call.",
          thinking: "",
          usage: { outputTokens: 2 }
        });
      });

      const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

      const result = await resolveAssistantTurn({
        settings: providerVisionSettings(),
        visionProfile: visionProfile(),
        conversationId: "conv_vision",
        promptMessages: [imageMessage()],
        skills: [],
        mcpToolSets: []
      });

      expect(result.answer).toBe("Fixed the call.");
      const finalCall = streamProviderResponse.mock.calls.at(-1)?.[0];
      const toolMessage = (finalCall.promptMessages as PromptMessage[]).find(
        (message) => message.role === "tool" && message.toolCallId === "call_analyze_empty"
      );
      expect(toolMessage?.content).toContain("non-empty array");
    });
  });
});
