import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminResponseMock } = vi.hoisted(() => ({
  requireAdminResponseMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAdminResponse: requireAdminResponseMock
}));

describe("mcp server routes", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAdminResponseMock.mockReset();
    requireAdminResponseMock.mockResolvedValue({
      id: "user_admin",
      username: "admin",
      role: "admin",
      authSource: "env_super_admin",
      passwordManagedBy: "env",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("rejects whitespace-only names on create", async () => {
    const { POST } = await import("@/app/api/mcp-servers/route");

    const response = await POST(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: "streamable_http",
          name: "   ",
          url: "https://mcp.example.com"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid server config"
    });
  });

  it("rejects duplicate names that slugify to the same value", async () => {
    const { POST } = await import("@/app/api/mcp-servers/route");

    const first = await POST(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: "streamable_http",
          name: "Exa Docs",
          url: "https://mcp.example.com"
        })
      })
    );
    expect(first.status).toBe(201);

    const second = await POST(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: "streamable_http",
          name: "exa-docs",
          url: "https://mcp-2.example.com"
        })
      })
    );

    expect(second.status).toBe(400);
    await expect(second.json()).resolves.toEqual({
      error: "An MCP server with a similar name already exists."
    });
  });

  it("returns forbidden for non-admin users", async () => {
    requireAdminResponseMock.mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/mcp-servers/route");
    const response = await POST(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: "streamable_http",
          name: "Docs",
          url: "https://mcp.example.com"
        })
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("redacts stored headers and environment variables from API responses", async () => {
    const { GET, POST } = await import("@/app/api/mcp-servers/route");
    const created = await POST(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: "stdio",
          name: "Secret server",
          command: "node",
          env: { API_KEY: "top-secret" }
        })
      })
    );
    const createdBody = await created.json() as { server: Record<string, unknown> };
    expect(createdBody.server).toMatchObject({ env: null, hasEnv: true });
    expect(JSON.stringify(createdBody)).not.toContain("top-secret");

    const response = await GET();
    const body = await response.json() as { servers: Array<Record<string, unknown>> };
    expect(body.servers[0]).toMatchObject({ headers: {}, env: null, hasEnv: true });
    expect(JSON.stringify(body)).not.toContain("top-secret");
  });

  it("creates a disabled server atomically", async () => {
    const { POST } = await import("@/app/api/mcp-servers/route");
    const { getMcpServer } = await import("@/lib/mcp-servers");
    const response = await POST(
      new Request("http://localhost/api/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: "streamable_http",
          name: "Disabled server",
          url: "https://disabled.example.com",
          enabled: false
        })
      })
    );
    const body = await response.json() as { server: { id: string; enabled: boolean } };

    expect(response.status).toBe(201);
    expect(body.server.enabled).toBe(false);
    expect(getMcpServer(body.server.id)?.enabled).toBe(false);
  });
});
