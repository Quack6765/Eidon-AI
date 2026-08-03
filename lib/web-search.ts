import { callMcpTool, discoverMcpTools, getToolResultText } from "@/lib/mcp-client";
import { searchSearxng } from "@/lib/searxng";
import {
  getWebSearchReadinessError as getCatalogReadinessError,
  type WebSearchProviderId
} from "@/lib/web-search-catalog";
import type { McpServer, RuntimeAppSettings } from "@/lib/types";

type WebSearchInput = {
  query: string;
  maxResults?: number;
  settings: RuntimeAppSettings;
  abortSignal?: AbortSignal;
  timeout?: number;
};

export type WebSearchProvider = {
  id: WebSearchProviderId;
  getReadinessError(settings: RuntimeAppSettings): string | null;
  search(input: WebSearchInput): Promise<string>;
};

function mcpServer(url: string): McpServer {
  const timestamp = new Date().toISOString();
  return {
    id: "integration_web_search",
    name: "Web search",
    slug: "web_search",
    url,
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function callSearchMcp(input: {
  server: McpServer;
  preferredToolNames: string[];
  args: Record<string, unknown>;
  timeout?: number;
  abortSignal?: AbortSignal;
}) {
  const tools = await discoverMcpTools(input.server, input.abortSignal);
  const tool = input.preferredToolNames
    .map((name) => tools.find((candidate) => candidate.name === name))
    .find(Boolean);
  if (!tool) throw new Error("The configured search provider did not expose its search tool");
  const result = await callMcpTool(
    input.server,
    tool.name,
    input.args,
    input.timeout,
    input.abortSignal
  );
  if (result.isError) throw new Error(getToolResultText(result));
  return getToolResultText(result);
}

const providers: Record<WebSearchProviderId, WebSearchProvider> = {
  disabled: {
    id: "disabled",
    getReadinessError: (settings) => getCatalogReadinessError(settings.webSearch),
    async search() {
      throw new Error("Web search is disabled");
    }
  },
  exa: {
    id: "exa",
    getReadinessError: (settings) => getCatalogReadinessError(settings.webSearch),
    search(input) {
      const url = new URL("https://mcp.exa.ai/mcp");
      const apiKey = input.settings.webSearch.credentials.apiKey?.trim();
      if (apiKey) {
        url.searchParams.set("exaApiKey", apiKey);
      }
      return callSearchMcp({
        server: mcpServer(url.toString()),
        preferredToolNames: ["web_search_exa", "web_search"],
        args: {
          query: input.query,
          ...(input.maxResults ? { numResults: input.maxResults } : {})
        },
        timeout: input.timeout,
        abortSignal: input.abortSignal
      });
    }
  },
  tavily: {
    id: "tavily",
    getReadinessError: (settings) => getCatalogReadinessError(settings.webSearch),
    search(input) {
      const url = new URL("https://mcp.tavily.com/mcp/");
      url.searchParams.set("tavilyApiKey", input.settings.webSearch.credentials.apiKey?.trim() ?? "");
      return callSearchMcp({
        server: mcpServer(url.toString()),
        preferredToolNames: ["tavily_search", "search"],
        args: {
          query: input.query,
          ...(input.maxResults ? { max_results: input.maxResults } : {})
        },
        timeout: input.timeout,
        abortSignal: input.abortSignal
      });
    }
  },
  searxng: {
    id: "searxng",
    getReadinessError: (settings) => getCatalogReadinessError(settings.webSearch),
    search(input) {
      return searchSearxng({
        baseUrl: String(input.settings.webSearch.configuration.baseUrl ?? ""),
        query: input.query,
        maxResults: input.maxResults,
        abortSignal: input.abortSignal
      });
    }
  }
};

export function getWebSearchReadinessError(settings: RuntimeAppSettings) {
  return providers[settings.webSearch.providerId].getReadinessError(settings);
}

export function searchWeb(input: WebSearchInput) {
  const provider = providers[input.settings.webSearch.providerId];
  const readinessError = provider.getReadinessError(input.settings);
  if (readinessError) throw new Error(readinessError);
  return provider.search(input);
}
