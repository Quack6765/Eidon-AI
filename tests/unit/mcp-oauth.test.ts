import { getDb } from "@/lib/db";
import {
  completeMcpOAuthCallback,
  deleteMcpOAuthConnection,
  getMcpOAuthConnection,
  getMcpOAuthConnectionSummary,
  listMcpOAuthConnectionSummaries,
  markMcpOAuthConnectionAuthRequired,
  markMcpOAuthConnectionConnected,
  markMcpOAuthConnectionExpired,
  McpAuthenticationRequiredError,
  McpOAuthProvider,
  startMcpOAuthFlow
} from "@/lib/mcp-oauth";
import { createMcpServer } from "@/lib/mcp-servers";
import { createLocalUser } from "@/lib/users";

const authSdk = vi.hoisted(() => ({
  discoverOAuthServerInfo: vi.fn(),
  discoverAuthorizationServerMetadata: vi.fn(),
  registerClient: vi.fn(),
  startAuthorization: vi.fn(),
  exchangeAuthorization: vi.fn(),
  selectResourceURL: vi.fn()
}));

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => authSdk);

beforeEach(() => {
  vi.clearAllMocks();
});

const AUTHORIZATION_SERVER_URL = "https://as.example.com";
const SERVER_URL = "https://mcp.example.com/mcp";

async function seedServer() {
  return createMcpServer({ name: `OAuth Server ${Math.floor(Math.random() * 1e9)}`, url: SERVER_URL });
}

async function seedAdmin() {
  return createLocalUser({
    username: `oauth-admin-${Math.floor(Math.random() * 1e9)}@example.com`,
    password: "Password123!",
    role: "admin"
  });
}

function mockDiscovery(options: { withRegistrationEndpoint?: boolean } = {}) {
  authSdk.discoverOAuthServerInfo.mockResolvedValue({
    authorizationServerUrl: AUTHORIZATION_SERVER_URL,
    authorizationServerMetadata: {
      issuer: AUTHORIZATION_SERVER_URL,
      authorization_endpoint: `${AUTHORIZATION_SERVER_URL}/authorize`,
      token_endpoint: `${AUTHORIZATION_SERVER_URL}/token`,
      ...(options.withRegistrationEndpoint === false
        ? {}
        : { registration_endpoint: `${AUTHORIZATION_SERVER_URL}/register` })
    },
    resourceMetadata: undefined
  });
}

