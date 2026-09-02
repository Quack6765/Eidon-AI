const mocks = vi.hoisted(() => ({
  requireAdminResponse: vi.fn(),
  startMcpOAuthFlow: vi.fn(),
  completeMcpOAuthCallback: vi.fn(),
  checkMcpOAuthSupport: vi.fn(),
  deleteMcpOAuthConnection: vi.fn(),
  markMcpOAuthConnectionConnected: vi.fn(),
  markMcpOAuthConnectionAuthRequired: vi.fn(),
  getMcpOAuthConnectionSummary: vi.fn(),
  listMcpOAuthConnectionSummaries: vi.fn(() => ({})),
  testMcpServerConnection: vi.fn(),
  evictMcpClientsByServerId: vi.fn(),
  getConnectedClient: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAdminResponse: mocks.requireAdminResponse
}));

vi.mock("@/lib/mcp-oauth", () => ({
  McpAuthenticationRequiredError: class McpAuthenticationRequiredError extends Error {},
  McpOAuthProvider: class {},
  MCP_AUTH_REQUIRED_MESSAGE: "requires authentication",
  startMcpOAuthFlow: mocks.startMcpOAuthFlow,
  completeMcpOAuthCallback: mocks.completeMcpOAuthCallback,
  checkMcpOAuthSupport: mocks.checkMcpOAuthSupport,
  deleteMcpOAuthConnection: mocks.deleteMcpOAuthConnection,
  markMcpOAuthConnectionConnected: mocks.markMcpOAuthConnectionConnected,
  markMcpOAuthConnectionAuthRequired: mocks.markMcpOAuthConnectionAuthRequired,
  getMcpOAuthConnectionSummary: mocks.getMcpOAuthConnectionSummary,
  listMcpOAuthConnectionSummaries: mocks.listMcpOAuthConnectionSummaries
}));

vi.mock("@/lib/mcp-client", () => ({
  testMcpServerConnection: mocks.testMcpServerConnection,
  evictMcpClientsByServerId: mocks.evictMcpClientsByServerId,
  getConnectedClient: mocks.getConnectedClient,
  disconnectMcpServer: vi.fn()
}));

import { GET as oauthCallbackRoute } from "@/app/api/mcp-servers/oauth/callback/route";
import { DELETE as oauthDisconnectRoute } from "@/app/api/mcp-servers/[serverId]/oauth/route";
import { POST as oauthFlowRoute } from "@/app/api/mcp-servers/[serverId]/oauth/flows/route";
import { POST as testRoute } from "@/app/api/mcp-servers/test/route";
import { createMcpServer } from "@/lib/mcp-servers";
import { McpAuthenticationRequiredError } from "@/lib/mcp-oauth";

const ADMIN = { id: "user_admin_1", username: "admin", role: "admin" };

async function seedHttpServer() {
  return createMcpServer({ name: `Route ${Math.floor(Math.random() * 1e9)}`, url: "https://mcp.example.com/mcp" });
}

function routeContext(serverId: string) {
  return { params: Promise.resolve({ serverId }) };
}

