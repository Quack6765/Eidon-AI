import {
  getWebSearchReadinessError,
  searchWeb
} from "@/lib/web-search";
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
      "did not expose its search tool"
    );

    discoverMcpToolsMock.mockResolvedValueOnce([{ name: "web_search", inputSchema: {} }]);
    callMcpToolMock.mockResolvedValueOnce({ isError: true });
    getToolResultTextMock.mockReturnValueOnce("provider failed");
    await expect(searchWeb({ query: "query", settings })).rejects.toThrow("provider failed");
  });
});
