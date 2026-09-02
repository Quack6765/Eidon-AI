import { createHash } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient,
  selectResourceURL,
  startAuthorization,
  type OAuthClientProvider,
  type OAuthDiscoveryState
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { getDb } from "@/lib/db";
import { decryptValue, encryptValue } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";

const mcpOauthStateUse = "mcp_oauth_state";
const mcpOauthStateAudience = "eidon-mcp-oauth";
const MCP_OAUTH_FLOW_DURATION_MS = 10 * 60 * 1000;
const MCP_OAUTH_HTTP_TIMEOUT_MS = 15_000;
const MCP_CLIENT_NAME = "Eidon";

export const MCP_AUTH_REQUIRED_MESSAGE =
  "requires authentication — reconnect it in Settings → MCP";

export class McpAuthenticationRequiredError extends Error {
  constructor(message = `This MCP server ${MCP_AUTH_REQUIRED_MESSAGE}`) {
    super(message);
    this.name = "McpAuthenticationRequiredError";
  }
}

type McpConnectionRow = {
  server_id: string;
  credentials_encrypted: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type McpConnectionCredentials = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  codeVerifier?: string;
};

type McpConnectionMetadata = {
  status?: "connected" | "expired" | "auth_required";
  expiresAt?: string;
  scope?: string;
  authorizationServerUrl?: string;
  redirectUri?: string;
  discovery?: OAuthDiscoveryState;
};

type McpOauthFlowPayload = {
  codeVerifier: string;
  redirectUri: string;
  authorizationServerUrl: string;
  resource?: string;
  clientId: string;
  clientSecret?: string;
};

export type McpOAuthStatus = "connected" | "expired" | "auth_required";

export type McpOAuthConnectionSummary = {
  status: McpOAuthStatus;
  expiresAt: string | null;
  scope: string | null;
};

function oauthFetch(url: string | URL, init?: RequestInit) {
  return globalThis.fetch(url, {
    ...init,
    signal: AbortSignal.timeout(MCP_OAUTH_HTTP_TIMEOUT_MS)
  });
}

function readConnectionRow(serverId: string): McpConnectionRow | undefined {
  return getDb()
    .prepare(
      `SELECT server_id, credentials_encrypted, metadata_json, created_at, updated_at
       FROM mcp_server_connections
       WHERE server_id = ?`
    )
    .get(serverId) as McpConnectionRow | undefined;
}

