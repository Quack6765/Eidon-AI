import { getRequestOrigin, getMcpOAuthCallbackUrl } from "@/lib/request-url";

function buildRequest(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("request url helpers", () => {
  it("prefers forwarded proto and host", () => {
    const request = buildRequest("http://internal:3000/api/thing", {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "eidon.example.com"
    });
    expect(getRequestOrigin(request)).toBe("https://eidon.example.com");
    expect(getMcpOAuthCallbackUrl(request)).toBe(
      "https://eidon.example.com/api/mcp-servers/oauth/callback"
    );
  });

  it("uses first value of multi-valued forwarded headers", () => {
    const request = buildRequest("http://internal:3000/api/thing", {
      "x-forwarded-proto": "https, http",
      "x-forwarded-host": "a.example.com, b.example.com"
    });
    expect(getRequestOrigin(request)).toBe("https://a.example.com");
  });

  it("falls back to the host header", () => {
    const request = buildRequest("http://localhost:3000/api/thing", {
      host: "direct.example.com"
    });
    expect(getRequestOrigin(request)).toBe("http://direct.example.com");
  });

  it("falls back to the request url origin", () => {
    const request = buildRequest("http://fallback.example.com/api/thing");
    expect(getRequestOrigin(request)).toBe("http://fallback.example.com");
  });
});
