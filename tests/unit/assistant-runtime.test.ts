import type { ChatStreamEvent, ProviderProfileWithApiKey, Skill } from "@/lib/types";

const streamProviderResponse = vi.fn();
const callMcpTool = vi.fn();
const summarizeToolResult = vi.fn();

vi.mock("@/lib/provider", () => ({
  streamProviderResponse
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool,
  summarizeToolResult
}));

function createProviderStream(
  events: ChatStreamEvent[],
  result: {
    answer: string;
    thinking: string;
    usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  }
) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }

    return result;
  })();
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
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
    summarizeToolResult.mockReset();
    summarizeToolResult.mockImplementation((result: { content?: Array<{ text?: string }> }) => {
      return result.content?.[0]?.text ?? "done";
    });
  });

  it("loads skills as action steps before returning the final answer", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: 'SKILL_REQUEST: {"skills":["Release Notes"]}',
          thinking: "",
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
    const emitted: ChatStreamEvent[] = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Write release notes" }],
      skills: [createSkill()],
      mcpToolSets: [],
      onEvent: (event) => emitted.push(event),
      onActionStart: (action) => {
        started.push(action);
        return "act_skill";
      },
      onActionComplete: (handle, patch) => {
        completed.push({ handle, resultSummary: patch.resultSummary });
      }
    });

    expect(streamProviderResponse).toHaveBeenCalledTimes(2);
    expect(started).toEqual([
      expect.objectContaining({
        kind: "skill_load",
        label: "Load skill",
        detail: "Release Notes"
      })
    ]);
    expect(completed).toEqual([
      {
        handle: "act_skill",
        resultSummary: "Skill instructions loaded."
      }
    ]);
    expect(streamProviderResponse.mock.calls[1][0].promptMessages.at(-1)?.content).toContain(
      "Summarize changes for end users in concise release notes."
    );
    expect(emitted).toEqual([{ type: "answer_delta", text: "Done" }]);
    expect(result.answer).toBe("Done");
  });

  it("streams visible thinking and answer deltas before the provider finishes", async () => {
    const gate = createDeferred<void>();
    streamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "thinking_delta", text: "Thinking " } satisfies ChatStreamEvent;
        yield { type: "answer_delta", text: "Hello" } satisfies ChatStreamEvent;
        await gate.promise;

        return {
          answer: "Hello",
          thinking: "Thinking ",
          usage: { outputTokens: 1, reasoningTokens: 1 }
        };
      })()
    );

    const emitted: ChatStreamEvent[] = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

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

    gate.resolve();

    const result = await pending;

    expect(result.answer).toBe("Hello");
    expect(result.thinking).toBe("Thinking ");
  });

  it("does not leak tool-call control text while the first pass is still unresolved", async () => {
    const gate = createDeferred<void>();
    streamProviderResponse
      .mockReturnValueOnce(
        (async function* () {
          yield { type: "answer_delta", text: "TOOL" } satisfies ChatStreamEvent;
          yield { type: "answer_delta", text: "_CALL:" } satisfies ChatStreamEvent;
          await gate.promise;

          return {
            answer: 'TOOL_CALL: {"serverId":"mcp_docs","tool":"search_docs","arguments":{"query":"MCP"}}',
            thinking: "",
            usage: { inputTokens: 9 }
          };
        })()
      )
      .mockReturnValueOnce(
        createProviderStream([{ type: "answer_delta", text: "Final answer" }], {
          answer: "Final answer",
          thinking: "",
          usage: { inputTokens: 11, outputTokens: 3 }
        })
      );
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Found MCP docs" }]
    });

    const emitted: ChatStreamEvent[] = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const pending = resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }],
      skills: [],
      mcpToolSets: [
        {
          server: {
            id: "mcp_docs",
            name: "Docs",
            url: "https://mcp.example.com",
            headers: {},
            transport: "streamable_http",
            command: null,
            args: null,
            env: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          tools: [
            {
              name: "search_docs",
              description: "Search docs",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true }
            }
          ]
        }
      ],
      onEvent: (event) => emitted.push(event),
      onActionStart: () => "act_tool",
      onActionComplete: () => undefined
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emitted).toEqual([]);

    gate.resolve();

    const result = await pending;

    expect(emitted).toEqual([{ type: "answer_delta", text: "Final answer" }]);
    expect(result.answer).toBe("Final answer");
  });

  it("executes MCP tool calls as action steps and feeds the result back into the next model pass", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: 'TOOL_CALL: {"serverId":"mcp_docs","tool":"search_docs","arguments":{"query":"MCP"}}',
          thinking: "",
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
    callMcpTool.mockResolvedValue({
      content: [{ type: "text", text: "Found MCP docs" }]
    });

    const started: Array<{ label: string; detail?: string; serverId?: string | null }> = [];
    const completed: Array<{ handle?: string; resultSummary?: string }> = [];
    const emitted: ChatStreamEvent[] = [];
    const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

    const result = await resolveAssistantTurn({
      settings: createSettings(),
      promptMessages: [{ role: "user", content: "Find MCP docs" }],
      skills: [],
      mcpToolSets: [
        {
          server: {
            id: "mcp_docs",
            name: "Docs",
            url: "https://mcp.example.com",
            headers: {},
            transport: "streamable_http",
            command: null,
            args: null,
            env: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          tools: [
            {
              name: "search_docs",
              title: "Search docs",
              description: "Search docs",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true }
            }
          ]
        }
      ],
      onEvent: (event) => emitted.push(event),
      onActionStart: (action) => {
        started.push(action);
        return "act_tool";
      },
      onActionComplete: (handle, patch) => {
        completed.push({ handle, resultSummary: patch.resultSummary });
      }
    });

    expect(callMcpTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mcp_docs" }),
      "search_docs",
      { query: "MCP" }
    );
    expect(started).toEqual([
      expect.objectContaining({
        label: "Search docs",
        detail: "query=MCP",
        serverId: "mcp_docs"
      })
    ]);
    expect(completed).toEqual([
      {
        handle: "act_tool",
        resultSummary: "Found MCP docs"
      }
    ]);
    expect(streamProviderResponse.mock.calls[1][0].promptMessages.at(-1)?.content).toContain(
      "Found MCP docs"
    );
    expect(emitted).toEqual([{ type: "answer_delta", text: "Final answer" }]);
    expect(result.answer).toBe("Final answer");
  });

  it("reports MCP tool execution errors through the error callback", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: 'TOOL_CALL: {"serverId":"mcp_docs","tool":"search_docs","arguments":{"query":"MCP"}}',
          thinking: "",
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
      mcpToolSets: [
        {
          server: {
            id: "mcp_docs",
            name: "Docs",
            url: "https://mcp.example.com",
            headers: {},
            transport: "streamable_http",
            command: null,
            args: null,
            env: null,
            enabled: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          tools: [
            {
              name: "search_docs",
              description: "Search docs",
              inputSchema: { type: "object" },
              annotations: { readOnlyHint: true }
            }
          ]
        }
      ],
      onActionStart: () => "act_tool",
      onActionError: (handle, patch) => {
        errored.push({ handle, resultSummary: patch.resultSummary });
      }
    });

    expect(errored).toEqual([
      {
        handle: "act_tool",
        resultSummary: "permission denied"
      }
    ]);
    expect(streamProviderResponse.mock.calls[1][0].promptMessages.at(-1)?.content).toContain(
      "Status: error"
    );
    expect(result.answer).toBe("Recovered answer");
  });

  it("adds a correction prompt when the requested MCP tool is unavailable", async () => {
    streamProviderResponse
      .mockReturnValueOnce(
        createProviderStream([], {
          answer: 'TOOL_CALL: {"serverId":"missing_server","tool":"missing_tool","arguments":{"query":"MCP"}}',
          thinking: "",
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
    expect(streamProviderResponse.mock.calls[1][0].promptMessages.at(-1)?.content).toContain(
      "The requested MCP tool is unavailable"
    );
    expect(result.answer).toBe("Fallback answer");
  });

  it("stops after the maximum number of control steps", async () => {
    streamProviderResponse.mockImplementation(() =>
      createProviderStream([], {
        answer: 'TOOL_CALL: {"serverId":"mcp_docs","tool":"search_docs","arguments":{"query":"loop"}}',
        thinking: "",
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
        mcpToolSets: [
          {
            server: {
              id: "mcp_docs",
              name: "Docs",
              url: "https://mcp.example.com",
              headers: {},
              transport: "streamable_http",
              command: null,
              args: null,
              env: null,
              enabled: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            },
            tools: [
              {
                name: "search_docs",
                description: "Search docs",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: true }
              }
            ]
          }
        ]
      })
    ).rejects.toThrow("Assistant exceeded the maximum number of tool steps");

    expect(streamProviderResponse).toHaveBeenCalledTimes(8);
  });
});
