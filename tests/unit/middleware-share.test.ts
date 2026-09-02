import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

describe("middleware share public access", () => {
  it.each(["/share/share_token", "/api/share/share_token", "/api/mcp-servers/oauth/callback"])(
    "allows %s without a session",
    async (pathname) => {
      const response = await middleware(new NextRequest(`http://localhost${pathname}`));

      expect(response.status).not.toBe(307);
      expect(response.headers.get("location")).toBeNull();
    }
  );

  it("keeps the MCP OAuth flow-start endpoint session protected", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/mcp-servers/mcp_1/oauth/flows", { method: "POST" })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("continues to protect normal conversation APIs", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/conversations/conv_123")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it.each([
    "/api/v1/server-info",
    "/api/v1/auth/login",
    "/api/v1/conversations"
  ])("leaves %s authentication to the Mobile API", async (pathname) => {
    const response = await middleware(new NextRequest(`http://localhost${pathname}`));

    expect(response.status).not.toBe(307);
    expect(response.headers.get("location")).toBeNull();
  });
});