describe("mcp oauth connection store", () => {
  it("round-trips client information and tokens encrypted at rest", async () => {
    const server = await seedServer();
    const provider = new McpOAuthProvider(server.id, server.url);

    await provider.saveClientInformation({ client_id: "client_a", client_secret: "secret_a" });

    const storedRow = getDb()
      .prepare("SELECT credentials_encrypted FROM mcp_server_connections WHERE server_id = ?")
      .get(server.id) as { credentials_encrypted: string };
    expect(storedRow.credentials_encrypted).not.toContain("client_a");
    expect(storedRow.credentials_encrypted).not.toContain("secret_a");

    const connection = getMcpOAuthConnection(server.id);
    expect(connection?.clientId).toBe("client_a");
    expect(connection?.clientSecret).toBe("secret_a");
    expect(await provider.clientInformation()).toEqual({
      client_id: "client_a",
      client_secret: "secret_a"
    });

    await provider.saveTokens({
      access_token: "token_1",
      token_type: "Bearer",
      refresh_token: "refresh_1",
      expires_in: 3600,
      scope: "mcp"
    });

    const after = getMcpOAuthConnection(server.id);
    expect(after?.accessToken).toBe("token_1");
    expect(after?.refreshToken).toBe("refresh_1");
    expect(after?.status).toBe("connected");
    expect(after?.expiresAt).toBeTruthy();
    expect(await provider.tokens()).toMatchObject({
      access_token: "token_1",
      refresh_token: "refresh_1"
    });

    expect(getMcpOAuthConnectionSummary(server.id)).toMatchObject({
      status: "connected",
      scope: "mcp"
    });
    expect(listMcpOAuthConnectionSummaries()[server.id]).toMatchObject({
      status: "connected"
    });
  });

  it("marks connections expired and deletes them", async () => {
    const server = await seedServer();
    const provider = new McpOAuthProvider(server.id, server.url);
    await provider.saveClientInformation({ client_id: "client_b" });
    await provider.saveTokens({ access_token: "token_2", token_type: "Bearer" });

    markMcpOAuthConnectionExpired(server.id);
    expect(getMcpOAuthConnection(server.id)?.status).toBe("expired");
    expect(getMcpOAuthConnectionSummary(server.id)?.status).toBe("expired");

    deleteMcpOAuthConnection(server.id);
    expect(getMcpOAuthConnection(server.id)).toBeNull();
    expect(getMcpOAuthConnectionSummary(server.id)).toBeNull();
  });

  it("resolves tokenless rows as auth-required and self-heals them", async () => {
    const server = await seedServer();
    const provider = new McpOAuthProvider(server.id, server.url);
    await provider.saveClientInformation({ client_id: "client_e" });

    expect(getMcpOAuthConnection(server.id)?.status).toBe("auth_required");

    markMcpOAuthConnectionAuthRequired(server.id);
    expect(getMcpOAuthConnection(server.id)?.status).toBe("auth_required");
    expect(getMcpOAuthConnection(server.id)?.clientId).toBe("client_e");

    markMcpOAuthConnectionConnected(server.id);
    expect(getMcpOAuthConnection(server.id)).toBeNull();

    markMcpOAuthConnectionAuthRequired(server.id, { createIfMissing: true });
    expect(getMcpOAuthConnectionSummary(server.id)).toEqual({
      status: "auth_required",
      expiresAt: null,
      scope: null
    });

    await provider.saveTokens({ access_token: "token_5", token_type: "Bearer" });
    markMcpOAuthConnectionExpired(server.id);
    expect(getMcpOAuthConnection(server.id)?.status).toBe("expired");
    markMcpOAuthConnectionConnected(server.id);
    expect(getMcpOAuthConnection(server.id)?.status).toBe("connected");
  });

  it("keeps a stable code verifier and redirects throw an auth-required error", async () => {
    const server = await seedServer();
    const provider = new McpOAuthProvider(server.id, server.url);
    await provider.saveClientInformation({ client_id: "client_c" });

    await provider.saveCodeVerifier("verifier_abc");
    expect(await provider.codeVerifier()).toBe("verifier_abc");

    await expect(provider.redirectToAuthorization(new URL("https://as.example.com/authorize"))).rejects.toBeInstanceOf(
      McpAuthenticationRequiredError
    );

    const storedRow = getDb()
      .prepare("SELECT credentials_encrypted FROM mcp_server_connections WHERE server_id = ?")
      .get(server.id) as { credentials_encrypted: string };
    expect(storedRow.credentials_encrypted).not.toContain("verifier_abc");
  });

  it("persists discovery state and invalidates credentials by scope", async () => {
    const server = await seedServer();
    const provider = new McpOAuthProvider(server.id, server.url);
    await provider.saveClientInformation({ client_id: "client_d" });
    await provider.saveTokens({ access_token: "token_3", token_type: "Bearer", refresh_token: "refresh_3" });

    const discoveryState = {
      authorizationServerUrl: AUTHORIZATION_SERVER_URL,
      authorizationServerMetadata: {
        issuer: AUTHORIZATION_SERVER_URL,
        authorization_endpoint: `${AUTHORIZATION_SERVER_URL}/authorize`,
        token_endpoint: `${AUTHORIZATION_SERVER_URL}/token`
      }
    };
    await provider.saveDiscoveryState(
      discoveryState as unknown as Parameters<typeof provider.saveDiscoveryState>[0]
    );
    expect(await provider.discoveryState()).toMatchObject({
      authorizationServerUrl: AUTHORIZATION_SERVER_URL
    });

    await provider.invalidateCredentials("discovery");
    expect((await provider.discoveryState())?.authorizationServerMetadata).toBeUndefined();

    await provider.invalidateCredentials("tokens");
    const connection = getMcpOAuthConnection(server.id);
    expect(connection?.accessToken).toBeNull();
    expect(connection?.refreshToken).toBeNull();
    expect(connection?.clientId).toBe("client_d");

    await provider.invalidateCredentials("client");
    expect(getMcpOAuthConnection(server.id)?.clientId).toBeNull();

    await provider.saveClientInformation({ client_id: "client_d" });
    await provider.invalidateCredentials("all");
    expect(getMcpOAuthConnection(server.id)).toBeNull();
  });
});

