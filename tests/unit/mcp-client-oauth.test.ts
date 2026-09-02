const clientInstances: MockClient[] = [];
const stdioTransportInstances: MockStdioTransport[] = [];
const httpTransportInstances: MockStreamableHTTPTransport[] = [];

let nextConnectError: Error | null = null;
let replaceConnectErrorWithClosed = false;
let perHostConnectErrors = new Map<string, Error>();
let perHostTools = new Map<string, Array<unknown>>();

class MockClient {
  transport: unknown;

  connect = vi.fn(async (transport: unknown) => {
    this.transport = transport;
    const host = (transport as { url?: URL }).url?.hostname ?? "";
    const error = perHostConnectErrors.get(host) ?? nextConnectError;
    if (error) {
      if (replaceConnectErrorWithClosed) {
        (transport as { onerror?: (error: Error) => void }).onerror?.(error);
        throw new Error("MCP error -32000: Connection closed");
      }
      throw error;
    }
  });

  listTools = vi.fn(async () => {
    const host = (this.transport as { url?: URL } | undefined)?.url?.hostname ?? "";
    return { tools: perHostTools.get(host) ?? [] };
  });

  callTool = vi.fn(async () => ({ content: [] }));
  getServerVersion = vi.fn(() => ({ name: "Mock MCP Server", version: "1.0.0" }));

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
  setProtocolVersion = vi.fn();
  sessionId = "session_test";
  protocolVersion = "2025-03-26";
  url: URL;
  options: Record<string, unknown> | undefined;

  constructor(url: URL, options?: Record<string, unknown>) {
    this.url = url;
    this.options = options;
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

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {}
}));

const oauthState = vi.hoisted(() => ({
  connections: new Map<string, unknown>(),
  markExpired: vi.fn(),
  markAuthRequired: vi.fn(),
  markConnected: vi.fn(),
  providerInstances: [] as Array<{ serverId: string }>
}));

vi.mock("@/lib/mcp-oauth", () => ({
  McpAuthenticationRequiredError: class McpAuthenticationRequiredError extends Error {
    constructor(message = "auth required") {
      super(message);
      this.name = "McpAuthenticationRequiredError";
    }
  },
  MCP_AUTH_REQUIRED_MESSAGE: "requires authentication — reconnect it in Settings → MCP",
  McpOAuthProvider: class McpOAuthProvider {
    constructor(
      public readonly serverId: string,
      _serverUrl: string
    ) {
      oauthState.providerInstances.push(this);
    }
  },
  getMcpOAuthConnection: (serverId: string) => oauthState.connections.get(serverId) ?? null,
  markMcpOAuthConnectionExpired: (serverId: string) => oauthState.markExpired(serverId),
  markMcpOAuthConnectionAuthRequired: (serverId: string) => oauthState.markAuthRequired(serverId),
  markMcpOAuthConnectionConnected: (serverId: string) => oauthState.markConnected(serverId),
  deleteMcpOAuthConnection: vi.fn(),
  listMcpOAuthConnectionSummaries: vi.fn(() => ({})),
  getMcpOAuthConnectionSummary: vi.fn(() => null),
  checkMcpOAuthSupport: vi.fn(async () => true),
  startMcpOAuthFlow: vi.fn(),
  completeMcpOAuthCallback: vi.fn()
}));

const mcpClientModule = async () => import("@/lib/mcp-client");
const mcpOauthModule = async () => import("@/lib/mcp-oauth");
import type { McpServer } from "@/lib/types";

