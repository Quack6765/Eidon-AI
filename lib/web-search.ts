import { callMcpTool, discoverMcpTools, getToolResultText } from "@/lib/mcp-client";
import { searchSearxng } from "@/lib/searxng";
import {
  getWebSearchReadinessError as getCatalogReadinessError,
  type WebSearchProviderId
} from "@/lib/web-search-catalog";
import type { McpServer, McpTool, RuntimeAppSettings } from "@/lib/types";

type WebSearchInput = {
  query: string;
  maxResults?: number;
  settings: RuntimeAppSettings;
  abortSignal?: AbortSignal;
  timeout?: number;
};

export type WebPageReadInput = {
  url: string;
  maxChars: number;
  settings: RuntimeAppSettings;
  abortSignal?: AbortSignal;
  timeout?: number;
};

export type WebSearchProvider = {
  id: WebSearchProviderId;
  getReadinessError(settings: RuntimeAppSettings): string | null;
  search(input: WebSearchInput): Promise<string>;
  readPage?(input: WebPageReadInput): Promise<string>;
};

export function formatPageContent(title: string, url: string, body: string) {
  return [title ? `# ${title}` : null, `Source: ${url}`, "", body].filter((line) => line !== null).join("\n");
}

function parseExtractedPage(text: string, url: string) {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return text;
  }
  if (!payload || typeof payload !== "object") return text;
  const { results, failed_results: failed } = payload as {
    results?: Array<{ url?: string; title?: string; raw_content?: string }>;
    failed_results?: Array<{ url?: string; error?: string }>;
  };
  const first = Array.isArray(results) ? results.find((entry) => typeof entry?.raw_content === "string") : undefined;
  if (first?.raw_content) {
    return formatPageContent(first.title?.trim() ?? "", first.url?.trim() || url, first.raw_content.trim());
  }
  const failure = Array.isArray(failed) ? failed[0] : undefined;
  throw new Error(failure?.error?.trim() || "The page could not be extracted");
}

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

const WEB_SEARCH_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;

type DiscoveryCacheEntry =
  | { tools: McpTool[]; promise?: undefined; expiresAt: number }
  | { tools?: undefined; promise: Promise<McpTool[]>; expiresAt: number };

const discoveryCache = new Map<string, DiscoveryCacheEntry>();

export function clearWebSearchDiscoveryCache() {
  discoveryCache.clear();
}

async function discoverSearchToolsCached(server: McpServer, abortSignal?: AbortSignal): Promise<McpTool[]> {
  const key = server.url;
  const cached = discoveryCache.get(key);
  if (cached?.tools) return cached.tools;
  if (cached?.promise) return cached.promise;

  const promise = discoverMcpTools(server, abortSignal)
    .then((tools) => {
      discoveryCache.set(key, { tools, expiresAt: Date.now() + WEB_SEARCH_DISCOVERY_CACHE_TTL_MS });
      return tools;
    })
    .catch((error) => {
      discoveryCache.delete(key);
      throw error;
    });
  discoveryCache.set(key, { promise, expiresAt: Number.MAX_SAFE_INTEGER });
  return promise;
}

function exaServer(settings: RuntimeAppSettings) {
  const url = new URL("https://mcp.exa.ai/mcp");
  const apiKey = settings.webSearch.credentials.apiKey?.trim();
  if (apiKey) {
    url.searchParams.set("exaApiKey", apiKey);
  }
  return mcpServer(url.toString());
}

function tavilyServer(settings: RuntimeAppSettings) {
  const url = new URL("https://mcp.tavily.com/mcp/");
  url.searchParams.set("tavilyApiKey", settings.webSearch.credentials.apiKey?.trim() ?? "");
  return mcpServer(url.toString());
}

async function callSearchMcp(input: {
  server: McpServer;
  preferredToolNames: string[];
  args: Record<string, unknown>;
  timeout?: number;
  abortSignal?: AbortSignal;
}) {
  const tools = await discoverSearchToolsCached(input.server, input.abortSignal);
  const tool = input.preferredToolNames
    .map((name) => tools.find((candidate) => candidate.name === name))
    .find(Boolean);
  if (!tool) {
    discoveryCache.delete(input.server.url);
    throw new Error("The configured search provider did not expose the requested tool");
  }
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
      return callSearchMcp({
        server: exaServer(input.settings),
        preferredToolNames: ["web_search_exa", "web_search"],
        args: {
          query: input.query,
          ...(input.maxResults ? { numResults: input.maxResults } : {})
        },
        timeout: input.timeout,
        abortSignal: input.abortSignal
      });
    },
    readPage(input) {
      return callSearchMcp({
        server: exaServer(input.settings),
        preferredToolNames: ["web_fetch_exa"],
        args: { urls: [input.url], maxCharacters: input.maxChars },
        timeout: input.timeout,
        abortSignal: input.abortSignal
      });
    }
  },
  tavily: {
    id: "tavily",
    getReadinessError: (settings) => getCatalogReadinessError(settings.webSearch),
    search(input) {
      return callSearchMcp({
        server: tavilyServer(input.settings),
        preferredToolNames: ["tavily_search", "search"],
        args: {
          query: input.query,
          ...(input.maxResults ? { max_results: input.maxResults } : {})
        },
        timeout: input.timeout,
        abortSignal: input.abortSignal
      });
    },
    async readPage(input) {
      const text = await callSearchMcp({
        server: tavilyServer(input.settings),
        preferredToolNames: ["tavily_extract"],
        args: { urls: [input.url], format: "markdown" },
        timeout: input.timeout,
        abortSignal: input.abortSignal
      });
      return parseExtractedPage(text, input.url);
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

export function getWebPageReader(settings: RuntimeAppSettings | undefined) {
  if (!settings) return null;
  const provider = providers[settings.webSearch.providerId];
  if (!provider.readPage || provider.getReadinessError(settings)) return null;
  return provider.readPage;
}

export function searchWeb(input: WebSearchInput) {
  const provider = providers[input.settings.webSearch.providerId];
  const readinessError = provider.getReadinessError(input.settings);
  if (readinessError) throw new Error(readinessError);
  return provider.search(input);
}
