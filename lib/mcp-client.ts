import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { MCP_PROTOCOL_VERSION } from "@/lib/constants";
import type { McpServer, McpTool, McpToolCallResult } from "@/lib/types";

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

export async function getConnectedClient(server: McpServer) {
  const key = getServerKey(server);
  const existing = connectedClients.get(key);

  if (existing) {
    return existing;
  }

  const connection = await createConnectedClient(server);
  connectedClients.set(key, connection);
  return connection;
}

async function closeTransport(transport: StdioClientTransport | StreamableHTTPClientTransport) {
  if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
    await transport.terminateSession().catch(() => undefined);
  }

  await transport.close().catch(() => undefined);
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


export function getToolResultText(result: McpToolCallResult) {
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

  const fullText = textParts.join("\n").trim();
  if (fullText) {
    return fullText;
  }

  if (result.structuredContent) {
    return JSON.stringify(result.structuredContent);
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
  args: Record<string, unknown>,
  timeout: number = 120_000
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
        timeout,
        maxTotalTimeout: timeout
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
  servers: McpServer[]
): Promise<
  Array<{
    server: McpServer;
    tools: McpTool[];
  }>
> {
  const results = await Promise.all(
    servers.map(async (server) => ({
      server,
      tools: await discoverMcpTools(server)
    }))
  );

  return results.filter((result) => result.tools.length > 0);
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

export async function initializeMcpServers() {
  const { listEnabledMcpServers } = await import("@/lib/mcp-servers");
  const servers = listEnabledMcpServers();
  await Promise.allSettled(servers.map((server) => getConnectedClient(server)));
}

export async function testMcpServerConnection(server: TestableMcpServer) {
  const transport = createTransport(server);
  let stderrOutput = "";

  if (transport instanceof StdioClientTransport && transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });
  }

  const client = createClient();

  try {
    await client.connect(transport, {
      timeout: 30_000,
      maxTotalTimeout: 30_000
    });
    const toolResult = await client.listTools(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000
    });
    return {
      protocolVersion:
        transport instanceof StreamableHTTPClientTransport
          ? transport.protocolVersion ?? MCP_PROTOCOL_VERSION
          : MCP_PROTOCOL_VERSION,
      serverInfo: client.getServerVersion() ?? null,
      sessionId:
        transport instanceof StreamableHTTPClientTransport
          ? transport.sessionId ?? null
          : null,
      toolCount: toolResult.tools.length,
      tools: toolResult.tools.map(normalizeTool),
      stderr: stderrOutput || undefined
    };
  } finally {
    await closeTransport(transport);
  }
}
