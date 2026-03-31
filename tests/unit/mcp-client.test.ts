import type { McpServer } from "@/lib/types";

const clientInstances: MockClient[] = [];
const stdioTransportInstances: MockStdioTransport[] = [];
const httpTransportInstances: MockStreamableHTTPTransport[] = [];

let nextListToolsResult: { tools: unknown[] } = { tools: [] };
let nextListToolsError: Error | null = null;
let nextCallToolResult: unknown = { content: [] };
let nextCallToolError: Error | null = null;
let nextServerVersion: { name: string; version: string } | undefined = {
  name: "Mock MCP Server",
  version: "1.0.0"
};
let nextHttpSessionId = "session_test";
let nextHttpProtocolVersion = "2025-03-26";

class MockClient {
  connect = vi.fn(async (transport: unknown) => {
    this.transport = transport;
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

  constructor(options: Record<string, unknown>) {
    this.options = options;
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
  StreamableHTTPClientTransport: MockStreamableHTTPTransport
}));

function createHttpServer(): McpServer {
  return {
    id: "mcp_http",
    name: "HTTP Server",
    url: "https://mcp.example.com",
    headers: { Authorization: "Bearer test" },
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createStdioServer(): McpServer {
  return {
    id: "mcp_stdio",
    name: "stdio Server",
    url: "",
    headers: {},
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    env: { TOKEN: "test" },
    enabled: true,
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
    nextServerVersion = { name: "Mock MCP Server", version: "1.0.0" };
    nextHttpSessionId = "session_test";
    nextHttpProtocolVersion = "2025-03-26";
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
    const result = await callMcpTool(server, "read_file", { path: "/tmp/a.txt" });

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

  it("filters tools by read-only mode and preserves all tools in read-write mode", async () => {
    nextListToolsResult = {
      tools: [
        {
          name: "safe_read",
          description: "Safe read",
          inputSchema: { type: "object" },
          annotations: { readOnlyHint: true }
        },
        {
          name: "write_file",
          description: "Write file",
          inputSchema: { type: "object" },
          annotations: {}
        }
      ]
    };

    const { gatherAllMcpTools } = await import("@/lib/mcp-client");
    const server = createHttpServer();

    const readOnly = await gatherAllMcpTools([server], "read_only");
    const readWrite = await gatherAllMcpTools([server], "read_write");

    expect(readOnly[0]?.tools.map((tool) => tool.name)).toEqual(["safe_read"]);
    expect(readWrite[0]?.tools.map((tool) => tool.name)).toEqual(["safe_read", "write_file"]);
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
      }
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

  it("normalizes transport failures and surfaces tool errors", async () => {
    nextListToolsError = new Error("list failed");
    nextCallToolError = new Error("tool exploded");

    const { callMcpTool, discoverMcpTools } = await import("@/lib/mcp-client");
    const server = createHttpServer();

    await expect(discoverMcpTools(server)).resolves.toEqual([]);

    const result = await callMcpTool(server, "write_file", { path: "/tmp/a.txt" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("tool exploded");
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

  it("falls back to toolResult payloads and summarizes non-text content", async () => {
    nextCallToolResult = {
      toolResult: {
        ok: true
      }
    };

    const { callMcpTool, summarizeToolResult } = await import("@/lib/mcp-client");
    const result = await callMcpTool(createHttpServer(), "search_docs", { query: "MCP" });

    expect(result.content[0]?.text).toBe('{"ok":true}');
    expect(
      summarizeToolResult({
        content: [
          { type: "image", mimeType: "image/png" },
          { type: "audio", mimeType: "audio/mpeg" },
          { type: "resource_link", uri: "https://example.com" }
        ]
      })
    ).toContain("[image image/png]");
    expect(
      summarizeToolResult({
        content: [],
        structuredContent: { ok: true }
      })
    ).toBe('{"ok":true}');
    expect(
      summarizeToolResult({
        content: [],
        isError: true
      })
    ).toBe("Tool call failed.");
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
      buildMcpToolsDescription,
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
    const description = buildMcpToolsDescription([
      { server: httpServer, tools: httpTools },
      { server: stdioServer, tools: stdioTools }
    ]);

    expect(description).toContain("### Search docs | name=search_docs");
    expect(description).toContain("Mode: read-write");
    expect(description).toContain('Parameters: {"query":{"type":"string"}}');

    await disconnectMcpServer(httpServer);
    expect(httpTransportInstances[0].terminateSession).toHaveBeenCalledTimes(1);
    expect(httpTransportInstances[0].close).toHaveBeenCalledTimes(1);

    await shutdownAllProcesses();
    expect(stdioTransportInstances[0].close).toHaveBeenCalledTimes(1);
  });
});
