import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdminUserMock } = vi.hoisted(() => ({
  requireAdminUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireAdminUser: requireAdminUserMock
}));

describe("mcp server routes", () => {
  beforeEach(() => {
    vi.resetModules();
    requireAdminUserMock.mockReset();
    requireAdminUserMock.mockResolvedValue({
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
    requireAdminUserMock.mockRejectedValueOnce(new Error("forbidden"));

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
});