describe("startMcpOAuthFlow", () => {
  it("discovers, registers, and returns an authorization url with a pending flow", async () => {
    const server = await seedServer();
    const admin = await seedAdmin();
    mockDiscovery();
    authSdk.selectResourceURL.mockResolvedValue(new URL(SERVER_URL));
    authSdk.registerClient.mockResolvedValue({ client_id: "client_reg", client_secret: "secret_reg" });
    authSdk.startAuthorization.mockImplementation(
      async (_asUrl: unknown, opts: { state?: string }) => ({
        authorizationUrl: new URL(`${AUTHORIZATION_SERVER_URL}/authorize?state=${opts.state}`),
        codeVerifier: "verifier_flow"
      })
    );

    const flow = await startMcpOAuthFlow({
      serverId: server.id,
      serverUrl: server.url,
      userId: admin.id,
      redirectUri: "https://eidon.example.com/api/mcp-servers/oauth/callback",
      clientUri: "https://eidon.example.com",
      logoUri: "https://eidon.example.com/agent-icon.png"
    });

    expect(flow.authorizationUrl).toContain(`${AUTHORIZATION_SERVER_URL}/authorize?state=`);
    expect(authSdk.registerClient).toHaveBeenCalledTimes(1);
    expect(authSdk.registerClient).toHaveBeenCalledWith(
      AUTHORIZATION_SERVER_URL,
      expect.objectContaining({
        clientMetadata: expect.objectContaining({
          client_name: "Eidon",
          logo_uri: "https://eidon.example.com/agent-icon.png",
          client_uri: "https://eidon.example.com",
          redirect_uris: ["https://eidon.example.com/api/mcp-servers/oauth/callback"]
        })
      })
    );
    expect(authSdk.startAuthorization).toHaveBeenCalledTimes(1);

    const storedClient = getMcpOAuthConnection(server.id);
    expect(storedClient?.clientId).toBe("client_reg");

    const flowRow = getDb()
      .prepare("SELECT payload_encrypted, status FROM mcp_oauth_flows WHERE id = ?")
      .get(flow.flowId.split("?")[0]) as { payload_encrypted: string; status: string } | undefined;
    const flowIdFromUrl = new URL(flow.authorizationUrl).searchParams.get("state");
    expect(flowIdFromUrl).toBeTruthy();

    const row = getDb()
      .prepare("SELECT payload_encrypted, status FROM mcp_oauth_flows ORDER BY created_at DESC LIMIT 1")
      .get() as { payload_encrypted: string; status: string };
    expect(row.status).toBe("pending");
    expect(row.payload_encrypted).not.toContain("verifier_flow");
    expect(flowRow ?? row).toBeTruthy();
  });

  it("omits branding urls that are not HTTPS so localhost registrations succeed", async () => {
    const server = await seedServer();
    const admin = await seedAdmin();
    mockDiscovery();
    authSdk.selectResourceURL.mockResolvedValue(undefined);
    authSdk.registerClient.mockResolvedValue({ client_id: "client_local" });
    authSdk.startAuthorization.mockResolvedValue({
      authorizationUrl: new URL(`${AUTHORIZATION_SERVER_URL}/authorize`),
      codeVerifier: "verifier_local"
    });

    await startMcpOAuthFlow({
      serverId: server.id,
      serverUrl: server.url,
      userId: admin.id,
      redirectUri: "http://localhost:3000/api/mcp-servers/oauth/callback",
      clientUri: "http://localhost:3000",
      logoUri: "http://localhost:3000/agent-icon.png"
    });

    const metadata = authSdk.registerClient.mock.calls[0][1].clientMetadata;
    expect(metadata).not.toHaveProperty("logo_uri");
    expect(metadata).not.toHaveProperty("client_uri");
    expect(metadata.client_name).toBe("Eidon");
  });

  it("reuses stored client information instead of re-registering", async () => {
    const server = await seedServer();
    const admin = await seedAdmin();
    const provider = new McpOAuthProvider(server.id, server.url);
    await provider.saveClientInformation({ client_id: "client_stored" });

    mockDiscovery();
    authSdk.selectResourceURL.mockResolvedValue(undefined);
    authSdk.startAuthorization.mockResolvedValue({
      authorizationUrl: new URL(`${AUTHORIZATION_SERVER_URL}/authorize`),
      codeVerifier: "verifier_2"
    });

    await startMcpOAuthFlow({
      serverId: server.id,
      serverUrl: server.url,
      userId: admin.id,
      redirectUri: "https://eidon.example.com/api/mcp-servers/oauth/callback"
    });

    expect(authSdk.registerClient).not.toHaveBeenCalled();
  });

  it("fails clearly without authorization server metadata", async () => {
    const server = await seedServer();
    const admin = await seedAdmin();
    authSdk.discoverOAuthServerInfo.mockResolvedValue({
      authorizationServerUrl: server.url,
      authorizationServerMetadata: undefined,
      resourceMetadata: undefined
    });

    await expect(
      startMcpOAuthFlow({
        serverId: server.id,
        serverUrl: server.url,
        userId: admin.id,
        redirectUri: "https://eidon.example.com/api/mcp-servers/oauth/callback"
      })
    ).rejects.toThrow("does not advertise OAuth");
  });

  it("fails clearly when dynamic client registration is unavailable", async () => {
    const server = await seedServer();
    const admin = await seedAdmin();
    mockDiscovery({ withRegistrationEndpoint: false });

    await expect(
      startMcpOAuthFlow({
        serverId: server.id,
        serverUrl: server.url,
        userId: admin.id,
        redirectUri: "https://eidon.example.com/api/mcp-servers/oauth/callback"
      })
    ).rejects.toThrow("dynamic client registration");
  });
});

