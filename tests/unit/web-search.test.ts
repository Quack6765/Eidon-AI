import {
  clearWebSearchDiscoveryCache,
  formatPageContent,
  getWebPageReader,
  getWebSearchReadinessError,
  searchWeb
} from "@/lib/web-search";
import {
  normalizeWebSearchSelection,
  webSearchIntegrationUpdateSchema
} from "@/lib/web-search-catalog";
import { createRuntimeAppSettings } from "@/tests/provider-fixtures";

const {
  callMcpToolMock,
  discoverMcpToolsMock,
  getToolResultTextMock,
  searchSearxngMock
} = vi.hoisted(() => ({
  callMcpToolMock: vi.fn(),
  discoverMcpToolsMock: vi.fn(),
  getToolResultTextMock: vi.fn(),
  searchSearxngMock: vi.fn()
}));

vi.mock("@/lib/mcp-client", () => ({
  callMcpTool: callMcpToolMock,
  discoverMcpTools: discoverMcpToolsMock,
  getToolResultText: getToolResultTextMock
}));

vi.mock("@/lib/searxng", () => ({
  searchSearxng: searchSearxngMock
}));

describe("web search providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebSearchDiscoveryCache();
    discoverMcpToolsMock.mockResolvedValue([{ name: "web_search", inputSchema: {} }]);
    callMcpToolMock.mockResolvedValue({ isError: false });
    getToolResultTextMock.mockReturnValue("search result");
    searchSearxngMock.mockResolvedValue("self-hosted result");
  });

  it("reports disabled search through the shared readiness boundary", async () => {
    const settings = createRuntimeAppSettings({ webSearch: { providerId: "disabled" } });

    expect(getWebSearchReadinessError(settings)).toBe("Web search is disabled");
    expect(() => searchWeb({ query: "query", settings })).toThrow("Web search is disabled");
  });

  it("executes Exa through the provider-neutral MCP flow", async () => {
    const settings = createRuntimeAppSettings({ webSearch: { providerId: "exa" } });

    await expect(searchWeb({ query: "latest AI", maxResults: 4, settings })).resolves.toBe(
      "search result"
    );

    const server = discoverMcpToolsMock.mock.calls[0][0];
    expect(server).toMatchObject({
      id: "integration_web_search",
      name: "Web search",
      slug: "web_search",
      url: "https://mcp.exa.ai/mcp"
    });
    expect(callMcpToolMock).toHaveBeenCalledWith(
      server,
      "web_search",
      { query: "latest AI", numResults: 4 },
      undefined,
      undefined
    );
  });

  it("keeps Exa transport credentials inside its provider implementation", async () => {
    const settings = createRuntimeAppSettings({
      webSearch: { providerId: "exa", credentials: { apiKey: "exa key+value" } }
    });

    await searchWeb({ query: "query", settings });

    expect(discoverMcpToolsMock.mock.calls[0][0].url).toBe(
      "https://mcp.exa.ai/mcp?exaApiKey=exa+key%2Bvalue"
    );
  });

  it("validates and executes Tavily without changing the public tool name", async () => {
    const missing = createRuntimeAppSettings({ webSearch: { providerId: "tavily" } });
    expect(getWebSearchReadinessError(missing)).toBe("Tavily API key is required.");
    expect(() => searchWeb({ query: "query", settings: missing })).toThrow(
      "Tavily API key is required."
    );

    const settings = createRuntimeAppSettings({
      webSearch: { providerId: "tavily", credentials: { apiKey: "tvly key" } }
    });
    discoverMcpToolsMock.mockResolvedValueOnce([{ name: "tavily_search", inputSchema: {} }]);

    await searchWeb({ query: "query", maxResults: 7, settings });

    const server = discoverMcpToolsMock.mock.calls[0][0];
    expect(server.url).toBe("https://mcp.tavily.com/mcp/?tavilyApiKey=tvly+key");
    expect(callMcpToolMock).toHaveBeenCalledWith(
      server,
      "tavily_search",
      { query: "query", max_results: 7 },
      undefined,
      undefined
    );
  });

  it("delegates SearXNG HTTP behavior to its provider", async () => {
    const missing = createRuntimeAppSettings({ webSearch: { providerId: "searxng" } });
    expect(getWebSearchReadinessError(missing)).toBe("SearXNG base URL is required.");

    const abortController = new AbortController();
    const settings = createRuntimeAppSettings({
      webSearch: {
        providerId: "searxng",
        configuration: { baseUrl: "https://search.example.com" }
      }
    });
    await expect(searchWeb({
      query: "query",
      maxResults: 3,
      settings,
      abortSignal: abortController.signal
    })).resolves.toBe("self-hosted result");

    expect(searchSearxngMock).toHaveBeenCalledWith({
      baseUrl: "https://search.example.com",
      query: "query",
      maxResults: 3,
      abortSignal: abortController.signal
    });
  });

  it("surfaces provider discovery and execution errors consistently", async () => {
    const settings = createRuntimeAppSettings({ webSearch: { providerId: "exa" } });
    discoverMcpToolsMock.mockResolvedValueOnce([{ name: "unrelated", inputSchema: {} }]);
    await expect(searchWeb({ query: "query", settings })).rejects.toThrow(
      "did not expose the requested tool"
    );

    discoverMcpToolsMock.mockResolvedValueOnce([{ name: "web_search", inputSchema: {} }]);
    callMcpToolMock.mockResolvedValueOnce({ isError: true });
    getToolResultTextMock.mockReturnValueOnce("provider failed");
    await expect(searchWeb({ query: "query", settings })).rejects.toThrow("provider failed");
  });

  it("caches MCP tool discovery across searches on the same server", async () => {
    const settings = createRuntimeAppSettings({ webSearch: { providerId: "exa" } });

    await searchWeb({ query: "first", settings });
    await searchWeb({ query: "second", settings });

    expect(discoverMcpToolsMock).toHaveBeenCalledTimes(1);
    expect(callMcpToolMock).toHaveBeenCalledTimes(2);
  });

  it("re-discovers after a rejected discovery or a failed tool lookup", async () => {
    const settings = createRuntimeAppSettings({ webSearch: { providerId: "exa" } });

    discoverMcpToolsMock.mockRejectedValueOnce(new Error("boom"));
    await expect(searchWeb({ query: "first", settings })).rejects.toThrow("boom");
    await searchWeb({ query: "second", settings });
    expect(discoverMcpToolsMock).toHaveBeenCalledTimes(2);

    clearWebSearchDiscoveryCache();
    discoverMcpToolsMock.mockResolvedValueOnce([{ name: "unrelated", inputSchema: {} }]);
    await expect(searchWeb({ query: "third", settings })).rejects.toThrow(
      "did not expose the requested tool"
    );
    await searchWeb({ query: "fourth", settings });
    expect(discoverMcpToolsMock).toHaveBeenCalledTimes(4);
  });
});

