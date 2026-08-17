import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatTurnStoppedError } from "@/lib/chat-turn-control";
import {
  clearWebSearchQueryCache,
  fuseFanOutResults,
  normalizeResultUrl,
  normalizeSubqueries,
  parsePlanningResponse,
  planWebSearch,
  runWebSearchFanOut,
  runWebSearchPipeline
} from "@/lib/web-search-pipeline";
import { executeToolCall } from "@/lib/tool-executors";
import type { ToolSet } from "@/lib/tool-definitions";
import type {
  PromptMessage,
  RuntimeAppSettings,
  RuntimeProviderProfile,
  Skill
} from "@/lib/types";
import {
  createRuntimeAppSettings,
  createRuntimeProviderProfile
} from "@/tests/provider-fixtures";

const { callProviderTextMock, searchWebMock } = vi.hoisted(() => ({
  callProviderTextMock: vi.fn(),
  searchWebMock: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn(),
  callProviderText: callProviderTextMock
}));

vi.mock("@/lib/web-search", () => ({
  searchWeb: searchWebMock,
  getWebSearchReadinessError: vi.fn(() => null)
}));

function makeSettings() {
  return createRuntimeAppSettings({ webSearch: { providerId: "exa" } });
}

describe("parsePlanningResponse", () => {
  it("parses a direct plan", () => {
    expect(parsePlanningResponse('{"action":"direct"}')).toEqual({ action: "direct" });
  });

  it("parses a fan_out plan with subqueries", () => {
    expect(parsePlanningResponse('{"action":"fan_out","subqueries":["a","b"]}')).toEqual({
      action: "fan_out",
      subqueries: ["a", "b"]
    });
  });

  it("extracts JSON from noisy model output", () => {
    const noisy = 'Here is the plan:\n```json\n{"action":"fan_out","subqueries":["q1","q2"]}\n```\nDone.';
    expect(parsePlanningResponse(noisy)).toEqual({ action: "fan_out", subqueries: ["q1", "q2"] });
  });

  it("rejects junk, unknown actions, and short subquery lists", () => {
    expect(parsePlanningResponse("no json here")).toBeNull();
    expect(parsePlanningResponse('{"action":"explode"}')).toBeNull();
    expect(parsePlanningResponse('{"action":"fan_out","subqueries":["only-one"]}')).toBeNull();
    expect(parsePlanningResponse('{"action":"fan_out","subqueries":"not-an-array"}')).toBeNull();
    expect(parsePlanningResponse(undefined)).toBeNull();
    expect(parsePlanningResponse(42)).toBeNull();
  });
});

describe("normalizeSubqueries", () => {
  it("trims, dedupes case-insensitively, and caps at maxQueries", () => {
    expect(normalizeSubqueries([" A ", "a", "b", "", "C"], 2)).toEqual(["A", "b"]);
    expect(normalizeSubqueries(["a", "A", "b"], 5)).toEqual(["a", "b"]);
  });
});

describe("normalizeResultUrl", () => {
  it("strips tracking params, hashes, and trailing slashes", () => {
    expect(normalizeResultUrl("https://example.com/page/?utm_source=x&id=7#section")).toBe(
      "https://example.com/page?id=7"
    );
    expect(normalizeResultUrl("https://example.com/alpha/")).toBe("https://example.com/alpha");
  });

  it("returns null for invalid URLs", () => {
    expect(normalizeResultUrl("not a url")).toBeNull();
  });
});

