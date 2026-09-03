import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";

import { getDb } from "@/lib/db";
import {
  completeMcpOAuthCallback,
  getMcpOAuthConnection,
  startMcpOAuthFlow
} from "@/lib/mcp-oauth";
import { createMcpServer, getMcpServer } from "@/lib/mcp-servers";
import { createLocalUser } from "@/lib/users";

type RegisteredClient = { clientId: string; redirectUris: string[]; logoUri?: string; clientUri?: string };

type IssuedCode = { codeChallenge: string; clientId: string; redirectUri: string };

const INITIAL_ACCESS_TOKEN = "integration_access_token_9f1c";
const REFRESH_TOKEN = "integration_refresh_token_7a2b";

function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function startMockAuthorizationServer() {
  const registeredClients: RegisteredClient[] = [];
  const issuedCodes = new Map<string, IssuedCode>();
  let currentAccessToken = INITIAL_ACCESS_TOKEN;
  let lastMcpBearer: string | null = null;
  const refreshCount = { value: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const sendJson = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      sendJson(200, {
        resource: `http://localhost:${port}/mcp`,
        authorization_servers: [`http://localhost:${port}`]
      });
      return;
    }

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/.well-known/oauth-authorization-server")
    ) {
      sendJson(200, {
        issuer: `http://localhost:${port}`,
        authorization_endpoint: `http://localhost:${port}/authorize`,
        token_endpoint: `http://localhost:${port}/token`,
        registration_endpoint: `http://localhost:${port}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"]
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/register") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = JSON.parse(raw) as { redirect_uris?: string[]; logo_uri?: string; client_uri?: string };
        const client: RegisteredClient = {
          clientId: `client_${registeredClients.length + 1}`,
          redirectUris: body.redirect_uris ?? [],
          logoUri: body.logo_uri,
          clientUri: body.client_uri
        };
        registeredClients.push(client);
        sendJson(201, {
          client_id: client.clientId,
          redirect_uris: client.redirectUris,
          client_name: "Eidon",
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "none"
        });
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const params = new URLSearchParams(raw);
        const grantType = params.get("grant_type");
        if (grantType === "authorization_code") {
          const code = params.get("code");
          const verifier = params.get("code_verifier");
          const redirectUri = params.get("redirect_uri");
          const clientId = params.get("client_id");
          const issued = code ? issuedCodes.get(code) : undefined;
          if (
            !issued ||
            !verifier ||
            s256(verifier) !== issued.codeChallenge ||
            clientId !== issued.clientId ||
            redirectUri !== issued.redirectUri
          ) {
            sendJson(400, { error: "invalid_grant" });
            return;
          }
          issuedCodes.delete(code!);
          sendJson(200, {
            access_token: currentAccessToken,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: REFRESH_TOKEN,
            scope: "mcp"
          });
          return;
        }
        if (grantType === "refresh_token" && params.get("refresh_token") === REFRESH_TOKEN) {
          refreshCount.value += 1;
          currentAccessToken = `rotated_access_token_${randomBytes(4).toString("hex")}`;
          sendJson(200, {
            access_token: currentAccessToken,
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: REFRESH_TOKEN,
            scope: "mcp"
          });
          return;
        }
        sendJson(400, { error: "unsupported_grant_type" });
      });
      return;
    }

    if (url.pathname === "/mcp") {
      const authorization = req.headers.authorization ?? "";
      lastMcpBearer = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : null;
      if (req.method === "GET") {
        res.writeHead(405);
        res.end();
        return;
      }
      if (lastMcpBearer !== currentAccessToken) {
        sendJson(
          401,
          { error: "unauthorized" },
          {
            "www-authenticate": `Bearer error="invalid_token", resource_metadata="http://localhost:${port}/.well-known/oauth-protected-resource"`
          }
        );
        return;
      }
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const message = JSON.parse(raw) as {
          id?: number;
          method: string;
          params?: Record<string, unknown>;
        };
        if (message.method === "initialize") {
          sendJson(200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: (message.params?.protocolVersion as string) ?? "2025-03-26",
              capabilities: {},
              serverInfo: { name: "Mock MCP", version: "1.0.0" }
            }
          });
          return;
        }
        if (message.method === "tools/list") {
          sendJson(200, {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              tools: [
                {
                  name: "composio_tool",
                  description: "A tool",
                  inputSchema: { type: "object" }
                }
              ]
            }
          });
          return;
        }
        res.writeHead(202);
        res.end();
      });
      return;
    }

    sendJson(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    baseUrl: `http://localhost:${port}`,
    registeredClients,
    refreshCount,
    get currentAccessToken() {
      return currentAccessToken;
    },
    get lastMcpBearer() {
      return lastMcpBearer;
    },
    issueCode(codeChallenge: string, clientId: string, redirectUri: string) {
      const code = `code_${issuedCodes.size + 1}`;
      issuedCodes.set(code, { codeChallenge, clientId, redirectUri });
      return code;
    },
    async rotateViaRefresh() {
      const response = await fetch(`http://localhost:${port}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: REFRESH_TOKEN,
          client_id: registeredClients[0]?.clientId ?? ""
        })
      });
      expect(response.ok).toBe(true);
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

const REDIRECT_URI = "http://eidon.test/api/mcp-servers/oauth/callback";

async function authenticateServer(as: Awaited<ReturnType<typeof startMockAuthorizationServer>>) {
  const server = createMcpServer({
    name: `Integration ${as.port}`,
    url: `${as.baseUrl}/mcp`
  });
  const admin = await createLocalUser({
    username: `integration-${as.port}@example.com`,
    password: "Password123!",
    role: "admin"
  });

  const flow = await startMcpOAuthFlow({
    serverId: server.id,
    serverUrl: server.url,
    userId: admin.id,
    redirectUri: REDIRECT_URI,
    clientUri: "https://eidon.example.com",
    logoUri: "https://eidon.example.com/agent-icon.png"
  });

  const authorizationUrl = new URL(flow.authorizationUrl);
  expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();
  expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");

  const code = as.issueCode(
    authorizationUrl.searchParams.get("code_challenge")!,
    as.registeredClients[0].clientId,
    REDIRECT_URI
  );
  const state = authorizationUrl.searchParams.get("state")!;
  const result = await completeMcpOAuthCallback(
    new Request(`http://eidon.test/api/mcp-servers/oauth/callback?code=${code}&state=${state}`)
  );
  expect(result).toEqual({ status: "success", serverId: server.id });

  return { server, state };
}

describe("mcp oauth end-to-end flow against a mock authorization server", () => {
  it("completes discovery, registration, authorization, and token exchange", async () => {
    const as = await startMockAuthorizationServer();
    try {
      const { server, state } = await authenticateServer(as);

      expect(as.registeredClients).toHaveLength(1);
      expect(as.registeredClients[0].redirectUris).toEqual([REDIRECT_URI]);
      expect(as.registeredClients[0].logoUri).toBe("https://eidon.example.com/agent-icon.png");
      expect(as.registeredClients[0].clientUri).toBe("https://eidon.example.com");

      const connection = getMcpOAuthConnection(server.id);
      expect(connection?.accessToken).toBe(INITIAL_ACCESS_TOKEN);
      expect(connection?.refreshToken).toBe(REFRESH_TOKEN);
      expect(connection?.status).toBe("connected");
      expect(connection?.redirectUri).toBe(REDIRECT_URI);

      const storedRow = getDb()
        .prepare(
          "SELECT credentials_encrypted FROM mcp_server_connections WHERE server_id = ?"
        )
        .get(server.id) as { credentials_encrypted: string };
      expect(storedRow.credentials_encrypted).not.toContain(INITIAL_ACCESS_TOKEN);
      expect(storedRow.credentials_encrypted).not.toContain(REFRESH_TOKEN);

      const replay = await completeMcpOAuthCallback(
        new Request(`http://eidon.test/api/mcp-servers/oauth/callback?code=again&state=${state}`)
      );
      expect(replay.status).toBe("failure");
    } finally {
      await as.close();
    }
  });

  it("tests cleanly with a valid token and refreshes transparently when the token is rejected", async () => {
    const as = await startMockAuthorizationServer();
    try {
      const { server: created } = await authenticateServer(as);
      const { testMcpServerConnection } = await import("@/lib/mcp-client");
      const server = getMcpServer(created.id)!;

      const validResult = await testMcpServerConnection(server);
      expect(validResult.toolCount).toBe(1);
      expect(as.lastMcpBearer).toBe(INITIAL_ACCESS_TOKEN);

      const afterValid = getMcpOAuthConnection(server.id);
      expect(afterValid?.status).toBe("connected");

      as.rotateViaRefresh();
      const refreshedResult = await testMcpServerConnection(server);
      expect(refreshedResult.toolCount).toBe(1);
      expect(as.refreshCount.value).toBe(2);
      expect(as.lastMcpBearer).toBe(as.currentAccessToken);

      const stored = getMcpOAuthConnection(server.id);
      expect(stored?.accessToken).toBe(as.currentAccessToken);
      expect(stored?.status).toBe("connected");
    } finally {
      await as.close();
    }
  });
});
