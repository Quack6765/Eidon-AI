import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import type { McpServer } from "@/lib/types";

const clientInstances: MockClient[] = [];
const stdioTransportInstances: MockStdioTransport[] = [];
const httpTransportInstances: MockStreamableHTTPTransport[] = [];

let nextListToolsResult: { tools: unknown[] } = { tools: [] };
let nextListToolsError: Error | null = null;
let nextCallToolResult: unknown = { content: [] };
let nextCallToolError: Error | null = null;
let nextConnectError: Error | null = null;
let nextServerVersion: { name: string; version: string } | undefined = {
  name: "Mock MCP Server",
  version: "1.0.0"
};
let nextHttpSessionId = "session_test";
let nextHttpProtocolVersion = "2025-03-26";
let nextStderrChunks: Buffer[] = [];

class MockClient {
  connect = vi.fn(async (transport: unknown) => {
    this.transport = transport;
    const handler = (transport as { stderr?: { on: ReturnType<typeof vi.fn> } }).stderr
      ?.on.mock.calls.find(([event]) => event === "data")?.[1] as
      | ((chunk: Buffer) => void)
      | undefined;
    nextStderrChunks.forEach((chunk) => handler?.(chunk));
    if (nextConnectError) {
      throw nextConnectError;
    }
  });

  listTools = vi.fn(async () => {
    if (nextListToolsError) {
      throw nextListToolsError;
    }

    return nextListToolsResult;
  });

  callTool = vi.fn(async () => {
    if (nextCallToolError) {
      throw nextCallToolError;
    }

    return nextCallToolResult;
  });

  getServerVersion = vi.fn(() => nextServerVersion);
  transport: unknown;

  constructor(..._args: unknown[]) {
    clientInstances.push(this);
  }
}

class MockStdioTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  close = vi.fn(async () => {
    this.onclose?.();
  });
  options: Record<string, unknown>;
  stderr: { on: ReturnType<typeof vi.fn> } | undefined;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    this.stderr = { on: vi.fn() };
    stdioTransportInstances.push(this);
  }
}

class MockStreamableHTTPTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  close = vi.fn(async () => {
    this.onclose?.();
  });
  terminateSession = vi.fn(async () => undefined);
  setProtocolVersion = vi.fn((version: string) => {
    this.protocolVersion = version;
  });
  sessionId = nextHttpSessionId;
  protocolVersion = nextHttpProtocolVersion;
  url: URL;
  options: Record<string, unknown> | undefined;

  constructor(url: URL, options?: Record<string, unknown>) {
    this.url = url;
    this.options = options;
    this.sessionId = nextHttpSessionId;
    this.protocolVersion = nextHttpProtocolVersion;
    httpTransportInstances.push(this);
  }
}

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: MockClient
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: MockStdioTransport
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: MockStreamableHTTPTransport,
  StreamableHTTPError: class StreamableHTTPError extends Error {
    constructor(
      public readonly code: number | undefined,
      message: string | undefined
    ) {
      super(message ?? "StreamableHTTPError");
    }
  }
}));

const listEnabledMcpServers = vi.fn();
vi.mock("@/lib/mcp-servers", () => ({
  listEnabledMcpServers
}));

