import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { deserializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";

import { MCP_PROTOCOL_VERSION } from "@/lib/constants";
import {
  appendBoundedText,
  MAX_RUNTIME_TOOL_RESULT_CHARS,
  truncateText
} from "@/lib/bounded-text";
import type { McpServer, McpTool, McpToolCallResult } from "@/lib/types";

export const MAX_MCP_RESULT_CHARS = MAX_RUNTIME_TOOL_RESULT_CHARS;
export const MAX_MCP_DISCOVERED_TOOLS = 100;
const MAX_MCP_TOOL_SCHEMA_CHARS = 32_000;
export const MAX_MCP_TRANSPORT_MESSAGE_BYTES = 4 * 1024 * 1024;

export class BoundedMcpStdioReadBuffer {
  private buffer: Buffer | undefined;
  private failure: Error | null = null;
  private failureReported = false;

  constructor(private readonly maxBytes = MAX_MCP_TRANSPORT_MESSAGE_BYTES) {}

  append(chunk: Buffer) {
    if (this.failure) {
      return;
    }

    const nextSize = (this.buffer?.byteLength ?? 0) + chunk.byteLength;
    if (nextSize > this.maxBytes) {
      this.buffer = undefined;
      this.failure = new Error("MCP stdio message exceeded the transport size limit");
      return;
    }

    this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk;
  }

  readMessage() {
    if (this.failure) {
      if (this.failureReported) {
        return null;
      }
      const error = this.failure;
      this.failureReported = true;
      throw error;
    }

    if (!this.buffer) {
      return null;
    }

    const newlineIndex = this.buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return null;
    }

    const line = this.buffer.toString("utf8", 0, newlineIndex).replace(/\r$/, "");
    this.buffer = this.buffer.subarray(newlineIndex + 1);
    return deserializeMessage(line);
  }

  clear() {
    this.buffer = undefined;
    this.failure = null;
    this.failureReported = false;
  }
}

function createBoundedResponseBody(body: ReadableStream<Uint8Array>, isEventStream: boolean) {
  let bufferedBytes = 0;
  let previousWasNewline = false;

  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (isEventStream) {
        for (const byte of chunk) {
          bufferedBytes += 1;
          if (byte === 10) {
            if (previousWasNewline) {
              bufferedBytes = 0;
            }
            previousWasNewline = true;
          } else if (byte !== 13) {
            previousWasNewline = false;
          }

          if (bufferedBytes > MAX_MCP_TRANSPORT_MESSAGE_BYTES) {
            controller.error(new Error("MCP HTTP event exceeded the transport size limit"));
            return;
          }
        }
      } else {
        bufferedBytes += chunk.byteLength;
        if (bufferedBytes > MAX_MCP_TRANSPORT_MESSAGE_BYTES) {
          controller.error(new Error("MCP HTTP response exceeded the transport size limit"));
          return;
        }
      }

      controller.enqueue(chunk);
    }
  }));
}

export async function boundedMcpFetch(url: string | URL, init?: RequestInit) {
  const response = await globalThis.fetch(url, init);
  const isEventStream = response.headers
    .get("content-type")
    ?.toLowerCase()
    .includes("text/event-stream") ?? false;
  const declaredLength = Number(response.headers.get("content-length") ?? 0);

  if (
    !isEventStream &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_MCP_TRANSPORT_MESSAGE_BYTES
  ) {
    await response.body?.cancel();
    throw new Error("MCP HTTP response exceeded the transport size limit");
  }

  if (!response.body) {
    return response;
  }

  return new Response(createBoundedResponseBody(response.body, isEventStream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

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
    const transport = new StdioClientTransport({
      command: server.command ?? "",
      args: server.args ?? undefined,
      env: server.env ?? undefined,
      stderr: "pipe"
    });
    (transport as unknown as { _readBuffer: BoundedMcpStdioReadBuffer })._readBuffer =
      new BoundedMcpStdioReadBuffer();
    return transport;
  }

  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: {
      headers: server.headers
    },
    fetch: boundedMcpFetch
  });

  transport.setProtocolVersion(MCP_PROTOCOL_VERSION);
  return transport;
}

