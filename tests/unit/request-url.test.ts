import { getExternalBaseUrl, getRequestOrigin, getMcpOAuthCallbackUrl, resolveExternalOrigin } from "@/lib/request-url";

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

  it("prefers the configured base URL over request headers", () => {
    process.env.EIDON_BASE_URL = "https://eidon.example.com";
    try {
      const request = buildRequest("http://internal:3000/api/thing", {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "other.example.com"
      });
      expect(getExternalBaseUrl()).toBe("https://eidon.example.com");
      expect(resolveExternalOrigin(request)).toBe("https://eidon.example.com");
      expect(getMcpOAuthCallbackUrl(request)).toBe(
        "https://eidon.example.com/api/mcp-servers/oauth/callback"
      );
    } finally {
      delete process.env.EIDON_BASE_URL;
    }
  });

  it("canonicalizes a configured base URL with an uppercase scheme", () => {
    process.env.EIDON_BASE_URL = "HTTPS://eidon.example.com/";
    try {
      expect(getExternalBaseUrl()).toBe("https://eidon.example.com");
      expect(resolveExternalOrigin(buildRequest("http://internal:3000/api/thing"))).toBe(
        "https://eidon.example.com"
      );
    } finally {
      delete process.env.EIDON_BASE_URL;
    }
  });

  it("falls back to request headers when the base URL is not http", () => {
    process.env.EIDON_BASE_URL = "ftp://ignored.example.com";
    try {
      const request = buildRequest("http://internal:3000/api/thing", {
        "x-forwarded-host": "header.example.com"
      });
      expect(getExternalBaseUrl()).toBeNull();
      expect(resolveExternalOrigin(request)).toBe("http://header.example.com");
    } finally {
      delete process.env.EIDON_BASE_URL;
    }
  });
});
