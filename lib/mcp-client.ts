import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { MCP_PROTOCOL_VERSION } from "@/lib/constants";
import type { McpServer, McpTool, McpToolCallResult, ToolExecutionMode } from "@/lib/types";

type ConnectedMcpClient = {
  key: string;
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
};

type TestableMcpServer =
  | McpServer
  | {
      id?: string;
      name: string;
      url: string;
      headers: Record<string, string>;
      transport: McpServer["transport"];
      command: string | null;
      args: string[] | null;
      env: Record<string, string> | null;
      enabled?: boolean;
      createdAt?: string;
      updatedAt?: string;
    };

const connectedClients = new Map<string, ConnectedMcpClient>();

function getServerKey(server: TestableMcpServer) {
  return JSON.stringify({
    id: server.id ?? server.name,
    name: server.name,
    url: server.url,
    headers: server.headers,
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    updatedAt: server.updatedAt ?? null
  });
}

function createTransport(server: TestableMcpServer) {
  if (server.transport === "stdio") {
    return new StdioClientTransport({
      command: server.command ?? "",
      args: server.args ?? undefined,
      env: server.env ?? undefined,
      stderr: "pipe"
    });
  }

  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers: server.headers
    }
  });

  transport.setProtocolVersion(MCP_PROTOCOL_VERSION);
  return transport;
}

function createClient() {
  return new Client(
    {
      name: "hermes",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
}

async function createConnectedClient(server: TestableMcpServer) {
  const transport = createTransport(server);
  const client = createClient();
  transport.onerror = () => {
    const key = getServerKey(server);
    if (connectedClients.get(key)?.transport === transport) {
      connectedClients.delete(key);
    }
  };
  transport.onclose = () => {
    const key = getServerKey(server);
    if (connectedClients.get(key)?.transport === transport) {
      connectedClients.delete(key);
    }
  };
  await client.connect(transport, {
    timeout: 30_000,
    maxTotalTimeout: 30_000
  });
  return { key: getServerKey(server), client, transport };
}

async function getConnectedClient(server: McpServer) {
  const key = getServerKey(server);
  const existing = connectedClients.get(key);

  if (existing) {
    return existing;
  }

  const connection = await createConnectedClient(server);
  connectedClients.set(key, connection);
  return connection;
}

async function withEphemeralClient<T>(server: TestableMcpServer, handler: (connection: ConnectedMcpClient) => Promise<T>) {
  const connection = await createConnectedClient(server);

  try {
    return await handler(connection);
  } finally {
    await closeTransport(connection.transport);
  }
}

async function closeTransport(transport: StdioClientTransport | StreamableHTTPClientTransport) {
  if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
    await transport.terminateSession().catch(() => undefined);
  }

  await transport.close().catch(() => undefined);
}

function getToolDisplayName(tool: McpTool) {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}

function normalizeTool(tool: Awaited<ReturnType<Client["listTools"]>>["tools"][number]): McpTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations
  };
}

function filterToolsForMode(tools: McpTool[], mode: ToolExecutionMode) {
  if (mode === "read_write") {
    return tools;
  }

  return tools.filter((tool) => tool.annotations?.readOnlyHint === true);
}

export function summarizeToolResult(result: McpToolCallResult) {
  const textParts = result.content
    .map((item) => {
      if (item.type === "text" && item.text) {
        return item.text.trim();
      }
      if (item.type === "resource" && item.resource?.text) {
        return item.resource.text.trim();
      }
      if (item.type === "image") {
        return `[image${item.mimeType ? ` ${item.mimeType}` : ""}]`;
      }
      if (item.type === "audio") {
        return `[audio${item.mimeType ? ` ${item.mimeType}` : ""}]`;
      }
      if (item.type === "resource_link" && item.uri) {
        return item.uri;
      }
      return "";
    })
    .filter(Boolean);

  const summary = textParts.join("\n").trim();
  if (summary) {
    return summary.length > 280 ? `${summary.slice(0, 277)}...` : summary;
  }

  if (result.structuredContent) {
    const json = JSON.stringify(result.structuredContent);
    return json.length > 280 ? `${json.slice(0, 277)}...` : json;
  }

  return result.isError ? "Tool call failed." : "Tool call completed.";
}

export async function discoverMcpTools(server: McpServer): Promise<McpTool[]> {
  try {
    const connection = await getConnectedClient(server);
    const result = await connection.client.listTools(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000
    });
    return result.tools.map(normalizeTool);
  } catch {
    return [];
  }
}

export async function callMcpTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  try {
    const connection = await getConnectedClient(server);
    const result = await connection.client.callTool(
      {
        name: toolName,
        arguments: args
      },
      undefined,
      {
        timeout: 60_000,
        maxTotalTimeout: 60_000
      }
    );

    if ("content" in result && Array.isArray(result.content)) {
      return {
        content: result.content,
        structuredContent:
          result.structuredContent && typeof result.structuredContent === "object"
            ? (result.structuredContent as Record<string, unknown>)
            : undefined,
        isError: typeof result.isError === "boolean" ? result.isError : undefined
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.toolResult)
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : "MCP tool call failed"
        }
      ],
      isError: true
    };
  }
}

export async function gatherAllMcpTools(
  servers: McpServer[],
  mode: ToolExecutionMode = "read_write"
): Promise<
  Array<{
    server: McpServer;
    tools: McpTool[];
  }>
> {
  const results = await Promise.all(
    servers.map(async (server) => ({
      server,
      tools: filterToolsForMode(await discoverMcpTools(server), mode)
    }))
  );

  return results.filter((result) => result.tools.length > 0);
}

export function buildMcpToolsDescription(
  mcpToolSets: Array<{ server: McpServer; tools: McpTool[] }>
): string {
  const parts: string[] = [];

  for (const { server, tools } of mcpToolSets) {
    if (!tools.length) {
      continue;
    }

    parts.push(`## MCP Server: ${server.name} (${server.id})`);
    for (const tool of tools) {
      parts.push(`### ${getToolDisplayName(tool)} | name=${tool.name}`);
      if (tool.description) {
        parts.push(tool.description);
      }
      if (tool.annotations?.readOnlyHint === true) {
        parts.push("Mode: read-only");
      } else {
        parts.push("Mode: read-write");
      }
      if (tool.inputSchema?.properties) {
        parts.push(`Parameters: ${JSON.stringify(tool.inputSchema.properties)}`);
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

export async function disconnectMcpServer(server: McpServer) {
  const key = getServerKey(server);
  const connection = connectedClients.get(key);
  if (!connection) {
    return;
  }
  connectedClients.delete(key);
  await closeTransport(connection.transport);
}

export async function shutdownAllProcesses() {
  const activeConnections = [...connectedClients.values()];
  connectedClients.clear();
  await Promise.all(activeConnections.map((connection) => closeTransport(connection.transport)));
}

export async function testMcpServerConnection(server: TestableMcpServer) {
  return withEphemeralClient(server, async (connection) => {
    const toolResult = await connection.client.listTools(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000
    });
    return {
      protocolVersion:
        connection.transport instanceof StreamableHTTPClientTransport
          ? connection.transport.protocolVersion ?? MCP_PROTOCOL_VERSION
          : MCP_PROTOCOL_VERSION,
      serverInfo: connection.client.getServerVersion() ?? null,
      sessionId:
        connection.transport instanceof StreamableHTTPClientTransport
          ? connection.transport.sessionId ?? null
          : null,
      toolCount: toolResult.tools.length,
      tools: toolResult.tools.map(normalizeTool)
    };
  });
}
