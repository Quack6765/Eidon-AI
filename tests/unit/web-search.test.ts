import { appendInjectedWebSearchMcpServer, getInjectedWebSearchMcpServer } from "@/lib/web-search";
import type { AppSettings, McpServer } from "@/lib/types";

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 100,
    mcpTimeout: 120_000,
    sttEngine: "browser",
    sttLanguage: "auto",
    webSearchEngine: "exa",
    exaApiKey: "",
    tavilyApiKey: "",
    searxngBaseUrl: "",
    imageGenerationBackend: "disabled",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "",
    comfyuiBaseUrl: "",
    comfyuiAuthType: "none",
    comfyuiBearerToken: "",
    comfyuiWorkflowJson: "",
    comfyuiPromptPath: "",
    comfyuiNegativePromptPath: "",
    comfyuiWidthPath: "",
    comfyuiHeightPath: "",
    comfyuiSeedPath: "",
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "mcp_existing",
    name: "Existing",
    slug: "existing",
    url: "https://mcp.example.com",
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("web search provider injection", () => {
  it("injects Exa by default without authentication", () => {
    const server = getInjectedWebSearchMcpServer(makeSettings());

    expect(server).toMatchObject({
      id: "builtin_web_search_exa",
      name: "Exa",
      slug: "builtin_search_exa",
      transport: "streamable_http",
      headers: {}
    });
    expect(server?.url).toBe("https://mcp.exa.ai/mcp");
  });

  it("injects Exa with an encoded query-string API key when provided", () => {
    const server = getInjectedWebSearchMcpServer(
      makeSettings({
        exaApiKey: "exa key+value"
      })
    );

    const url = new URL(server!.url);
    expect(url.origin + url.pathname).toBe("https://mcp.exa.ai/mcp");
    expect(url.searchParams.get("exaApiKey")).toBe("exa key+value");
  });

  it("injects Tavily with an encoded query-string API key", () => {
    const server = getInjectedWebSearchMcpServer(
      makeSettings({
        webSearchEngine: "tavily",
        tavilyApiKey: "tvly-secret"
      })
    );

    const url = new URL(server!.url);
    expect(server).toMatchObject({
      id: "builtin_web_search_tavily",
      name: "Tavily",
      slug: "builtin_search_tavily",
      transport: "streamable_http",
      headers: {}
    });
    expect(url.origin + url.pathname).toBe("https://mcp.tavily.com/mcp/");
    expect(url.searchParams.get("tavilyApiKey")).toBe("tvly-secret");
  });

  it("does not inject an MCP server for Disabled or SearXNG", () => {
    expect(
      getInjectedWebSearchMcpServer(
        makeSettings({
          webSearchEngine: "disabled"
        })
      )
    ).toBeNull();

    expect(
      getInjectedWebSearchMcpServer(
        makeSettings({
          webSearchEngine: "searxng",
          searxngBaseUrl: "https://search.example.com"
        })
      )
    ).toBeNull();
  });

  it("does not inject Tavily without an API key and leaves the server list untouched", () => {
    const baseServers = [makeServer()];
    const settings = makeSettings({
      webSearchEngine: "tavily",
      tavilyApiKey: ""
    });

    expect(getInjectedWebSearchMcpServer(settings)).toBeNull();
    expect(appendInjectedWebSearchMcpServer(baseServers, settings)).toBe(baseServers);
  });

  it("appends the injected MCP server after persisted MCP servers", () => {
    const baseServers = [makeServer()];
    const servers = appendInjectedWebSearchMcpServer(
      baseServers,
      makeSettings({
        webSearchEngine: "tavily",
        tavilyApiKey: "tvly-secret"
      })
    );

    expect(servers.map((server) => server.id)).toEqual([
      "mcp_existing",
      "builtin_web_search_tavily"
    ]);
  });
});