describe("searxng base URL safety", () => {
  it("rejects non-http schemes, embedded credentials, and fragments in the update schema", () => {
    const valid = webSearchIntegrationUpdateSchema.parse({
      providerId: "searxng",
      configuration: { baseUrl: "http://169.254.169.254/latest/meta-data" }
    });
    expect(valid).toMatchObject({
      providerId: "searxng",
      configuration: { baseUrl: "http://169.254.169.254/latest/meta-data" }
    });

    for (const baseUrl of [
      "file:///etc/passwd",
      "ftp://files.example.com",
      "https://user:pass@search.example.com",
      "https://user@search.example.com",
      "https://search.example.com/#fragment"
    ]) {
      const result = webSearchIntegrationUpdateSchema.safeParse({
        providerId: "searxng",
        configuration: { baseUrl }
      });
      expect(result.success).toBe(false);
    }
  });
});

describe("web search pipeline configuration", () => {
  it("accepts pipeline configuration on every provider branch", () => {
    for (const providerId of ["disabled", "exa", "tavily"] as const) {
      const parsed = webSearchIntegrationUpdateSchema.parse({
        providerId,
        configuration: { pipeline: { mode: "always", maxQueries: 3 } }
      });
      expect(parsed).toMatchObject({
        providerId,
        configuration: { pipeline: { mode: "always", maxQueries: 3 } }
      });
    }

    const searxng = webSearchIntegrationUpdateSchema.parse({
      providerId: "searxng",
      configuration: {
        baseUrl: "https://search.example.com",
        pipeline: { mode: "off" }
      }
    });
    expect(searxng).toMatchObject({
      providerId: "searxng",
      configuration: { baseUrl: "https://search.example.com", pipeline: { mode: "off" } }
    });
  });

  it("rejects invalid pipeline modes and out-of-range query caps", () => {
    expect(webSearchIntegrationUpdateSchema.safeParse({
      providerId: "exa",
      configuration: { pipeline: { mode: "sometimes" } }
    }).success).toBe(false);
    expect(webSearchIntegrationUpdateSchema.safeParse({
      providerId: "exa",
      configuration: { pipeline: { mode: "auto", maxQueries: 9 } }
    }).success).toBe(false);
  });

  it("normalizes pipeline configuration and clamps maxQueries", () => {
    expect(normalizeWebSearchSelection("exa", {
      pipeline: { mode: "always", maxQueries: 99 }
    })).toEqual({
      providerId: "exa",
      configuration: { pipeline: { mode: "always", maxQueries: 5 } }
    });

    expect(normalizeWebSearchSelection("searxng", {
      baseUrl: "https://search.example.com",
      pipeline: { mode: "off", maxQueries: 0 }
    })).toEqual({
      providerId: "searxng",
      configuration: {
        baseUrl: "https://search.example.com",
        pipeline: { mode: "off", maxQueries: 1 }
      }
    });
  });

  it("defaults the pipeline to auto when unconfigured or invalid", () => {
    expect(normalizeWebSearchSelection("exa", {})).toEqual({
      providerId: "exa",
      configuration: { pipeline: { mode: "auto", maxQueries: 4 } }
    });
    expect(normalizeWebSearchSelection("tavily", { pipeline: "nonsense" })).toEqual({
      providerId: "tavily",
      configuration: { pipeline: { mode: "auto", maxQueries: 4 } }
    });
  });
});