function createHttpServer(): McpServer {
  return {
    id: "mcp_http",
    name: "HTTP Server",
    slug: "http_server",
    url: "https://mcp.example.com",
    headers: { Authorization: "Bearer test" },
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createStdioServer(): McpServer {
  return {
    id: "mcp_stdio",
    name: "stdio Server",
    slug: "stdio_server",
    url: "",
    headers: {},
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    env: { TOKEN: "test" },
    enabled: true,
    isVisionMcp: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe("MCP client", () => {
  beforeEach(() => {
    vi.resetModules();
    clientInstances.length = 0;
    stdioTransportInstances.length = 0;
    httpTransportInstances.length = 0;
    nextListToolsResult = { tools: [] };
    nextListToolsError = null;
    nextCallToolResult = { content: [] };
    nextCallToolError = null;
    nextConnectError = null;
    nextServerVersion = { name: "Mock MCP Server", version: "1.0.0" };
    nextHttpSessionId = "session_test";
    nextHttpProtocolVersion = "2025-03-26";
    nextStderrChunks = [];
    listEnabledMcpServers.mockReset();
  });

  it("connects over stdio, lists tools, and reuses the initialized client for tool calls", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true }
        }
      ]
    };
    nextCallToolResult = {
      content: [{ type: "text", text: "hello" }]
    };

    const { callMcpTool, discoverMcpTools } = await import("@/lib/mcp-client");
    const server = createStdioServer();

    const tools = await discoverMcpTools(server);
    const result = await callMcpTool(server, "read_file", { path: "/tmp/a.txt" }, 60_000);

    expect(tools).toHaveLength(1);
    expect(result.content[0]?.text).toBe("hello");
    expect(clientInstances).toHaveLength(1);
    expect(clientInstances[0].connect).toHaveBeenCalledTimes(1);
    expect(clientInstances[0].listTools).toHaveBeenCalledTimes(1);
    expect(clientInstances[0].callTool).toHaveBeenCalledWith(
      {
        name: "read_file",
        arguments: { path: "/tmp/a.txt" }
      },
      undefined,
      expect.objectContaining({
        timeout: 60_000,
        maxTotalTimeout: 60_000
      })
    );
    expect(stdioTransportInstances[0].options).toMatchObject({
      command: "node",
      args: ["server.js"],
      env: { TOKEN: "test" },
      stderr: "pipe"
    });
  });

  it("tests streamable HTTP connections and reports negotiated session details", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "search",
          description: "Search",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true }
        }
      ]
    };
    nextHttpSessionId = "session_live";
    nextHttpProtocolVersion = "2025-03-26";

    const { testMcpServerConnection } = await import("@/lib/mcp-client");
    const result = await testMcpServerConnection(createHttpServer());

    expect(httpTransportInstances).toHaveLength(1);
    expect(httpTransportInstances[0].url.toString()).toBe("https://mcp.example.com/");
    expect(httpTransportInstances[0].options).toMatchObject({
      requestInit: {
        headers: { Authorization: "Bearer test" }
      },
      fetch: expect.any(Function)
    });
    expect(httpTransportInstances[0].setProtocolVersion).toHaveBeenCalledWith("2025-03-26");
    expect(httpTransportInstances[0].terminateSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      protocolVersion: "2025-03-26",
      sessionId: "session_live",
      toolCount: 1,
      serverInfo: { name: "Mock MCP Server", version: "1.0.0" }
    });
  });

  it("tests stdio connections and falls back to the protocol default when no server version is available", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "read_file",
          description: "Read file",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true }
        }
      ]
    };
    nextServerVersion = undefined;

    const { BoundedMcpStdioReadBuffer, testMcpServerConnection } = await import("@/lib/mcp-client");
    const result = await testMcpServerConnection(createStdioServer());

    expect(result).toMatchObject({
      protocolVersion: "2025-03-26",
      sessionId: null,
      serverInfo: null,
      toolCount: 1
    });
    expect(
      (stdioTransportInstances[0] as unknown as { _readBuffer: unknown })._readBuffer
    ).toBeInstanceOf(BoundedMcpStdioReadBuffer);
  });

  it("normalizes transport failures and surfaces tool errors", async () => {
    nextListToolsError = new Error("list failed");
    nextCallToolError = new Error("tool exploded");

    const { callMcpTool, discoverMcpTools } = await import("@/lib/mcp-client");
    const server = createHttpServer();

    await expect(discoverMcpTools(server)).resolves.toEqual([]);

    const result = await callMcpTool(server, "write_file", { path: "/tmp/a.txt" }, 60_000);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("tool exploded");
  });

  it("closes uncached transports when connecting fails", async () => {
    nextConnectError = new Error("connect failed");
    const { getConnectedClient } = await import("@/lib/mcp-client");
    const server = createHttpServer();

    await expect(getConnectedClient(server)).rejects.toThrow("connect failed");

    expect(httpTransportInstances).toHaveLength(1);
    expect(httpTransportInstances[0].terminateSession).toHaveBeenCalledTimes(1);
    expect(httpTransportInstances[0].close).toHaveBeenCalledTimes(1);

    nextConnectError = null;
    await expect(getConnectedClient(server)).resolves.toBeDefined();
    expect(clientInstances).toHaveLength(2);
  });

  it("preserves explicit tool isError results", async () => {
    nextCallToolResult = {
      content: [{ type: "text", text: "permission denied" }],
      isError: true
    };

    const { callMcpTool } = await import("@/lib/mcp-client");
    const result = await callMcpTool(createHttpServer(), "write_file", { path: "/tmp/a.txt" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("permission denied");
  });

  it("forwards cancellation to MCP requests and bounds returned tool text", async () => {
    nextCallToolResult = {
      content: [{ type: "text", text: "x".repeat(40_000) }]
    };
    const controller = new AbortController();
    const { callMcpTool, MAX_MCP_RESULT_CHARS } = await import("@/lib/mcp-client");

    const result = await callMcpTool(
      createHttpServer(),
      "large_result",
      {},
      60_000,
      controller.signal
    );

    expect(clientInstances[0].callTool).toHaveBeenCalledWith(
      { name: "large_result", arguments: {} },
      undefined,
      expect.objectContaining({ signal: controller.signal })
    );
    expect(result.content[0]?.text?.length).toBeLessThanOrEqual(MAX_MCP_RESULT_CHARS);
    expect(result.content[0]?.text).toContain("...[truncated]");
  });

  it("caps the discovered MCP tool catalog", async () => {
    nextListToolsResult = {
      tools: Array.from({ length: 120 }, (_, index) => ({
        name: `tool_${index}`,
        description: "Tool",
        inputSchema: { type: "object" }
      }))
    };
    const { discoverMcpTools, MAX_MCP_DISCOVERED_TOOLS } = await import("@/lib/mcp-client");

    const tools = await discoverMcpTools(createHttpServer());

    expect(tools).toHaveLength(MAX_MCP_DISCOVERED_TOOLS);
  });

  it("rejects oversized HTTP responses while they are being read", async () => {
    const originalFetch = global.fetch;
    try {
      const { boundedMcpFetch, MAX_MCP_TRANSPORT_MESSAGE_BYTES } = await import("@/lib/mcp-client");
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_MCP_TRANSPORT_MESSAGE_BYTES));
              controller.enqueue(new Uint8Array(1));
              controller.close();
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );

      const response = await boundedMcpFetch("https://mcp.example.com");
      await expect(response.arrayBuffer()).rejects.toThrow(
        "MCP HTTP response exceeded the transport size limit"
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rejects oversized stdio messages before appending them to the parser buffer", async () => {
    const { BoundedMcpStdioReadBuffer } = await import("@/lib/mcp-client");
    const buffer = new BoundedMcpStdioReadBuffer(32);

    buffer.append(Buffer.alloc(33, 0x61));

    expect(() => buffer.readMessage()).toThrow(
      "MCP stdio message exceeded the transport size limit"
    );
    expect(buffer.readMessage()).toBeNull();
  });

  it("falls back to toolResult payloads and summarizes non-text content", async () => {
    nextCallToolResult = {
      toolResult: {
        ok: true
      }
    };

    const { callMcpTool, getToolResultText } = await import("@/lib/mcp-client");
    const result = await callMcpTool(createHttpServer(), "search_docs", { query: "MCP" }, 60_000);

    expect(result.content[0]?.text).toBe('{"ok":true}');
    expect(
      getToolResultText({
        content: [
          { type: "image", mimeType: "image/png" },
          { type: "audio", mimeType: "audio/mpeg" },
          { type: "resource_link", uri: "https://example.com" },
          { type: "unknown" }
        ]
      })
    ).toContain("[image image/png]");
    expect(
      getToolResultText({
        content: [],
        structuredContent: { ok: true }
      })
    ).toBe('{"ok":true}');
    expect(
      getToolResultText({
        content: [],
        isError: true
      })
    ).toBe("Tool call failed.");
    expect(
      getToolResultText({
        content: [],
        isError: false
      })
    ).toBe("Tool call completed.");
  });

  it("drops primitive structured content from callTool results", async () => {
    nextCallToolResult = {
      content: [{ type: "text", text: "ok" }],
      structuredContent: "primitive value",
      isError: false
    };

    const { callMcpTool } = await import("@/lib/mcp-client");
    const result = await callMcpTool(createHttpServer(), "search_docs", { query: "MCP" });

    expect(result).toEqual({
      content: [{ type: "text", text: "ok" }],
      structuredContent: undefined,
      isError: false
    });
  });

  it("builds descriptions using tool titles and closes cached connections on shutdown", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "search_docs",
          title: "Search docs",
          description: "Search docs",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } }
          },
          annotations: { title: "Search docs", readOnlyHint: false }
        }
      ]
    };

    const {
      disconnectMcpServer,
      discoverMcpTools,
      shutdownAllProcesses
    } = await import("@/lib/mcp-client");
    const httpServer = createHttpServer();
    const stdioServer = createStdioServer();

    const [httpTools, stdioTools] = await Promise.all([
      discoverMcpTools(httpServer),
      discoverMcpTools(stdioServer)
    ]);

    expect(httpTools.length).toBeGreaterThan(0);
    expect(stdioTools.length).toBeGreaterThan(0);

    await disconnectMcpServer(httpServer);
    expect(httpTransportInstances[0].terminateSession).toHaveBeenCalledTimes(1);
    expect(httpTransportInstances[0].close).toHaveBeenCalledTimes(1);

    await shutdownAllProcesses();
    expect(stdioTransportInstances[0].close).toHaveBeenCalledTimes(1);
  });

  it("drops cached clients when transports close or error and skips empty tool groups", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "safe_read",
          description: "Safe read",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true }
        }
      ]
    };

    const {
      disconnectMcpServer,
      discoverMcpTools,
      gatherAllMcpTools
    } = await import("@/lib/mcp-client");
    const server = createHttpServer();

    await discoverMcpTools(server);
    expect(clientInstances).toHaveLength(1);

    httpTransportInstances[0].onerror?.(new Error("socket dropped"));

    await discoverMcpTools(server);
    expect(clientInstances).toHaveLength(2);

    httpTransportInstances[1].onclose?.();

    await discoverMcpTools(server);
    expect(clientInstances).toHaveLength(3);

    nextListToolsResult = {
      tools: [
        {
          name: "write_file",
          description: "Write file",
          inputSchema: { type: "object" },
          annotations: {}
        }
      ]
    };

    const result = await gatherAllMcpTools([server]);
    expect(result[0]?.tools.map((tool) => tool.name)).toEqual(["write_file"]);
    await expect(disconnectMcpServer(createStdioServer())).resolves.toBeUndefined();
  });

  it("returns full text without truncation and preserves resource text content", async () => {
    const { getToolResultText } = await import("@/lib/mcp-client");

    expect(
      getToolResultText({
        content: [
          {
            type: "resource",
            resource: {
              uri: "file://report",
              text: "resource text"
            }
          }
        ]
      })
    ).toBe("resource text");

    const longText = "x".repeat(400);
    const result = getToolResultText({
      content: [{ type: "text", text: longText }]
    });

    expect(result.length).toBe(400);
    expect(result).toBe(longText);
  });

  it("initializes all enabled MCP servers on boot", async () => {
    listEnabledMcpServers.mockReturnValue([createStdioServer(), createHttpServer()]);

    const { initializeMcpServers } = await import("@/lib/mcp-client");
    await initializeMcpServers();

    expect(listEnabledMcpServers).toHaveBeenCalledTimes(1);
    expect(clientInstances).toHaveLength(2);
  });

  it("captures stderr output during stdio connection tests", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "read_file",
          description: "Read a file",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true }
        }
      ]
    };

    const { testMcpServerConnection } = await import("@/lib/mcp-client");
    await testMcpServerConnection(createStdioServer());

    expect(stdioTransportInstances[0].stderr?.on).toHaveBeenCalledWith("data", expect.any(Function));
  });

  it("bounds stdio test stderr before accumulating large chunks", async () => {
    nextStderrChunks = [Buffer.from("x".repeat(80_000)), Buffer.from("y".repeat(80_000))];

    const { MAX_MCP_RESULT_CHARS, testMcpServerConnection } = await import("@/lib/mcp-client");
    const result = await testMcpServerConnection(createStdioServer());

    expect(result.stderr?.length).toBeLessThanOrEqual(MAX_MCP_RESULT_CHARS);
    expect(result.stderr).toContain("...[truncated]");
  });

  it("drains chatty stdio server stderr so persistent tool calls complete", async () => {
    vi.doUnmock("@modelcontextprotocol/sdk/client/index.js");
    vi.doUnmock("@modelcontextprotocol/sdk/client/stdio.js");
    vi.doUnmock("@modelcontextprotocol/sdk/client/streamableHttp.js");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const { callMcpTool, disconnectMcpServer } = await import("@/lib/mcp-client");
      const server = createStdioServer();
      server.command = process.execPath;
      server.args = [
        fileURLToPath(new URL("../fixtures/fake-mcp-stdio-server.mjs", import.meta.url))
      ];

      const result = await callMcpTool(server, "spam_stderr", {}, 15_000);

      expect(result.isError ?? false).toBe(false);
      expect(result.content[0]?.text).toBe("stderr drained");

      await disconnectMcpServer(server);
      await vi.waitFor(() => {
        expect(
          consoleError.mock.calls.some(
            ([message]) => typeof message === "string" && message.startsWith("[mcp-stderr stdio Server]")
          )
        ).toBe(true);
      });
    } finally {
      consoleError.mockRestore();
      vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
        Client: MockClient
      }));
      vi.doMock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
        StdioClientTransport: MockStdioTransport
      }));
      vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
        StreamableHTTPClientTransport: MockStreamableHTTPTransport
      }));
    }
  }, 30_000);

  it("settles hanging HTTP tool calls on timeout and abort without wedging the event loop", async () => {
    vi.doUnmock("@modelcontextprotocol/sdk/client/index.js");
    vi.doUnmock("@modelcontextprotocol/sdk/client/stdio.js");
    vi.doUnmock("@modelcontextprotocol/sdk/client/streamableHttp.js");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const openResponses = new Set<http.ServerResponse>();
    const mcpServer = http.createServer((req, res) => {
      openResponses.add(res);
      res.on("close", () => openResponses.delete(res));
      if (req.method === "GET") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": keepalive\n\n");
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        let body: { id?: number; method?: string } = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        if (body.method === "initialize") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "mcp-session-id": "session_hanging_test"
          });
          res.write(
            `event: message\ndata: ${JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "hanging-mcp", version: "1.0.0" }
              }
            })}\n\n`
          );
          res.end();
          return;
        }
        if (body.method === "tools/call") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write(": keepalive\n\n");
          return;
        }
        res.writeHead(202);
        res.end();
      });
    });

    try {
      await new Promise<void>((resolve) => mcpServer.listen(0, "127.0.0.1", resolve));
      const baseUrl = `http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`;
      const makeServer = (): McpServer => ({
        ...createHttpServer(),
        id: `hanging_${Math.random().toString(36).slice(2)}`,
        url: baseUrl
      });
      const { callMcpTool, disconnectMcpServer } = await import("@/lib/mcp-client");

      const timedOut = await callMcpTool(makeServer(), "tavily_search", { query: "x" }, 800);
      expect(timedOut.isError).toBe(true);
      expect(timedOut.content[0]?.text).toContain("Request timed out");

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 300);
      const abortServer = makeServer();
      await expect(
        callMcpTool(abortServer, "tavily_search", { query: "x" }, 60_000, controller.signal)
      ).rejects.toThrow(/abort/i);

      await disconnectMcpServer(abortServer);
    } finally {
      consoleError.mockRestore();
      for (const res of openResponses) res.destroy();
      mcpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
      vi.doMock("@modelcontextprotocol/sdk/client/index.js", () => ({
        Client: MockClient
      }));
      vi.doMock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
        StdioClientTransport: MockStdioTransport
      }));
      vi.doMock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
        StreamableHTTPClientTransport: MockStreamableHTTPTransport
      }));
    }
  }, 20_000);
});
