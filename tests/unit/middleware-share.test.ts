import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { middleware } from "@/middleware";

describe("middleware share public access", () => {
  it.each(["/share/share_token", "/api/share/share_token"])(
    "allows %s without a session",
    async (pathname) => {
      const response = await middleware(new NextRequest(`http://localhost${pathname}`));

      expect(response.status).not.toBe(307);
      expect(response.headers.get("location")).toBeNull();
    }
  );

  it("continues to protect normal conversation APIs", async () => {
    const response = await middleware(
      new NextRequest("http://localhost/api/conversations/conv_123")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });
});