function writeConnectionRow(
  serverId: string,
  credentials: McpConnectionCredentials,
  metadata: McpConnectionMetadata
) {
  const timestamp = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO mcp_server_connections (server_id, credentials_encrypted, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         credentials_encrypted = excluded.credentials_encrypted,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`
    )
    .run(
      serverId,
      encryptValue(JSON.stringify(credentials)),
      JSON.stringify(metadata),
      timestamp,
      timestamp
    );
}

function parseConnection(row: McpConnectionRow): {
  credentials: McpConnectionCredentials;
  metadata: McpConnectionMetadata;
} {
  let credentials: McpConnectionCredentials = {};
  try {
    credentials = JSON.parse(decryptValue(row.credentials_encrypted)) as McpConnectionCredentials;
  } catch {
    credentials = {};
  }
  let metadata: McpConnectionMetadata = {};
  try {
    metadata = JSON.parse(row.metadata_json) as McpConnectionMetadata;
  } catch {
    metadata = {};
  }
  return { credentials, metadata };
}

export function getMcpOAuthConnection(serverId: string) {
  const row = readConnectionRow(serverId);
  if (!row) return null;
  const { credentials, metadata } = parseConnection(row);
  const status: McpOAuthStatus =
    metadata.status === "auth_required" || metadata.status === "expired"
      ? metadata.status
      : credentials.accessToken
        ? "connected"
        : "auth_required";
  return {
    serverId,
    status,
    accessToken: credentials.accessToken ?? null,
    refreshToken: credentials.refreshToken ?? null,
    tokenType: credentials.tokenType ?? null,
    scope: credentials.scope ?? metadata.scope ?? null,
    expiresAt: metadata.expiresAt ?? null,
    clientId: credentials.clientId ?? null,
    clientSecret: credentials.clientSecret ?? null,
    authorizationServerUrl: metadata.authorizationServerUrl ?? null,
    redirectUri: metadata.redirectUri ?? null,
    discovery: metadata.discovery ?? null
  };
}

export type McpOAuthConnection = ReturnType<typeof getMcpOAuthConnection>;

export function getMcpOAuthConnectionSummary(serverId: string): McpOAuthConnectionSummary | null {
  const connection = getMcpOAuthConnection(serverId);
  if (!connection) return null;
  return {
    status: connection.status,
    expiresAt: connection.expiresAt,
    scope: connection.scope
  };
}

export function listMcpOAuthConnectionSummaries(): Record<string, McpOAuthConnectionSummary> {
  const rows = getDb()
    .prepare("SELECT server_id FROM mcp_server_connections")
    .all() as Array<{ server_id: string }>;
  const summaries: Record<string, McpOAuthConnectionSummary> = {};
  for (const row of rows) {
    const summary = getMcpOAuthConnectionSummary(row.server_id);
    if (summary) {
      summaries[row.server_id] = summary;
    }
  }
  return summaries;
}

function saveMcpOAuthClientInformation(
  serverId: string,
  clientInformation: OAuthClientInformationMixed,
  metadataUpdates?: Partial<McpConnectionMetadata>
) {
  const row = readConnectionRow(serverId);
  const { credentials, metadata } = row ? parseConnection(row) : { credentials: {}, metadata: {} };
  writeConnectionRow(
    serverId,
    {
      ...credentials,
      clientId: clientInformation.client_id,
      clientSecret: clientInformation.client_secret ?? undefined
    },
    { ...metadata, ...metadataUpdates }
  );
}

function saveMcpOAuthTokens(
  serverId: string,
  tokens: OAuthTokens,
  metadataUpdates?: Partial<McpConnectionMetadata>
) {
  const row = readConnectionRow(serverId);
  const { credentials, metadata } = row ? parseConnection(row) : { credentials: {}, metadata: {} };
  writeConnectionRow(
    serverId,
    {
      ...credentials,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? credentials.refreshToken,
      tokenType: tokens.token_type,
      scope: tokens.scope ?? credentials.scope
    },
    {
      ...metadata,
      ...metadataUpdates,
      status: "connected",
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : undefined,
      scope: tokens.scope ?? metadata.scope
    }
  );
}

export function markMcpOAuthConnectionExpired(serverId: string) {
  const row = readConnectionRow(serverId);
  if (!row) return;
  const { credentials, metadata } = parseConnection(row);
  if (metadata.status === "expired") return;
  writeConnectionRow(serverId, credentials, { ...metadata, status: "expired" });
}

export function markMcpOAuthConnectionAuthRequired(
  serverId: string,
  options?: { createIfMissing?: boolean }
) {
  const row = readConnectionRow(serverId);
  if (!row) {
    if (!options?.createIfMissing) return;
    writeConnectionRow(serverId, {}, { status: "auth_required" });
    return;
  }
  const { credentials, metadata } = parseConnection(row);
  if (metadata.status === "auth_required") return;
  writeConnectionRow(serverId, credentials, { ...metadata, status: "auth_required" });
}

export function markMcpOAuthConnectionConnected(serverId: string) {
  const row = readConnectionRow(serverId);
  if (!row) return;
  const { credentials, metadata } = parseConnection(row);
  if (!credentials.accessToken) {
    deleteMcpOAuthConnection(serverId);
    return;
  }
  if (metadata.status !== "expired") return;
  writeConnectionRow(serverId, credentials, { ...metadata, status: "connected" });
}

export function deleteMcpOAuthConnection(serverId: string) {
  getDb().prepare("DELETE FROM mcp_server_connections WHERE server_id = ?").run(serverId);
}

export function saveMcpOAuthDiscoveryState(serverId: string, discovery: OAuthDiscoveryState) {
  const row = readConnectionRow(serverId);
  if (!row) return;
  const { credentials, metadata } = parseConnection(row);
  writeConnectionRow(serverId, credentials, { ...metadata, discovery });
}

function getMcpOAuthStateSecret() {
  return createHash("sha256")
    .update("eidon-mcp-oauth-v1\0")
    .update(env.EIDON_SESSION_SECRET)
    .digest();
}

type McpOAuthState = {
  flowId: string;
  serverId: string;
  userId: string;
};

async function createMcpOAuthState(state: McpOAuthState) {
  return new SignJWT({ ...state, tokenUse: mcpOauthStateUse })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("eidon")
    .setAudience(mcpOauthStateAudience)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getMcpOAuthStateSecret());
}

async function verifyMcpOAuthState(stateToken: string): Promise<McpOAuthState> {
  const { payload } = await jwtVerify(stateToken, getMcpOAuthStateSecret(), {
    algorithms: ["HS256"],
    issuer: "eidon",
    audience: mcpOauthStateAudience
  });
  const values = [payload.flowId, payload.serverId, payload.userId];
  if (
    payload.tokenUse !== mcpOauthStateUse ||
    values.some((value) => typeof value !== "string" || !value.trim())
  ) {
    throw new Error("Invalid MCP OAuth state");
  }

  return {
    flowId: payload.flowId as string,
    serverId: payload.serverId as string,
    userId: payload.userId as string
  };
}

function setMcpOAuthFlowStatus(flowId: string, status: string) {
  getDb().prepare("UPDATE mcp_oauth_flows SET status = ? WHERE id = ?").run(status, flowId);
}

function claimMcpOAuthFlow(state: McpOAuthState): McpOauthFlowPayload | null {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE mcp_oauth_flows
       SET consumed_at = ?, status = 'processing'
       WHERE id = ?
         AND server_id = ?
         AND user_id = ?
         AND consumed_at IS NULL
         AND status = 'pending'
         AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM users
           WHERE users.id = mcp_oauth_flows.user_id
             AND users.role = 'admin'
         )`
    )
    .run(now, state.flowId, state.serverId, state.userId, now);
  if (result.changes !== 1) {
    return null;
  }

  const row = getDb()
    .prepare("SELECT payload_encrypted FROM mcp_oauth_flows WHERE id = ?")
    .get(state.flowId) as { payload_encrypted: string } | undefined;
  if (!row) {
    return null;
  }

  try {
    return JSON.parse(decryptValue(row.payload_encrypted)) as McpOauthFlowPayload;
  } catch {
    return null;
  }
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function buildMcpClientMetadata(
  redirectUri: string,
  branding?: { clientUri?: string; logoUri?: string }
): OAuthClientMetadata {
  const clientUri =
    branding?.clientUri && isHttpsUrl(branding.clientUri) ? branding.clientUri : undefined;
  const logoUri =
    branding?.logoUri && isHttpsUrl(branding.logoUri) ? branding.logoUri : undefined;
  return {
    client_name: MCP_CLIENT_NAME,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...(clientUri ? { client_uri: clientUri } : {}),
    ...(logoUri ? { logo_uri: logoUri } : {})
  };
}

export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly serverId: string,
    private readonly serverUrl: string
  ) {}

  get redirectUrl(): string {
    const connection = getMcpOAuthConnection(this.serverId);
    return connection?.redirectUri ?? "/api/mcp-servers/oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return buildMcpClientMetadata(this.redirectUrl);
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const connection = getMcpOAuthConnection(this.serverId);
    if (!connection?.clientId) return undefined;
    return {
      client_id: connection.clientId,
      ...(connection.clientSecret ? { client_secret: connection.clientSecret } : {})
    };
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    saveMcpOAuthClientInformation(this.serverId, clientInformation);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const connection = getMcpOAuthConnection(this.serverId);
    if (!connection?.accessToken) return undefined;
    return {
      access_token: connection.accessToken,
      token_type: connection.tokenType ?? "Bearer",
      ...(connection.refreshToken ? { refresh_token: connection.refreshToken } : {}),
      ...(connection.scope ? { scope: connection.scope } : {})
    };
  }

  async saveTokens(tokens: OAuthTokens) {
    saveMcpOAuthTokens(this.serverId, tokens);
  }

  async saveCodeVerifier(codeVerifier: string) {
    const row = readConnectionRow(this.serverId);
    if (!row) return;
    const { credentials, metadata } = parseConnection(row);
    writeConnectionRow(this.serverId, { ...credentials, codeVerifier }, metadata);
  }

  async codeVerifier(): Promise<string> {
    return readVerifier(this.serverId);
  }

  async redirectToAuthorization(_authorizationUrl: URL): Promise<void> {
    throw new McpAuthenticationRequiredError();
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const connection = getMcpOAuthConnection(this.serverId);
    return connection?.discovery ?? undefined;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState) {
    saveMcpOAuthDiscoveryState(this.serverId, state);
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery"
  ): Promise<void> {
    const row = readConnectionRow(this.serverId);
    if (!row) return;
    const { credentials, metadata } = parseConnection(row);
    if (scope === "all") {
      deleteMcpOAuthConnection(this.serverId);
      return;
    }
    if (scope === "client") {
      delete credentials.clientId;
      delete credentials.clientSecret;
    } else if (scope === "tokens") {
      delete credentials.accessToken;
      delete credentials.refreshToken;
    } else if (scope === "verifier") {
      delete credentials.codeVerifier;
    } else if (scope === "discovery") {
      delete metadata.discovery;
    }
    writeConnectionRow(this.serverId, credentials, metadata);
  }
}