describe("completeMcpOAuthCallback", () => {
  async function startFlow() {
    const server = await seedServer();
    const admin = await seedAdmin();
    mockDiscovery();
    authSdk.selectResourceURL.mockResolvedValue(new URL(SERVER_URL));
    authSdk.registerClient.mockResolvedValue({ client_id: "client_cb", client_secret: "secret_cb" });
    authSdk.startAuthorization.mockImplementation(
      async (_asUrl: unknown, opts: { state?: string }) => ({
        authorizationUrl: new URL(`${AUTHORIZATION_SERVER_URL}/authorize?state=${opts.state}`),
        codeVerifier: "verifier_cb"
      })
    );
    const flow = await startMcpOAuthFlow({
      serverId: server.id,
      serverUrl: server.url,
      userId: admin.id,
      redirectUri: "https://eidon.example.com/api/mcp-servers/oauth/callback"
    });
    const state = new URL(flow.authorizationUrl).searchParams.get("state");
    return { server, admin, flow, state };
  }

  function callbackRequest(params: Record<string, string>) {
    const search = new URLSearchParams(params);
    return new Request(`https://eidon.example.com/api/mcp-servers/oauth/callback?${search}`);
  }

  it("exchanges the code and stores tokens", async () => {
    const { server, flow, state } = await startFlow();
    authSdk.discoverAuthorizationServerMetadata.mockResolvedValue({
      issuer: AUTHORIZATION_SERVER_URL,
      authorization_endpoint: `${AUTHORIZATION_SERVER_URL}/authorize`,
      token_endpoint: `${AUTHORIZATION_SERVER_URL}/token`
    });
    authSdk.exchangeAuthorization.mockResolvedValue({
      access_token: "callback_token",
      token_type: "Bearer",
      refresh_token: "callback_refresh",
      expires_in: 1800,
      scope: "mcp:read"
    });

    const result = await completeMcpOAuthCallback(callbackRequest({ code: "auth_code_1", state: state! }));
    expect(result).toEqual({ status: "success", serverId: server.id });

    const connection = getMcpOAuthConnection(server.id);
    expect(connection?.accessToken).toBe("callback_token");
    expect(connection?.refreshToken).toBe("callback_refresh");
    expect(connection?.status).toBe("connected");
    expect(connection?.redirectUri).toBe("https://eidon.example.com/api/mcp-servers/oauth/callback");

    const flowRow = getDb()
      .prepare("SELECT status FROM mcp_oauth_flows WHERE id = ?")
      .get(flow.flowId) as { status: string };
    expect(flowRow.status).toBe("succeeded");
  });

  it("rejects replayed state tokens", async () => {
    const { state } = await startFlow();
    authSdk.discoverAuthorizationServerMetadata.mockResolvedValue({
      issuer: AUTHORIZATION_SERVER_URL,
      token_endpoint: `${AUTHORIZATION_SERVER_URL}/token`
    });
    authSdk.exchangeAuthorization.mockResolvedValue({
      access_token: "x",
      token_type: "Bearer"
    });

    const first = await completeMcpOAuthCallback(callbackRequest({ code: "code_once", state: state! }));
    expect(first.status).toBe("success");

    const second = await completeMcpOAuthCallback(callbackRequest({ code: "code_once", state: state! }));
    expect(second.status).toBe("failure");
  });

  it("reports failure for provider errors and missing codes", async () => {
    const { server, state } = await startFlow();
    const denied = await completeMcpOAuthCallback(
      callbackRequest({ error: "access_denied", state: state! })
    );
    expect(denied).toEqual({ status: "failure", serverId: server.id });

    const { state: state2 } = await startFlow();
    authSdk.discoverAuthorizationServerMetadata.mockResolvedValue({
      token_endpoint: `${AUTHORIZATION_SERVER_URL}/token`
    });
    authSdk.exchangeAuthorization.mockRejectedValue(new Error("exchange blew up"));
    const failed = await completeMcpOAuthCallback(callbackRequest({ code: "bad", state: state2! }));
    expect(failed.status).toBe("failure");
  });

  it("reports invalid state without a token", async () => {
    const missing = await completeMcpOAuthCallback(callbackRequest({ code: "x" }));
    expect(missing.status).toBe("invalid_state");

    const tampered = await completeMcpOAuthCallback(
      callbackRequest({ code: "x", state: "not-a-jwt" })
    );
    expect(tampered.status).toBe("invalid_state");
  });
});
