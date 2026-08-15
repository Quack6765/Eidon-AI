import {
  getWebSearchReadinessError,
  searchWeb
} from "@/lib/web-search";
import {
  isPublicHttpUrl,
  webSearchIntegrationUpdateSchema
} from "@/lib/web-search-catalog";
import { createRuntimeAppSettings } from "@/tests/provider-fixtures";

const {
  callMcpToolMock,
  discoverMcpToolsMock,
  getToolResultTextMock,
  lookupMock,
  searchSearxngMock
} = vi.hoisted(() => ({
  callMcpToolMock: vi.fn(),
  discoverMcpToolsMock: vi.fn(),
  getToolResultTextMock: vi.fn(),
  lookupMock: vi.fn(),
  searchSearxngMock: vi.fn()
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock
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
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
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

describe("searxng base URL safety", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  it("classifies literal private, loopback, and metadata addresses as non-public", async () => {
    for (const baseUrl of [
      "http://127.0.0.1:8080",
      "http://127.8.9.10",
      "http://10.1.2.3",
      "http://172.16.0.1",
      "http://172.31.255.255",
      "http://192.168.1.1",
      "http://169.254.169.254",
      "http://0.0.0.0",
      "http://[::1]",
      "http://[::]",
      "http://[fe80::1]",
      "http://[fc00::1]",
      "http://[fd12:3456:789a::1]",
      "http://[::ffff:169.254.169.254]"
    ]) {
      await expect(isPublicHttpUrl(baseUrl)).resolves.toBe(false);
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("classifies public literal and resolved addresses as public", async () => {
    await expect(isPublicHttpUrl("https://8.8.8.8")).resolves.toBe(true);
    await expect(isPublicHttpUrl("https://search.example.com")).resolves.toBe(true);
    expect(lookupMock).toHaveBeenCalledWith("search.example.com", { all: true });
  });

  it("treats hostnames resolving into private ranges as non-public", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.0.5", family: 4 }]);
    await expect(isPublicHttpUrl("https://internal.example.com")).resolves.toBe(false);

    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.2", family: 4 }
    ]);
    await expect(isPublicHttpUrl("https://mixed.example.com")).resolves.toBe(false);

    lookupMock.mockResolvedValue([{ address: "::ffff:10.0.0.2", family: 6 }]);
    await expect(isPublicHttpUrl("https://mapped.example.com")).resolves.toBe(false);
  });

  it("treats unresolvable hostnames and non-http URLs as non-public", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(isPublicHttpUrl("https://missing.example.com")).resolves.toBe(false);

    await expect(isPublicHttpUrl("file:///etc/passwd")).resolves.toBe(false);
    await expect(isPublicHttpUrl("ftp://files.example.com")).resolves.toBe(false);
    await expect(isPublicHttpUrl("not a url")).resolves.toBe(false);
  });

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