function createClient() {
  return new Client(
    {
      name: "eidon",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
}

async function createConnectedClient(server: TestableMcpServer, abortSignal?: AbortSignal) {
  const transport = createTransport(server);
  const client = createClient();
  transport.onerror = () => {
    const key = getServerKey(server);
    if (connectedClients.get(key)?.transport === transport) {
      connectedClients.delete(key);
    }
    void closeTransport(transport);
  };
  transport.onclose = () => {
    const key = getServerKey(server);
    if (connectedClients.get(key)?.transport === transport) {
      connectedClients.delete(key);
    }
  };
  try {
    await client.connect(transport, {
      timeout: 30_000,
      maxTotalTimeout: 30_000,
      signal: abortSignal
    });
  } catch (error) {
    await closeTransport(transport);
    throw error;
  }
  return { key: getServerKey(server), client, transport };
}

export async function getConnectedClient(server: McpServer, abortSignal?: AbortSignal) {
  const key = getServerKey(server);
  const existing = connectedClients.get(key);

  if (existing) {
    return existing;
  }

  const connection = await createConnectedClient(server, abortSignal);
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
  const rawSchema = tool.inputSchema;
  let inputSchema = rawSchema;

  try {
    if (JSON.stringify(rawSchema).length > MAX_MCP_TOOL_SCHEMA_CHARS) {
      inputSchema = { type: "object", properties: {} };
    }
  } catch {
    inputSchema = { type: "object", properties: {} };
  }

  return {
    name: truncateText(tool.name, 200),
    title: tool.title ? truncateText(tool.title, 500) : undefined,
    description: tool.description ? truncateText(tool.description, 4_000) : undefined,
    inputSchema,
    annotations: tool.annotations
  };
}


export function getToolResultText(result: McpToolCallResult) {
  const textParts: string[] = [];
  let remaining = MAX_MCP_RESULT_CHARS;

  for (const item of result.content) {
    const part = (() => {
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
    })();

    if (!part) {
      continue;
    }

    const separatorLength = textParts.length ? 1 : 0;
    if (remaining <= separatorLength) {
      break;
    }

    const bounded = truncateText(part, remaining - separatorLength);
    textParts.push(bounded);
    remaining -= bounded.length + separatorLength;
    if (bounded.length < part.length) {
      break;
    }
  }

  const fullText = truncateText(textParts.join("\n").trim(), MAX_MCP_RESULT_CHARS);
  if (fullText) {
    return fullText;
  }

  if (result.structuredContent) {
    try {
      return truncateText(JSON.stringify(result.structuredContent), MAX_MCP_RESULT_CHARS);
    } catch {
      return "MCP tool returned structured content that could not be serialized.";
    }
  }

  return result.isError ? "Tool call failed." : "Tool call completed.";
}

export async function discoverMcpTools(server: McpServer, abortSignal?: AbortSignal): Promise<McpTool[]> {
  try {
    const connection = await getConnectedClient(server, abortSignal);
    const result = await connection.client.listTools(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000,
      signal: abortSignal
    });
    return result.tools.slice(0, MAX_MCP_DISCOVERED_TOOLS).map(normalizeTool);
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error;
    }
    return [];
  }
}

export async function callMcpTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
  timeout: number = 120_000,
  abortSignal?: AbortSignal
): Promise<McpToolCallResult> {
  try {
    const connection = await getConnectedClient(server, abortSignal);
    const result = await connection.client.callTool(
      {
        name: toolName,
        arguments: args
      },
      undefined,
      {
        timeout,
        maxTotalTimeout: timeout,
        signal: abortSignal
      }
    );

    if ("content" in result && Array.isArray(result.content)) {
      const normalized: McpToolCallResult = {
        content: result.content,
        structuredContent:
          result.structuredContent && typeof result.structuredContent === "object"
            ? (result.structuredContent as Record<string, unknown>)
            : undefined,
        isError: typeof result.isError === "boolean" ? result.isError : undefined
      };
      return {
        content: [{ type: "text", text: getToolResultText(normalized) }],
        isError: normalized.isError
      };
    }

    let fallbackText: string;
    try {
      fallbackText = truncateText(JSON.stringify(result.toolResult), MAX_MCP_RESULT_CHARS);
    } catch {
      fallbackText = "MCP tool returned a result that could not be serialized.";
    }
    return {
      content: [
        {
          type: "text",
          text: fallbackText
        }
      ]
    };
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error;
    }
    return {
      content: [
        {
          type: "text",
          text: truncateText(
            error instanceof Error ? error.message : "MCP tool call failed",
            MAX_MCP_RESULT_CHARS
          )
        }
      ],
      isError: true
    };
  }
}

export async function gatherAllMcpTools(
  servers: McpServer[],
  abortSignal?: AbortSignal
): Promise<
  Array<{
    server: McpServer;
    tools: McpTool[];
  }>
> {
  const results = await Promise.all(
    servers.map(async (server) => ({
      server,
      tools: await discoverMcpTools(server, abortSignal)
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
  let stderrTruncated = false;

  if (transport instanceof StdioClientTransport && transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer) => {
      const appended = appendBoundedText(
        stderrOutput,
        chunk.toString(),
        MAX_MCP_RESULT_CHARS
      );
      stderrOutput = appended.value;
      stderrTruncated ||= appended.truncated;
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
      stderr: stderrOutput
        ? stderrTruncated
          ? truncateText(`${stderrOutput} `, MAX_MCP_RESULT_CHARS)
          : stderrOutput
        : undefined
    };
  } finally {
    await closeTransport(transport);
  }
}