function createHttpServer(id: string, headers: Record<string, string> = {}): McpServer {
  return {
    id,
    name: `Server ${id}`,
    slug: id,
    url: `https://${id}.example.com/mcp`,
    headers,
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function staticHeaders(options: Record<string, unknown> | undefined) {
  return options?.requestInit as { headers?: Record<string, string> } | undefined;
}

describe("mcp client oauth integration", () => {
  let callMcpTool: Awaited<ReturnType<typeof mcpClientModule>>["callMcpTool"];
  let evictMcpClientsByServerId: Awaited<ReturnType<typeof mcpClientModule>>["evictMcpClientsByServerId"];
  let getConnectedClient: Awaited<ReturnType<typeof mcpClientModule>>["getConnectedClient"];
  let testMcpServerConnection: Awaited<ReturnType<typeof mcpClientModule>>["testMcpServerConnection"];
  let gatherAllMcpTools: Awaited<ReturnType<typeof mcpClientModule>>["gatherAllMcpTools"];
  let McpAuthenticationRequiredError: Awaited<ReturnType<typeof mcpOauthModule>>["McpAuthenticationRequiredError"];

  beforeAll(async () => {
    const mcpClient = await mcpClientModule();
    callMcpTool = mcpClient.callMcpTool;
    evictMcpClientsByServerId = mcpClient.evictMcpClientsByServerId;
    getConnectedClient = mcpClient.getConnectedClient;
    testMcpServerConnection = mcpClient.testMcpServerConnection;
    gatherAllMcpTools = mcpClient.gatherAllMcpTools;
    ({ McpAuthenticationRequiredError } = await mcpOauthModule());
  });

  beforeEach(() => {
    clientInstances.length = 0;
    httpTransportInstances.length = 0;
    stdioTransportInstances.length = 0;
    oauthState.connections.clear();
    oauthState.markExpired.mockClear();
    oauthState.markAuthRequired.mockClear();
    oauthState.markConnected.mockClear();
    oauthState.providerInstances.length = 0;
    nextConnectError = null;
    replaceConnectErrorWithClosed = false;
    perHostConnectErrors = new Map();
    perHostTools = new Map();
  });

  it("attaches an auth provider and strips the static Authorization header when connected", async () => {
    const server = createHttpServer("mcp_conn_1", {
      Authorization: "Bearer static-key",
      "X-Custom": "yes"
    });
    oauthState.connections.set(server.id, { accessToken: "token" });

    await getConnectedClient(server);

    expect(httpTransportInstances).toHaveLength(1);
    const options = httpTransportInstances[0].options;
    expect(options?.authProvider).toBeTruthy();
    expect(oauthState.providerInstances[0]?.serverId).toBe(server.id);
    expect(staticHeaders(options)?.headers).toEqual({ "X-Custom": "yes" });
  });

  it("keeps static headers untouched without an OAuth connection", async () => {
    const server = createHttpServer("mcp_plain_1", { Authorization: "Bearer static-key" });

    await getConnectedClient(server);

    expect(httpTransportInstances).toHaveLength(1);
    const options = httpTransportInstances[0].options;
    expect(options?.authProvider).toBeUndefined();
    expect(staticHeaders(options)?.headers).toEqual({ Authorization: "Bearer static-key" });
  });

  it("does not attach an auth provider for draft servers", async () => {
    const draft = { ...createHttpServer("draft"), id: "draft" };

    await getConnectedClient(draft as McpServer);

    expect(httpTransportInstances[0].options?.authProvider).toBeUndefined();
  });

  it("does not attach an auth provider for marker-only connections without tokens or registration", async () => {
    const server = createHttpServer("mcp_marker_only");
    oauthState.connections.set(server.id, { accessToken: null, clientId: null });

    await getConnectedClient(server);

    expect(httpTransportInstances[0].options?.authProvider).toBeUndefined();
    expect(oauthState.markConnected).toHaveBeenCalledWith(server.id);
  });

  it("marks tokenless connections auth-required on 401 instead of expired", async () => {
    const server = createHttpServer("mcp_marker_401");
    oauthState.connections.set(server.id, { accessToken: null, clientId: null });
    nextConnectError = new (class extends Error {
      code = 401;
    })("Error POSTing to endpoint (HTTP 401): Unauthorized");

    const result = await callMcpTool(server, "some_tool", {});

    expect(result.isError).toBe(true);
    expect(oauthState.markAuthRequired).toHaveBeenCalledWith(server.id);
    expect(oauthState.markExpired).not.toHaveBeenCalled();
  });

  it("maps 401 failures to an authentication-required error and marks the connection expired", async () => {
    const server = createHttpServer("mcp_conn_2");
    oauthState.connections.set(server.id, { accessToken: "token" });
    nextConnectError = new (class extends Error {
      code = 401;
    })("Error POSTing to endpoint (HTTP 401): Unauthorized");

    const result = await callMcpTool(server, "some_tool", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("requires authentication")
    });
    expect(oauthState.markExpired).toHaveBeenCalledWith(server.id);
  });

  it("maps 401 failures for servers without an OAuth connection but does not mark expiry", async () => {
    const server = createHttpServer("mcp_plain_2");
    nextConnectError = new (class extends Error {
      code = 401;
    })("Error POSTing to endpoint (HTTP 401): Unauthorized");

    const result = await callMcpTool(server, "some_tool", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("requires authentication")
    });
    expect(oauthState.markExpired).not.toHaveBeenCalled();
  });

  it("keeps non-auth failures unchanged", async () => {
    const server = createHttpServer("mcp_plain_3");
    nextConnectError = new Error("Connection refused");

    const result = await callMcpTool(server, "some_tool", {});

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "Connection refused"
    });
  });

  it("surfaces an authentication-required error from connection tests", async () => {
    const server = createHttpServer("mcp_conn_3");
    oauthState.connections.set(server.id, { accessToken: "token" });
    nextConnectError = new (class extends Error {
      code = 401;
    })("Error POSTing to endpoint (HTTP 401): Unauthorized");

    await expect(testMcpServerConnection(server)).rejects.toBeInstanceOf(
      McpAuthenticationRequiredError
    );
  });

  it("surfaces auth-required servers from tool discovery", async () => {
    perHostConnectErrors.set("mcp_discover_auth.example.com", new McpAuthenticationRequiredError());
    perHostTools.set("mcp_discover_ok.example.com", [
      { name: "do_thing", inputSchema: { type: "object" } }
    ]);

    const okServer = createHttpServer("mcp_discover_ok");
    const authServer = createHttpServer("mcp_discover_auth");

    const gathered = await gatherAllMcpTools([okServer, authServer]);

    expect(gathered).toHaveLength(2);
    expect(gathered.find((entry) => entry.server.id === okServer.id)).toMatchObject({
      tools: [expect.objectContaining({ name: "do_thing" })],
      authRequired: false
    });
    expect(gathered.find((entry) => entry.server.id === authServer.id)).toMatchObject({
      tools: [],
      authRequired: true
    });
  });

  it("maps the original transport error when connect fails with a generic connection-closed error", async () => {
    const server = createHttpServer("mcp_err_replaced");
    oauthState.connections.set(server.id, { accessToken: "token" });
    nextConnectError = new (class extends Error {
      code = 401;
    })("Error POSTing to endpoint (HTTP 401): Unauthorized");
    replaceConnectErrorWithClosed = true;

    await expect(getConnectedClient(server)).rejects.toThrow("requires authentication");
    expect(oauthState.markExpired).toHaveBeenCalledWith(server.id);

    replaceConnectErrorWithClosed = false;
    const gathered = await gatherAllMcpTools([server]);
    expect(gathered[0]).toMatchObject({ authRequired: true, tools: [] });
  });

  it("evicts cached clients by server id", async () => {
    const server = createHttpServer("mcp_conn_4");
    oauthState.connections.set(server.id, { accessToken: "token" });

    await getConnectedClient(server);
    expect(httpTransportInstances).toHaveLength(1);
    await getConnectedClient(server);
    expect(httpTransportInstances).toHaveLength(1);

    evictMcpClientsByServerId(server.id);
    await getConnectedClient(server);
    expect(httpTransportInstances).toHaveLength(2);
    expect(oauthState.providerInstances).toHaveLength(2);
  });
});