describe("web page readers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebSearchDiscoveryCache();
    discoverMcpToolsMock.mockResolvedValue([
      { name: "web_fetch_exa", inputSchema: {} },
      { name: "tavily_extract", inputSchema: {} }
    ]);
    callMcpToolMock.mockResolvedValue({ isError: false });
  });

  it("formats page content with an optional title", () => {
    expect(formatPageContent("Title", "https://example.com/", "body")).toBe(
      "# Title\nSource: https://example.com/\n\nbody"
    );
    expect(formatPageContent("", "https://example.com/", "body")).toBe("Source: https://example.com/\n\nbody");
  });

  it("exposes no reader when search is disabled, self-hosted, unconfigured, or missing", () => {
    expect(getWebPageReader(undefined)).toBeNull();
    expect(getWebPageReader(createRuntimeAppSettings({ webSearch: { providerId: "disabled" } }))).toBeNull();
    expect(
      getWebPageReader(
        createRuntimeAppSettings({
          webSearch: { providerId: "searxng", configuration: { baseUrl: "https://search.example.com" } }
        })
      )
    ).toBeNull();
    expect(getWebPageReader(createRuntimeAppSettings({ webSearch: { providerId: "tavily" } }))).toBeNull();
  });

  it("reads pages through the Exa fetch tool with an explicit character budget", async () => {
    getToolResultTextMock.mockReturnValue("# Exa title\nURL: https://example.com/\n\nExa body");
    const settings = createRuntimeAppSettings({ webSearch: { providerId: "exa" } });
    const reader = getWebPageReader(settings);

    await expect(
      reader!({ url: "https://example.com/", maxChars: 5000, settings, timeout: 20_000 })
    ).resolves.toBe("# Exa title\nURL: https://example.com/\n\nExa body");

    expect(callMcpToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://mcp.exa.ai/mcp" }),
      "web_fetch_exa",
      { urls: ["https://example.com/"], maxCharacters: 5000 },
      20_000,
      undefined
    );
  });

  it("reads pages through Tavily extract and unwraps its JSON payload", async () => {
    const settings = createRuntimeAppSettings({
      webSearch: { providerId: "tavily", credentials: { apiKey: "tvly-key" }, credentialStored: true }
    });
    const reader = getWebPageReader(settings)!;
    const read = () => reader({ url: "https://example.com/", maxChars: 32_000, settings });

    getToolResultTextMock.mockReturnValue(
      JSON.stringify({
        results: [{ url: "https://example.com/final", title: "Tavily title", raw_content: "# Heading\n\nBody" }],
        failed_results: []
      })
    );
    await expect(read()).resolves.toBe("# Tavily title\nSource: https://example.com/final\n\n# Heading\n\nBody");
    expect(callMcpToolMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-key" }),
      "tavily_extract",
      { urls: ["https://example.com/"], format: "markdown" },
      undefined,
      undefined
    );

    getToolResultTextMock.mockReturnValue(JSON.stringify({ results: [{ raw_content: "body only" }] }));
    await expect(read()).resolves.toBe("Source: https://example.com/\n\nbody only");

    getToolResultTextMock.mockReturnValue("plain provider text");
    await expect(read()).resolves.toBe("plain provider text");

    getToolResultTextMock.mockReturnValue(JSON.stringify(null));
    await expect(read()).resolves.toBe("null");

    getToolResultTextMock.mockReturnValue(
      JSON.stringify({ results: [], failed_results: [{ url: "https://example.com/", error: "blocked" }] })
    );
    await expect(read()).rejects.toThrow("blocked");

    getToolResultTextMock.mockReturnValue(JSON.stringify({ results: [] }));
    await expect(read()).rejects.toThrow("The page could not be extracted");
  });
});
