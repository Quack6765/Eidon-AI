import type { McpServer } from "@/lib/types";

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

type McpToolCallResult = {
  content: Array<{ type: string; text?: string }>;
};

export async function discoverMcpTools(server: McpServer): Promise<McpTool[]> {
  try {
    const response = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...server.headers
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      })
    });

    if (!response.ok) return [];

    const data = await response.json() as { result?: { tools?: McpTool[] } };
    return data.result?.tools ?? [];
  } catch {
    return [];
  }
}

export async function callMcpTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...server.headers
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args
      }
    })
  });

  if (!response.ok) {
    return {
      content: [
        { type: "text", text: `MCP tool call failed: ${response.status} ${response.statusText}` }
      ]
    };
  }

  const data = await response.json() as {
    result?: McpToolCallResult;
    error?: { message?: string };
  };

  if (data.error) {
    return {
      content: [{ type: "text", text: `MCP error: ${data.error.message ?? "Unknown error"}` }]
    };
  }

  return (
    data.result ?? {
      content: [{ type: "text", text: "No result from MCP tool" }]
    }
  );
}

export async function gatherAllMcpTools(servers: McpServer[]): Promise<
  Array<{
    server: McpServer;
    tools: McpTool[];
  }>
> {
  const results = await Promise.all(
    servers.map(async (server) => {
      const tools = await discoverMcpTools(server);
      return { server, tools };
    })
  );

  return results;
}

export function buildMcpToolsDescription(
  mcpToolSets: Array<{ server: McpServer; tools: McpTool[] }>
): string {
  const parts: string[] = [];

  for (const { server, tools } of mcpToolSets) {
    if (!tools.length) continue;

    parts.push(`## MCP Server: ${server.name}`);
    for (const tool of tools) {
      parts.push(`### ${tool.name}`);
      if (tool.description) parts.push(tool.description);
      if (tool.inputSchema?.properties) {
        parts.push(
          `Parameters: ${JSON.stringify(tool.inputSchema.properties)}`
        );
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}
