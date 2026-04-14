import type { AppSettings, McpServer } from "@/lib/types";

const BUILTIN_WEB_SEARCH_SERVER_IDS = new Set([
  "builtin_web_search_exa",
  "builtin_web_search_tavily",
  "builtin_web_search_searxng"
]);

function buildBuiltinServer(
  input: Pick<McpServer, "id" | "name" | "slug" | "url">
): McpServer {
  const timestamp = new Date().toISOString();

  return {
    id: input.id,
    name: input.name,
    slug: input.slug,
    url: input.url,
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function getInjectedWebSearchMcpServer(settings: Pick<AppSettings, "webSearchEngine" | "exaApiKey" | "tavilyApiKey">) {
  if (settings.webSearchEngine === "exa") {
    const url = new URL("https://mcp.exa.ai/mcp");
    const apiKey = settings.exaApiKey.trim();

    if (apiKey) {
      url.searchParams.set("exaApiKey", apiKey);
    }

    return buildBuiltinServer({
      id: "builtin_web_search_exa",
      name: "Exa",
      slug: "builtin_search_exa",
      url: url.toString()
    });
  }

  if (settings.webSearchEngine === "tavily") {
    const apiKey = settings.tavilyApiKey.trim();
    if (!apiKey) {
      return null;
    }

    const url = new URL("https://mcp.tavily.com/mcp/");
    url.searchParams.set("tavilyApiKey", apiKey);

    return buildBuiltinServer({
      id: "builtin_web_search_tavily",
      name: "Tavily",
      slug: "builtin_search_tavily",
      url: url.toString()
    });
  }

  return null;
}

export function appendInjectedWebSearchMcpServer(
  servers: McpServer[],
  settings: Pick<AppSettings, "webSearchEngine" | "exaApiKey" | "tavilyApiKey">
) {
  const injectedServer = getInjectedWebSearchMcpServer(settings);

  return injectedServer ? [...servers, injectedServer] : servers;
}

export function getWebSearchActionLabel(serverId: string | null | undefined, fallbackLabel: string) {
  return serverId && BUILTIN_WEB_SEARCH_SERVER_IDS.has(serverId) ? "Web search" : fallbackLabel;
}