describe("mcp oauth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminResponse.mockResolvedValue(ADMIN);
    mocks.getMcpOAuthConnectionSummary.mockReturnValue(null);
  });

  describe("POST /api/mcp-servers/[serverId]/oauth/flows", () => {
    it("starts a flow and returns the authorization url", async () => {
      const server = await seedHttpServer();
      mocks.startMcpOAuthFlow.mockResolvedValue({
        flowId: "flow_1",
        authorizationUrl: "https://as.example.com/authorize?state=x",
        expiresAt: "2026-01-01T00:10:00.000Z"
      });

      const request = new Request("http://eidon.test/api/mcp-servers/x", { method: "POST" });
      const response = await oauthFlowRoute(request, routeContext(server.id));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.authorizationUrl).toBe("https://as.example.com/authorize?state=x");
      expect(mocks.startMcpOAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          serverId: server.id,
          serverUrl: server.url,
          userId: ADMIN.id,
          redirectUri: "http://eidon.test/api/mcp-servers/oauth/callback",
          clientUri: "http://eidon.test",
          logoUri: "http://eidon.test/agent-icon.png"
        })
      );
    });

    it("rejects stdio servers and unknown servers", async () => {
      const stdio = createMcpServer({
        name: `Stdio ${Math.floor(Math.random() * 1e9)}`,
        transport: "stdio",
        command: "npx"
      });
      const stdioResponse = await oauthFlowRoute(
        new Request("http://eidon.test", { method: "POST" }),
        routeContext(stdio.id)
      );
      expect(stdioResponse.status).toBe(400);

      const missingResponse = await oauthFlowRoute(
        new Request("http://eidon.test", { method: "POST" }),
        routeContext("mcp_missing")
      );
      expect(missingResponse.status).toBe(404);
      expect(mocks.startMcpOAuthFlow).not.toHaveBeenCalled();
    });

    it("surfaces flow start failures as 502", async () => {
      const server = await seedHttpServer();
      mocks.startMcpOAuthFlow.mockRejectedValue(
        new Error("This MCP server does not advertise OAuth authorization server metadata")
      );

      const response = await oauthFlowRoute(
        new Request("http://eidon.test", { method: "POST" }),
        routeContext(server.id)
      );
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toContain("does not advertise OAuth");
    });
  });

  describe("GET /api/mcp-servers/oauth/callback", () => {
    it("redirects back to settings on success and evicts the cached client", async () => {
      mocks.completeMcpOAuthCallback.mockResolvedValue({
        status: "success",
        serverId: "mcp_server_9"
      });

      const response = await oauthCallbackRoute(
        new Request("http://eidon.test/api/mcp-servers/oauth/callback?code=a&state=b")
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        "http://eidon.test/settings/mcp-servers?connection=success&server=mcp_server_9"
      );
      expect(mocks.evictMcpClientsByServerId).toHaveBeenCalledWith("mcp_server_9");
    });

    it("redirects with failure without evicting", async () => {
      mocks.completeMcpOAuthCallback.mockResolvedValue({
        status: "failure",
        serverId: "mcp_server_9"
      });

      const response = await oauthCallbackRoute(
        new Request("http://eidon.test/api/mcp-servers/oauth/callback?code=a&state=b")
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("connection=failure");
      expect(mocks.evictMcpClientsByServerId).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid state", async () => {
      mocks.completeMcpOAuthCallback.mockResolvedValue({
        status: "invalid_state",
        serverId: null
      });

      const response = await oauthCallbackRoute(
        new Request("http://eidon.test/api/mcp-servers/oauth/callback?code=a")
      );

      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /api/mcp-servers/[serverId]/oauth", () => {
    it("drops the stored connection and evicts the cached client", async () => {
      const server = await seedHttpServer();

      const response = await oauthDisconnectRoute(
        new Request("http://eidon.test", { method: "DELETE" }),
        routeContext(server.id)
      );

      expect(response.status).toBe(200);
      expect(mocks.deleteMcpOAuthConnection).toHaveBeenCalledWith(server.id);
      expect(mocks.evictMcpClientsByServerId).toHaveBeenCalledWith(server.id);
    });

    it("404s for unknown servers", async () => {
      const response = await oauthDisconnectRoute(
        new Request("http://eidon.test", { method: "DELETE" }),
        routeContext("mcp_missing")
      );
      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/mcp-servers/test requiresAuth detection", () => {
    it("marks a stored server connected and returns its oauth summary on success", async () => {
      const server = await seedHttpServer();
      const oauthSummary = { status: "connected" as const, expiresAt: "2026-06-01T00:00:00.000Z", scope: "mcp" };
      mocks.testMcpServerConnection.mockResolvedValue({
        protocolVersion: "2025-03-26",
        serverInfo: null,
        sessionId: null,
        toolCount: 3,
        tools: [],
        stderr: undefined
      });
      mocks.getMcpOAuthConnectionSummary.mockReturnValue(oauthSummary);

      const response = await testRoute(
        new Request("http://eidon.test/api/mcp-servers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: server.id })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.oauth).toEqual(oauthSummary);
      expect(mocks.markMcpOAuthConnectionConnected).toHaveBeenCalledWith(server.id);
    });

    it("tests drafts against the stored server identity when the url matches", async () => {
      const server = await seedHttpServer();
      mocks.testMcpServerConnection.mockResolvedValue({
        protocolVersion: "2025-03-26",
        serverInfo: null,
        sessionId: null,
        toolCount: 0,
        tools: [],
        stderr: undefined
      });

      const matchingResponse = await testRoute(
        new Request("http://eidon.test/api/mcp-servers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serverId: server.id,
            draft: {
              transport: "streamable_http",
              name: server.name,
              url: server.url,
              headersAction: "preserve"
            }
          })
        })
      );
      expect(matchingResponse.status).toBe(200);
      expect(mocks.testMcpServerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: server.id })
      );

      mocks.testMcpServerConnection.mockClear();
      const changedUrlResponse = await testRoute(
        new Request("http://eidon.test/api/mcp-servers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serverId: server.id,
            draft: {
              transport: "streamable_http",
              name: server.name,
              url: "https://elsewhere.example.com/mcp"
            }
          })
        })
      );
      expect(changedUrlResponse.status).toBe(200);
      expect(mocks.testMcpServerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ id: "draft" })
      );
    });

    it("returns requiresAuth when the server 401s and supports OAuth", async () => {
      const server = await seedHttpServer();
      mocks.testMcpServerConnection.mockRejectedValue(
        new McpAuthenticationRequiredError('"Server" requires authentication')
      );
      mocks.checkMcpOAuthSupport.mockResolvedValue(true);
      const oauthSummary = { status: "auth_required" as const, expiresAt: null, scope: null };
      mocks.getMcpOAuthConnectionSummary.mockReturnValue(oauthSummary);

      const response = await testRoute(
        new Request("http://eidon.test/api/mcp-servers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: server.id })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ success: false, requiresAuth: true });
      expect(body.oauth).toEqual(oauthSummary);
      expect(mocks.markMcpOAuthConnectionAuthRequired).toHaveBeenCalledWith(server.id, {
        createIfMissing: true
      });
    });

    it("falls back to a 502 error when OAuth is not supported", async () => {
      const server = await seedHttpServer();
      mocks.testMcpServerConnection.mockRejectedValue(
        new McpAuthenticationRequiredError('"Server" requires authentication')
      );
      mocks.checkMcpOAuthSupport.mockResolvedValue(false);

      const response = await testRoute(
        new Request("http://eidon.test/api/mcp-servers/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverId: server.id })
        })
      );

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toContain("requires authentication");
    });
  });
});