function readVerifier(serverId: string): string {
  const row = readConnectionRow(serverId);
  if (!row) return "";
  const { credentials } = parseConnection(row);
  return credentials.codeVerifier ?? "";
}

export async function checkMcpOAuthSupport(serverUrl: string): Promise<boolean> {
  try {
    const discovery = await discoverOAuthServerInfo(serverUrl, { fetchFn: oauthFetch });
    const metadata = discovery.authorizationServerMetadata;
    return Boolean(metadata?.authorization_endpoint && metadata?.token_endpoint);
  } catch {
    return false;
  }
}

export async function startMcpOAuthFlow(input: {
  serverId: string;
  serverUrl: string;
  userId: string;
  redirectUri: string;
  clientUri?: string;
  logoUri?: string;
}): Promise<{ flowId: string; authorizationUrl: string; expiresAt: string }> {
  const discovery = await discoverOAuthServerInfo(input.serverUrl, { fetchFn: oauthFetch });
  const metadata = discovery.authorizationServerMetadata;
  if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
    throw new Error("This MCP server does not advertise OAuth authorization server metadata");
  }

  const provider = new McpOAuthProvider(input.serverId, input.serverUrl);
  const resource = await selectResourceURL(
    input.serverUrl,
    provider,
    discovery.resourceMetadata
  );

  let clientInformation: OAuthClientInformationMixed | undefined = await provider.clientInformation();
  const storedConnection = getMcpOAuthConnection(input.serverId);
  if (
    clientInformation &&
    storedConnection?.redirectUri &&
    storedConnection.redirectUri !== input.redirectUri
  ) {
    clientInformation = undefined;
  }
  if (!clientInformation) {
    if (!metadata.registration_endpoint) {
      throw new Error(
        "This MCP server does not support dynamic client registration, which Eidon requires for MCP OAuth"
      );
    }
    const registered = await registerClient(discovery.authorizationServerUrl, {
      metadata,
      clientMetadata: buildMcpClientMetadata(input.redirectUri, {
        clientUri: input.clientUri,
        logoUri: input.logoUri
      }),
      fetchFn: oauthFetch
    });
    clientInformation = {
      client_id: registered.client_id,
      ...(registered.client_secret ? { client_secret: registered.client_secret } : {})
    };
    saveMcpOAuthClientInformation(input.serverId, clientInformation, {
      authorizationServerUrl: discovery.authorizationServerUrl,
      redirectUri: input.redirectUri
    });
  } else {
    saveMcpOAuthDiscoveryStateIfMissing(input.serverId, {
      authorizationServerUrl: discovery.authorizationServerUrl,
      redirectUri: input.redirectUri
    });
  }

  const flowRecord = { flowId: createId("mcp_oauth_flow"), expiresAt: new Date(Date.now() + MCP_OAUTH_FLOW_DURATION_MS).toISOString() };
  const state = await createMcpOAuthState({
    flowId: flowRecord.flowId,
    serverId: input.serverId,
    userId: input.userId
  });

  const { authorizationUrl, codeVerifier } = await startAuthorization(
    discovery.authorizationServerUrl,
    {
      metadata,
      clientInformation,
      redirectUrl: input.redirectUri,
      state,
      resource
    }
  );

  const payload: McpOauthFlowPayload = {
    codeVerifier,
    redirectUri: input.redirectUri,
    authorizationServerUrl: discovery.authorizationServerUrl,
    ...(resource ? { resource: resource.toString() } : {}),
    clientId: clientInformation.client_id,
    ...(clientInformation.client_secret
      ? { clientSecret: clientInformation.client_secret }
      : {})
  };
  insertMcpOAuthFlow(flowRecord.flowId, input.serverId, input.userId, payload, flowRecord.expiresAt);

  return {
    flowId: flowRecord.flowId,
    authorizationUrl: authorizationUrl.toString(),
    expiresAt: flowRecord.expiresAt
  };
}

