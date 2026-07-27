import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeMobileLoginAttempt,
  getMobileRequestSourceAddress,
  isSecureMobileRequest,
  mobileApiError,
  mobileApiSuccess,
  normalizeMobileApiResponse,
  recordMobileSecurityEvent,
  resetMobileLoginAttempts,
  resetMobileLoginRateLimiterForTests,
  sanitizeMobilePayload
} from "@/lib/mobile-api";

const originalNodeEnv = process.env.NODE_ENV;
const mutableEnv = process.env as Record<string, string | undefined>;

describe("mobile API conventions", () => {
  beforeEach(() => {
    mutableEnv.NODE_ENV = "test";
    resetMobileLoginRateLimiterForTests();
  });

  afterEach(() => {
    mutableEnv.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("recursively removes every secret-bearing and database-only field", () => {
    expect(sanitizeMobilePayload({
      id: "safe",
      apiKey: "plain",
      apiKeyEncrypted: "cipher",
      api_key_encrypted: "database-cipher",
      githubUserAccessToken: "github",
      github_refresh_token: "database-token",
      githubRefreshTokenEncrypted: "github-cipher",
      bearerToken: "bearer",
      passwordHash: "hash",
      password_hash: "database-hash",
      relativePath: "private/path",
      relative_path: "database/path",
      shareToken: "share-token",
      token: "raw-token",
      debug: { rowCount: 10 },
      extractedText: "private text",
      headers: { Authorization: "secret" },
      env: { TOKEN: "secret" },
      nested: [{ name: "visible", tavilyApiKey: "hidden" }, null, "value"]
    })).toEqual({
      id: "safe",
      nested: [{ name: "visible" }, null, "value"]
    });
  });

  it("uses consistent success and error envelopes with sanitized details", async () => {
    const success = mobileApiSuccess({ item: { id: "one", relativePath: "hidden" } }, {
      status: 201
    });
    expect(success.status).toBe(201);
    await expect(success.json()).resolves.toEqual({ data: { item: { id: "one" } } });

    const error = mobileApiError("invalid_request", "Invalid request", 400, {
      details: { field: "deviceName", passwordHash: "hidden" },
      headers: { "retry-after": "10" }
    });
    expect(error.headers.get("retry-after")).toBe("10");
    await expect(error.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "Invalid request",
        details: { field: "deviceName" }
      }
    });

    const bounded = mobileApiError("invalid_request", "m".repeat(600), 400, {
      details: {
        long: "d".repeat(1_100),
        items: Array.from({ length: 60 }, (_, index) => index),
        deep: { one: { two: { three: { four: { five: { hidden: true } } } } } }
      }
    });
    const boundedBody = await bounded.json() as {
      error: { message: string; details: { long: string; items: unknown[]; deep: unknown } };
    };
    expect(boundedBody.error.message).toHaveLength(512);
    expect(boundedBody.error.details.long).toHaveLength(1_000);
    expect(boundedBody.error.details.items).toHaveLength(50);
    expect(JSON.stringify(boundedBody.error.details.deep)).not.toContain("hidden");
  });

  it.each([
    [401, "authentication_required"],
    [403, "forbidden"],
    [404, "not_found"],
    [405, "unsupported_method"],
    [409, "conflict"],
    [422, "invalid_request"],
    [500, "internal_error"]
  ])("normalizes legacy JSON status %i into %s", async (status, code) => {
    const response = await normalizeMobileApiResponse(Response.json({
      error: "Legacy failure",
      details: { apiKey: "hidden", reason: "visible" }
    }, { status }));

    await expect(response.json()).resolves.toEqual({
      error: {
        code,
        message: status >= 500 ? "Unable to complete the request" : "Legacy failure",
        details: { reason: "visible" }
      }
    });
  });

  it("normalizes successful JSON and preserves binary responses", async () => {
    const jsonResponse = await normalizeMobileApiResponse(Response.json({
      provider: { name: "Safe", apiKeyEncrypted: "hidden" }
    }, {
      headers: { "set-cookie": "legacy=secret", "x-request-id": "request-1" }
    }));

    expect(jsonResponse.headers.get("set-cookie")).toBeNull();
    expect(jsonResponse.headers.get("x-request-id")).toBe("request-1");
    await expect(jsonResponse.json()).resolves.toEqual({
      data: { provider: { name: "Safe" } }
    });

    const binary = new Response("bytes", { headers: { "content-type": "application/octet-stream" } });
    await expect(normalizeMobileApiResponse(binary)).resolves.toBe(binary);
  });

  it("requires one unambiguous trusted HTTPS origin in production", () => {
    mutableEnv.NODE_ENV = "production";

    expect(isSecureMobileRequest(new Request("https://eidon.example/api/v1/auth/session"))).toBe(true);
    expect(isSecureMobileRequest(new Request("http://eidon.example/api/v1/auth/session"))).toBe(false);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: { forwarded: "for=192.0.2.1;proto=https", host: "eidon.example" }
    }))).toBe(true);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: {
        forwarded: "proto=https",
        "x-forwarded-proto": "http",
        host: "eidon.example"
      }
    }))).toBe(false);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: { forwarded: "for=192.0.2.1;proto=https;proto=http", host: "eidon.example" }
    }))).toBe(false);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: { "x-forwarded-proto": "https,http", host: "eidon.example" }
    }))).toBe(false);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "eidon.example",
        origin: "https://eidon.example"
      }
    }))).toBe(true);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "eidon.example, proxy.internal",
        origin: "https://eidon.example"
      }
    }))).toBe(false);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "eidon.example",
        origin: "https://attacker.example"
      }
    }))).toBe(false);
    expect(isSecureMobileRequest(new Request("http://internal/api/v1/auth/session", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "eidon.example",
        origin: "not a url"
      }
    }))).toBe(false);
  });

  it("accepts local development requests and derives a bounded source address", () => {
    expect(isSecureMobileRequest(new Request("http://localhost/api/v1/auth/login"))).toBe(true);
    expect(getMobileRequestSourceAddress(new Request("http://localhost", {
      headers: { "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.4" }
    }))).toBe("203.0.113.9");
    expect(getMobileRequestSourceAddress(new Request("http://localhost", {
      headers: { "x-forwarded-for": "198.51.100.4, 10.0.0.2" }
    }))).toBe("198.51.100.4");
    expect(getMobileRequestSourceAddress(new Request("http://localhost"))).toBe("unknown");
    expect(getMobileRequestSourceAddress(new Request("http://localhost", {
      headers: { "x-real-ip": "x".repeat(200) }
    }))).toHaveLength(128);
  });

  it("rate limits by normalized username and source, resets successes, and expires keys", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(consumeMobileLoginAttempt(" Admin ", "203.0.113.1", 1_000 + attempt)).toEqual({
        allowed: true,
        retryAfterSeconds: 0
      });
    }

    expect(consumeMobileLoginAttempt("admin", "203.0.113.1", 2_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 900
    });
    expect(consumeMobileLoginAttempt("ADMIN", "203.0.113.1", 2_500)).toEqual({
      allowed: false,
      retryAfterSeconds: 900
    });
    expect(consumeMobileLoginAttempt("admin", "203.0.113.2", 2_500).allowed).toBe(true);

    resetMobileLoginAttempts("admin", "203.0.113.1");
    expect(consumeMobileLoginAttempt("admin", "203.0.113.1", 3_000).allowed).toBe(true);
    expect(consumeMobileLoginAttempt("old", "203.0.113.8", 1_000).allowed).toBe(true);
    expect(consumeMobileLoginAttempt("new", "203.0.113.8", 2_000_000).allowed).toBe(true);
  });

  it("records only hashed login subjects and sources", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    recordMobileSecurityEvent("login", {
      username: "captain@example.com",
      sourceAddress: "203.0.113.42",
      sessionId: "mobile_session_safe",
      outcome: "success"
    });

    const serialized = JSON.stringify(info.mock.calls);
    expect(serialized).not.toContain("captain@example.com");
    expect(serialized).not.toContain("203.0.113.42");
    expect(serialized).toContain("mobile_session_safe");
  });
});