describe("planWebSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to direct without a provider profile", async () => {
    const plan = await planWebSearch({
      query: "q",
      forceFanOut: false,
      maxQueries: 4
    });
    expect(plan).toEqual({ action: "direct" });
    expect(callProviderTextMock).not.toHaveBeenCalled();
  });

  it("returns the parsed fan_out plan", async () => {
    callProviderTextMock.mockResolvedValue('{"action":"fan_out","subqueries":["a","b"]}');
    const plan = await planWebSearch({
      providerProfile: createRuntimeProviderProfile(),
      query: "q",
      forceFanOut: false,
      maxQueries: 4
    });
    expect(plan).toEqual({ action: "fan_out", subqueries: ["a", "b"] });
    expect(callProviderTextMock).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "web_search_planning"
    }));
  });

  it("falls back to direct when the planning call fails or returns junk", async () => {
    const input = {
      providerProfile: createRuntimeProviderProfile(),
      query: "q",
      forceFanOut: false,
      maxQueries: 4
    };
    callProviderTextMock.mockRejectedValueOnce(new Error("provider down"));
    expect(await planWebSearch(input)).toEqual({ action: "direct" });

    callProviderTextMock.mockResolvedValueOnce("not json");
    expect(await planWebSearch(input)).toEqual({ action: "direct" });
  });

  it("rethrows when the turn is aborted during planning", async () => {
    const controller = new AbortController();
    callProviderTextMock.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    await expect(planWebSearch({
      providerProfile: createRuntimeProviderProfile(),
      query: "q",
      forceFanOut: false,
      maxQueries: 4,
      abortSignal: controller.signal
    })).rejects.toBeInstanceOf(ChatTurnStoppedError);
  });

  it("uses the force-fan-out prompt when requested", async () => {
    callProviderTextMock.mockResolvedValue('{"action":"fan_out","subqueries":["a","b"]}');
    await planWebSearch({
      providerProfile: createRuntimeProviderProfile(),
      query: "q",
      forceFanOut: true,
      maxQueries: 4
    });
    const prompt = callProviderTextMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Split this search");
    expect(prompt).toContain('"q"');
  });
});

describe("runWebSearchFanOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchWebMock.mockResolvedValue("ok");
  });

  it("runs sub-queries concurrently and returns per-query sections", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    searchWebMock.mockImplementation(async ({ query }: { query: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return `result for ${query}`;
    });

    const sections = await runWebSearchFanOut({
      subqueries: ["a", "b", "c"],
      settings: makeSettings()
    });

    expect(maxInFlight).toBe(3);
    expect(sections.map((section) => section.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(sections[0].text).toBe("result for a");
  });

  it("applies a per-search timeout derived from mcpTimeout", async () => {
    await runWebSearchFanOut({
      subqueries: ["a"],
      settings: makeSettings(),
      timeoutMs: 5000
    });
    expect(searchWebMock).toHaveBeenCalledWith(expect.objectContaining({
      query: "a",
      timeout: 5000,
      abortSignal: expect.any(AbortSignal)
    }));
  });

  it("keeps partial failures as rejected sections", async () => {
    searchWebMock.mockImplementation(async ({ query }: { query: string }) => {
      if (query === "b") throw new Error("engine boom");
      return "fine";
    });

    const sections = await runWebSearchFanOut({
      subqueries: ["a", "b"],
      settings: makeSettings()
    });

    expect(sections[0]).toMatchObject({ status: "fulfilled", text: "fine" });
    expect(sections[1]).toMatchObject({ status: "rejected", error: "engine boom" });
  });

  it("rethrows ChatTurnStoppedError when the turn is aborted mid fan-out", async () => {
    const controller = new AbortController();
    searchWebMock.mockImplementation(async () => {
      controller.abort();
      throw new Error("This operation was aborted");
    });

    await expect(runWebSearchFanOut({
      subqueries: ["a", "b"],
      settings: makeSettings(),
      abortSignal: controller.signal
    })).rejects.toBeInstanceOf(ChatTurnStoppedError);
  });
});

