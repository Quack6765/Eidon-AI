import type { ChatStreamEvent, ProviderProfileWithApiKey, Skill } from "@/lib/types";

const streamProviderResponse = vi.fn();
const callProviderText = vi.fn();
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
const generateGoogleNanoBananaImages = vi.fn();
const createAttachments = vi.fn();
const assignAttachmentsToMessage = vi.fn();
const resolveAttachmentPath = vi.fn();

vi.mock("@/lib/provider", () => ({
  streamProviderResponse,
  callProviderText
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

vi.mock("@/lib/image-generation/google-nano-banana", () => ({
  generateGoogleNanoBananaImages
}));

vi.mock("@/lib/attachments", () => ({
  createAttachments,
  assignAttachmentsToMessage,
  resolveAttachmentPath
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
    providerPresetId: null,
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

function createAppSettings() {
  return {
    defaultProviderProfileId: "profile_test",
    skillsEnabled: false,
    conversationRetention: "30d" as const,
    memoriesEnabled: false,
    memoriesMaxCount: 100,
    mcpTimeout: 30000,
    sttEngine: "browser" as const,
    sttLanguage: "auto" as const,
    webSearchEngine: "disabled" as const,
    exaApiKey: "",
    tavilyApiKey: "",
    searxngBaseUrl: "",
    imageGenerationBackend: "google_nano_banana" as const,
    googleNanoBananaModel: "gemini-3.1-flash-image-preview" as const,
    googleNanoBananaApiKey: "google-secret",
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
    callProviderText.mockReset();
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
    generateGoogleNanoBananaImages.mockReset();
    createAttachments.mockReset();
    assignAttachmentsToMessage.mockReset();
    resolveAttachmentPath.mockReset();
    resolveAttachmentPath.mockImplementation(({ relativePath }: { relativePath: string }) => `/tmp/${relativePath}`);
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
    summarizeShellResult.mockImplementation((result: { stdout?: string; stderr?: string }) => {
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

  it("labels built-in Tavily search actions as Web search", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: "",
          thinking: "",
          toolCalls: [{
            id: "call_1",
            name: "mcp_builtin_search_tavily_tavily_search",
            arguments: JSON.stringify({ query: "latest AI", time_range: "week" })
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
    callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found AI news" }] });

    const started: Array<{ label: string; serverId?: string | null }> = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find AI news" }],
      skills: [],
      mcpToolSets: [{
        server: {
          id: "builtin_web_search_tavily",
          slug: "builtin_search_tavily",
          name: "Tavily",
          url: "https://mcp.tavily.com/mcp/",
          headers: {},
          transport: "streamable_http",
          command: null,
          args: null,
          env: null,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        tools: [{ name: "tavily_search", title: "tavily_search", description: "Search the web", inputSchema: { type: "object" } }]
      }],
      onEvent: () => {},
      onActionStart: (action) => {
        started.push(action);
        return "act_tool";
      }
    });

    expect(started).toEqual([
      expect.objectContaining({
        label: "Web search",
        serverId: "builtin_web_search_tavily"
      })
    ]);
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
    expect(assignAttachmentsToMessage).toHaveBeenCalledWith("conv_image", "msg_assistant_image", ["att_1"]);
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
      searxngBaseUrl: "https://search.example.com",
      memoriesEnabled: true,
      appSettings: createAppSettings(),
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
      visionMcpServer: {
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    expect(firstCall.promptMessages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Vision MCP server: Vision MCP")
      })
    );
    expect(firstCall.promptMessages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "text", text: "Attached image: photo.png" }
      ]
    });
  });

  it("falls back to vision MCP placeholders when native vision is configured on a non-vision model", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Use the vision MCP server." }], {
        answer: "Use the vision MCP server.",
        thinking: "",
        usage: { inputTokens: 4, outputTokens: 4 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: {
        ...createSettings(),
        model: "gpt-3.5-turbo",
        visionMode: "native" as const
      },
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
      visionMcpServer: {
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    const firstCall = streamProviderResponse.mock.calls.at(-1)?.[0];
    expect(firstCall.promptMessages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Vision MCP server: Vision MCP")
      })
    );
    expect(firstCall.promptMessages[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Describe this image." },
        { type: "text", text: "Attached image: photo.png" }
      ]
    });
  });

  it("passes copilot tool context only for github copilot profiles", async () => {
    streamProviderResponse.mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Done" }], {
        answer: "Done",
        thinking: "",
        usage: { inputTokens: 3, outputTokens: 1 }
      })
    );

    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    await resolveAssistantTurn({
      settings: {
        ...createSettings(),
        providerKind: "github_copilot"
      },
      promptMessages: [{ role: "user", content: "Use the configured tools." }],
      skills: [],
      mcpToolSets: [],
      mcpTimeout: 12345,
      onActionStart: () => undefined,
      onActionComplete: () => undefined,
      onActionError: () => undefined
    });

    expect(streamProviderResponse.mock.calls.at(-1)?.[0].copilotToolContext).toEqual(
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
    const onAnswerSegment = vi.fn();

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
      mcpToolSets: [{
        server: { id: "mcp_docs", slug: "docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        tools: [{ name: "search_docs", description: "Search docs", inputSchema: { type: "object" } }]
      }]
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(MAX_ASSISTANT_CONTROL_STEPS + 1);
    expect(result.answer).toBe("Final answer without more tools");
    expect(onAnswerSegment).toHaveBeenCalledWith("Final answer without more tools");
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