function saveMcpOAuthDiscoveryStateIfMissing(
  serverId: string,
  metadataUpdates: Partial<McpConnectionMetadata>
) {
  const row = readConnectionRow(serverId);
  if (!row) return;
  const { credentials, metadata } = parseConnection(row);
  if (metadata.authorizationServerUrl && metadata.redirectUri) return;
  writeConnectionRow(serverId, credentials, { ...metadata, ...metadataUpdates });
}

function insertMcpOAuthFlow(
  flowId: string,
  serverId: string,
  userId: string,
  payload: McpOauthFlowPayload,
  expiresAt: string
) {
  getDb()
    .prepare(
      `INSERT INTO mcp_oauth_flows (id, server_id, user_id, payload_encrypted, expires_at, consumed_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'pending', ?)`
    )
    .run(
      flowId,
      serverId,
      userId,
      encryptValue(JSON.stringify(payload)),
      expiresAt,
      new Date().toISOString()
    );
}

export type McpOAuthCallbackResult = {
  status: "success" | "failure" | "invalid_state";
  serverId: string | null;
};

export async function completeMcpOAuthCallback(
  request: Request
): Promise<McpOAuthCallbackResult> {
  const url = new URL(request.url);
  const stateToken = url.searchParams.get("state");
  if (!stateToken) {
    return { status: "invalid_state", serverId: null };
  }

  let state: McpOAuthState;
  try {
    state = await verifyMcpOAuthState(stateToken);
  } catch {
    return { status: "invalid_state", serverId: null };
  }

  const payload = claimMcpOAuthFlow(state);
  if (!payload) {
    return { status: "failure", serverId: state.serverId };
  }

  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (!code || oauthError) {
    setMcpOAuthFlowStatus(state.flowId, oauthError === "access_denied" ? "canceled" : "failed");
    return { status: "failure", serverId: state.serverId };
  }

  try {
    const metadata = (await discoverAuthorizationServerMetadata(payload.authorizationServerUrl, {
      fetchFn: oauthFetch
    })) as AuthorizationServerMetadata | undefined;
    if (!metadata?.token_endpoint) {
      throw new Error("Authorization server metadata is no longer available");
    }

    const tokens = await exchangeAuthorization(payload.authorizationServerUrl, {
      metadata,
      clientInformation: {
        client_id: payload.clientId,
        ...(payload.clientSecret ? { client_secret: payload.clientSecret } : {})
      },
      authorizationCode: code,
      codeVerifier: payload.codeVerifier,
      redirectUri: payload.redirectUri,
      ...(payload.resource ? { resource: new URL(payload.resource) } : {}),
      fetchFn: oauthFetch
    });

    saveMcpOAuthTokens(state.serverId, tokens, {
      authorizationServerUrl: payload.authorizationServerUrl,
      redirectUri: payload.redirectUri
    });
    setMcpOAuthFlowStatus(state.flowId, "succeeded");
    return { status: "success", serverId: state.serverId };
  } catch (error) {
    console.error("[mcp-oauth] callback failed", {
      serverId: state.serverId,
      flowId: state.flowId,
      error: error instanceof Error ? error.message : "UnknownError"
    });
    setMcpOAuthFlowStatus(state.flowId, "failed");
    return { status: "failure", serverId: state.serverId };
  }
}