describe("fuseFanOutResults", () => {
  it("dedupes URLs across sections and notes duplicates in the header", () => {
    const fused = fuseFanOutResults([
      {
        query: "q1",
        status: "fulfilled",
        text: [
          "Title: Alpha\nhttps://example.com/alpha\nSummary A1",
          "Title: Beta\nhttps://example.com/beta?utm_source=x\nSummary B1"
        ].join("\n\n")
      },
      {
        query: "q2",
        status: "fulfilled",
        text: [
          "Title: Alpha again\nhttps://example.com/alpha/\nSummary A2",
          "Title: Gamma\nhttps://example.com/gamma\nSummary G1"
        ].join("\n\n")
      }
    ]);

    expect(fused).toContain("Parallel web search results (2 queries: 2 succeeded, 0 failed, 1 duplicate result removed)");
    expect(fused).toContain('## Query: "q1"');
    expect(fused).toContain('## Query: "q2"');
    expect(fused.match(/example\.com\/alpha/g)?.length).toBe(1);
    expect(fused).toContain("example.com/beta");
    expect(fused).toContain("example.com/gamma");
  });

  it("includes failed sections with their error", () => {
    const fused = fuseFanOutResults([
      { query: "q1", status: "fulfilled", text: "Title: A\nhttps://example.com/a\nS" },
      { query: "q2", status: "rejected", text: "", error: "timeout" }
    ]);
    expect(fused).toContain("(2 queries: 1 succeeded, 1 failed)");
    expect(fused).toContain('## Query: "q2" (failed: timeout)');
  });

  it("drops lowest-ranked URL results first when over budget", () => {
    const long = (label: string, url: string) =>
      `${label}\n${url}\n${"x".repeat(380)}`;
    const fused = fuseFanOutResults([
      {
        query: "q1",
        status: "fulfilled",
        text: [long("Shared", "https://example.com/shared"), long("Only1", "https://example.com/only1")].join("\n\n")
      },
      {
        query: "q2",
        status: "fulfilled",
        text: [long("Shared2", "https://example.com/shared"), long("Only2", "https://example.com/only2")].join("\n\n")
      }
    ], 1600);

    expect(fused).toContain("example.com/shared");
    expect(fused).not.toContain("example.com/only1");
    expect(fused).toContain("example.com/only2");
    expect(fused.length).toBeLessThanOrEqual(1600);
  });

  it("hard-truncates the fused output to the budget", () => {
    const section = {
      query: "q1",
      status: "fulfilled" as const,
      text: `${"y".repeat(40_000)}\nhttps://example.com/big`
    };
    const fused = fuseFanOutResults([section], 1000);
    expect(fused.length).toBeLessThanOrEqual(1000);
    expect(fused).toContain("...[truncated]");
  });
});

describe("runWebSearchPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebSearchQueryCache();
    searchWebMock.mockResolvedValue("provider text");
  });

  it("runs a single direct search when mode is off", async () => {
    const settings = createRuntimeAppSettings({
      webSearch: {
        providerId: "exa",
        configuration: { pipeline: { mode: "off", maxQueries: 4 } }
      }
    });

    const result = await runWebSearchPipeline({
      query: "simple lookup",
      queries: ["ignored multi"],
      mode: "off",
      maxQueries: 4,
      settings
    });

    expect(result.strategy).toBe("direct");
    expect(result.plannedQueries).toEqual(["simple lookup"]);
    expect(searchWebMock).toHaveBeenCalledTimes(1);
    expect(callProviderTextMock).not.toHaveBeenCalled();
  });

  it("fans out explicit queries without a planning call", async () => {
    const result = await runWebSearchPipeline({
      query: "",
      queries: ["facet one", "facet two", "facet two"],
      mode: "auto",
      maxQueries: 4,
      settings: makeSettings()
    });

    expect(result.strategy).toBe("fan_out");
    expect(result.plannedQueries).toEqual(["facet one", "facet two"]);
    expect(searchWebMock).toHaveBeenCalledTimes(2);
    expect(callProviderTextMock).not.toHaveBeenCalled();
    expect(result.resultSummary).toContain("Parallel web search results (2 queries: 2 succeeded, 0 failed)");
  });

  it("caps explicit queries at maxQueries", async () => {
    const result = await runWebSearchPipeline({
      queries: ["a", "b", "c", "d", "e", "f"],
      mode: "always",
      maxQueries: 3,
      settings: makeSettings()
    });
    expect(result.plannedQueries).toEqual(["a", "b", "c"]);
  });

  it("follows a direct plan in auto mode", async () => {
    callProviderTextMock.mockResolvedValue('{"action":"direct"}');

    const result = await runWebSearchPipeline({
      query: "who is ceo of acme",
      mode: "auto",
      maxQueries: 4,
      settings: makeSettings(),
      providerProfile: createRuntimeProviderProfile()
    });

    expect(result.strategy).toBe("direct");
    expect(searchWebMock).toHaveBeenCalledTimes(1);
    expect(result.resultSummary).toBe("provider text");
  });

  it("fans out when the planner decomposes the query", async () => {
    callProviderTextMock.mockResolvedValue(
      '{"action":"fan_out","subqueries":["acme revenue 2025","acme product launch"]}'
    );

    const result = await runWebSearchPipeline({
      query: "acme performance and products",
      mode: "auto",
      maxQueries: 4,
      settings: makeSettings(),
      providerProfile: createRuntimeProviderProfile(),
      userContext: "How did acme do this year?"
    });

    expect(result.strategy).toBe("fan_out");
    expect(searchWebMock).toHaveBeenCalledTimes(2);
    expect(searchWebMock).toHaveBeenCalledWith(expect.objectContaining({ query: "acme revenue 2025" }));
    expect(result.succeeded).toBe(2);
  });

  it("forces fan-out planning in always mode", async () => {
    callProviderTextMock.mockResolvedValue('{"action":"fan_out","subqueries":["x1","x2"]}');

    await runWebSearchPipeline({
      query: "anything",
      mode: "always",
      maxQueries: 4,
      settings: makeSettings(),
      providerProfile: createRuntimeProviderProfile()
    });

    expect((callProviderTextMock.mock.calls[0][0].prompt as string)).toContain("Split this search");
  });

  it("throws when every sub-search fails", async () => {
    searchWebMock.mockRejectedValue(new Error("engine boom"));

    await expect(runWebSearchPipeline({
      queries: ["a", "b"],
      mode: "always",
      maxQueries: 4,
      settings: makeSettings()
    })).rejects.toThrow("All 2 web searches failed: engine boom");
  });

  it("truncates direct results to the runtime tool budget", async () => {
    searchWebMock.mockResolvedValue("z".repeat(40_000));

    const result = await runWebSearchPipeline({
      query: "big",
      mode: "auto",
      maxQueries: 4,
      settings: makeSettings()
    });

    expect(result.resultSummary.length).toBeLessThanOrEqual(32_000);
  });
});

describe("cross-call duplicate query cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebSearchQueryCache();
    searchWebMock.mockResolvedValue("provider text");
  });

  const base = (assistantMessageId: string) => ({
    mode: "auto" as const,
    maxQueries: 4,
    settings: makeSettings(),
    assistantMessageId
  });

  it("skips near-duplicate sub-queries on later calls in the same turn", async () => {
    const input = base("msg_dedup");
    const first = await runWebSearchPipeline({
      ...input,
      queries: ["AI news August 2026 OpenAI Google Anthropic Meta Nvidia", "other facet entirely different topic"]
    });
    expect(first.succeeded).toBe(2);
    expect(searchWebMock).toHaveBeenCalledTimes(2);

    const second = await runWebSearchPipeline({
      ...input,
      queries: ["August 17 2026 AI latest news Google OpenAI Anthropic Nvidia"]
    });
    expect(second.duplicates).toBe(1);
    expect(searchWebMock).toHaveBeenCalledTimes(2);
    expect(second.resultSummary).toContain("Skipped search");
    expect(second.resultSummary).toContain('"AI news August 2026 OpenAI Google Anthropic Meta Nvidia"');
  });

  it("treats reordered queries as exact duplicates", async () => {
    const input = base("msg_reorder");
    await runWebSearchPipeline({
      ...input,
      queries: ["news AI august 2026 openai google anthropic meta nvidia"]
    });
    const second = await runWebSearchPipeline({
      ...input,
      queries: ["AI news August 2026 OpenAI Google Anthropic Meta Nvidia"]
    });
    expect(second.duplicates).toBe(1);
    expect(searchWebMock).toHaveBeenCalledTimes(1);
  });

  it("does not fuzzy-match short queries", async () => {
    const input = base("msg_short");
    await runWebSearchPipeline({ ...input, queries: ["iPhone 17 price"] });
    await runWebSearchPipeline({ ...input, queries: ["iPhone 17 Pro price"] });
    expect(searchWebMock).toHaveBeenCalledTimes(2);
  });

  it("scopes the cache per assistant message", async () => {
    await runWebSearchPipeline({
      ...base("msg_one"),
      queries: ["AI news August 2026 OpenAI Google Anthropic Meta Nvidia"]
    });
    await runWebSearchPipeline({
      ...base("msg_two"),
      queries: ["AI news August 2026 OpenAI Google Anthropic Meta Nvidia"]
    });
    expect(searchWebMock).toHaveBeenCalledTimes(2);
  });

  it("returns a skip note for duplicate direct searches", async () => {
    const input = base("msg_direct");
    await runWebSearchPipeline({
      ...input,
      queries: ["detailed revenue figures for acme corporation 2026"]
    });
    const second = await runWebSearchPipeline({
      ...input,
      query: "detailed revenue figures for acme corporation in 2026"
    });
    expect(second.duplicates).toBe(1);
    expect(searchWebMock).toHaveBeenCalledTimes(1);
    expect(second.resultSummary).toContain("Skipped search");
    expect(second.resultSummary).toContain("already in the conversation above");
  });

  it("does not record failed searches as duplicates", async () => {
    searchWebMock.mockImplementation(async ({ query }: { query: string }) => {
      if (query.includes("boom")) throw new Error("boom");
      return "ok";
    });
    const input = base("msg_fail");
    const first = await runWebSearchPipeline({
      ...input,
      queries: ["query that will boom number one", "query that succeeds fine always"]
    });
    expect(first.failed).toBe(1);

    const retry = await runWebSearchPipeline({
      ...input,
      queries: ["query that will boom number two", "query that succeeds fine always"]
    });
    expect(retry.failed).toBe(1);
    expect(retry.duplicates).toBe(1);
    expect(searchWebMock).toHaveBeenCalledTimes(5);
  });

  it("retries a transiently failed sub-query once inline", async () => {
    searchWebMock.mockImplementation(async ({ query }: { query: string }) => {
      if (query === "flaky" && searchWebMock.mock.calls.filter(([call]) => call.query === "flaky").length === 1) {
        throw new Error("transient");
      }
      return "ok";
    });

    const sections = await runWebSearchFanOut({
      subqueries: ["flaky", "stable"],
      settings: makeSettings()
    });

    expect(sections[0]).toMatchObject({ status: "fulfilled", text: "ok" });
    expect(sections[1]).toMatchObject({ status: "fulfilled" });
    expect(searchWebMock).toHaveBeenCalledTimes(3);
  });

  it("caps concurrent searches to avoid provider rate limits", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    searchWebMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;
      return "ok";
    });

    const sections = await runWebSearchFanOut({
      subqueries: ["q1", "q2", "q3", "q4", "q5", "q6"],
      settings: makeSettings()
    });

    expect(sections.every((section) => section.status === "fulfilled")).toBe(true);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("expires cache entries after the TTL", async () => {
    vi.useFakeTimers();
    try {
      const input = base("msg_ttl");
      await runWebSearchPipeline({
        ...input,
        queries: ["AI news August 2026 OpenAI Google Anthropic Meta Nvidia"]
      });
      vi.advanceTimersByTime(16 * 60 * 1000);
      const second = await runWebSearchPipeline({
        ...input,
        queries: ["AI news August 2026 OpenAI Google Anthropic Meta Nvidia"]
      });
      expect(second.duplicates).toBe(0);
      expect(searchWebMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("executeWebSearch pipeline integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchWebMock.mockResolvedValue("provider text");
  });

  function makeContext(appSettings: RuntimeAppSettings | undefined = makeSettings()) {
    const onActionStart = vi.fn().mockResolvedValue("act_1");
    const onActionComplete = vi.fn();
    const onActionError = vi.fn();
    const context = {
      input: {
        settings: createRuntimeProviderProfile(),
        appSettings,
        mcpTimeout: 5000,
        skills: [] as Skill[],
        mcpToolSets: [] as ToolSet[],
        onActionStart,
        onActionComplete,
        onActionError
      } as {
        settings: RuntimeProviderProfile;
        appSettings?: RuntimeAppSettings;
        mcpTimeout?: number;
        skills: Skill[];
        mcpToolSets: ToolSet[];
        onActionStart: typeof onActionStart;
        onActionComplete: typeof onActionComplete;
        onActionError: typeof onActionError;
      },
      timelineSortOrder: 3,
      promptMessages: [{ role: "user" as const, content: "Compare X and Y pricing" }] as PromptMessage[]
    };
    return { onActionStart, onActionComplete, onActionError, context };
  }

  async function callWebSearch(args: Record<string, unknown>, context: ReturnType<typeof makeContext>["context"]) {
    return executeToolCall(
      { id: "call_1", name: "web_search", arguments: JSON.stringify(args) },
      {
        input: context.input,
        mcpServers: [],
        loadedSkillIds: new Set(),
        successfulReadOnlyToolResults: new Map(),
        timelineSortOrder: context.timelineSortOrder,
        promptMessages: context.promptMessages
      }
    );
  }

  it("runs one umbrella action around a fanned-out search", async () => {
    callProviderTextMock.mockResolvedValue('{"action":"fan_out","subqueries":["x price","y price"]}');
    const { context, onActionStart, onActionComplete, onActionError } = makeContext();

    const result = await callWebSearch({ query: "x vs y price" }, context);

    expect(searchWebMock).toHaveBeenCalledTimes(2);
    expect(onActionStart).toHaveBeenCalledTimes(1);
    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      label: "Web search",
      detail: "x vs y price",
      serverId: "integration_web_search",
      toolName: "web_search"
    }));
    expect(onActionComplete).toHaveBeenCalledTimes(1);
    expect(onActionComplete).toHaveBeenCalledWith("act_1", expect.objectContaining({
      resultSummary: expect.stringContaining("Parallel web search results")
    }));
    expect(onActionError).not.toHaveBeenCalled();
    expect(result.nextSortOrder).toBe(4);
    const toolMessage = result.promptMessages.at(-1)!;
    expect(String(toolMessage.content)).toContain('## Query: "x price"');
  });

  it("fans out explicit queries from the tool call arguments", async () => {
    const { context, onActionStart } = makeContext();

    await callWebSearch({ queries: ["q1", "q2"] }, context);

    expect(callProviderTextMock).not.toHaveBeenCalled();
    expect(searchWebMock).toHaveBeenCalledTimes(2);
    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({
      detail: "q1; q2",
      arguments: { queries: ["q1", "q2"] }
    }));
  });

  it("keeps legacy single-search behavior when the pipeline is off", async () => {
    const settings = createRuntimeAppSettings({
      webSearch: {
        providerId: "searxng",
        configuration: { baseUrl: "https://search.example.com", pipeline: { mode: "off" } }
      }
    });
    const { context, onActionStart } = makeContext(settings);

    const result = await callWebSearch({ query: "legacy" }, context);

    expect(searchWebMock).toHaveBeenCalledTimes(1);
    expect(searchWebMock).toHaveBeenCalledWith(expect.objectContaining({ query: "legacy" }));
    expect(callProviderTextMock).not.toHaveBeenCalled();
    expect(onActionStart).toHaveBeenCalledWith(expect.objectContaining({ detail: "legacy" }));
    expect(String(result.promptMessages.at(-1)!.content)).toBe("provider text");
  });

  it("surfaces total failure as an error tool message", async () => {
    searchWebMock.mockRejectedValue(new Error("engine boom"));
    const { context, onActionComplete, onActionError } = makeContext();

    const result = await callWebSearch({ queries: ["a", "b"] }, context);

    expect(onActionError).toHaveBeenCalledWith("act_1", expect.objectContaining({
      resultSummary: "All 2 web searches failed: engine boom"
    }));
    expect(onActionComplete).not.toHaveBeenCalled();
    expect(String(result.promptMessages.at(-1)!.content)).toBe(
      "Error: All 2 web searches failed: engine boom"
    );
  });

  it("rejects calls without a query", async () => {
    const { context } = makeContext();
    const result = await callWebSearch({}, context);
    expect(String(result.promptMessages.at(-1)!.content)).toBe("Error: query is required");
  });

  it("reports unconfigured web search without starting an action", async () => {
    const context = makeContext().context;
    const result = await callWebSearch(
      { query: "x" },
      { ...context, input: { ...context.input, appSettings: undefined } }
    );
    expect(String(result.promptMessages.at(-1)!.content)).toBe("Error: Web search is not configured.");
  });
});
