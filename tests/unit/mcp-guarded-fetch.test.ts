import { beforeEach, describe, expect, it, vi } from "vitest";

const { agentOptions, fetchMock, lookupMock } = vi.hoisted(() => ({
  agentOptions: [] as Array<Record<string, unknown>>,
  fetchMock: vi.fn(),
  lookupMock: vi.fn()
}));

vi.mock("undici", () => ({
  Agent: class {
    constructor(options: Record<string, unknown>) {
      agentOptions.push(options);
    }
  },
  fetch: fetchMock
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock
}));

import { guardedMcpFetch } from "@/lib/mcp-client";

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
}

describe("guardedMcpFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }));
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1:8080/mcp",
    "http://localhost/mcp",
    "http://10.0.0.5/mcp",
    "http://172.16.0.9/mcp",
    "http://192.168.1.10/mcp",
    "http://[::1]/mcp",
    "http://[fe80::1]/mcp",
    "http://[::ffff:127.0.0.1]/mcp",
    "http://[::ffff:a00:1]/mcp"
  ])("rejects blocked target %s without issuing a request", async (url) => {
    await expect(guardedMcpFetch(url)).rejects.toThrow("private or local network address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "ftp://example.com/mcp", "gopher://example.com/mcp"])(
    "rejects non-http scheme %s without issuing a request",
    async (url) => {
      await expect(guardedMcpFetch(url)).rejects.toThrow("url must be an absolute http(s) URL");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("returns the bounded response and re-validates each redirect hop", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/moved", 301))
      .mockResolvedValueOnce(jsonResponse({ result: "done" }));

    const response = await guardedMcpFetch("https://mcp.example.com/start");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ result: "done" });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://mcp.example.com/start",
      "https://mcp.example.com/moved"
    ]);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1/admin",
    "http://[::ffff:127.0.0.1]/admin"
  ])("rejects a redirect into blocked target %s", async (location) => {
    fetchMock.mockResolvedValueOnce(redirect(location));

    await expect(guardedMcpFetch("https://mcp.example.com/start")).rejects.toThrow(
      "private or local network address"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects that downgrade the connection to http", async () => {
    fetchMock.mockResolvedValueOnce(redirect("http://mcp.example.com/plain"));

    await expect(guardedMcpFetch("https://mcp.example.com/start")).rejects.toThrow(
      "Redirect downgraded the connection to http"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects with no location and gives up after too many hops", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(guardedMcpFetch("https://mcp.example.com/start")).rejects.toThrow(
      "Page request failed with status 302"
    );

    fetchMock.mockImplementation(async (url: URL) => redirect(`${url.origin}/hop${Math.random()}`));
    await expect(guardedMcpFetch("https://mcp.example.com/start")).rejects.toThrow(
      "Too many redirects"
    );
  });

  it("rejects hostnames that resolve to private addresses through the guarded lookup", async () => {
    await guardedMcpFetch("https://mcp.example.com/start");

    const lookup = (agentOptions.at(-1)?.connect as { lookup: (...args: unknown[]) => void }).lookup;
    const [error] = await new Promise<unknown[]>((resolve) => {
      lookup("rebind.example", { all: true }, (...callbackArgs: unknown[]) => resolve(callbackArgs));
    });

    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    const [rebindError] = await new Promise<unknown[]>((resolve) => {
      lookup("rebind.example", { all: true }, (...callbackArgs: unknown[]) => resolve(callbackArgs));
    });

    expect(error).toBeNull();
    expect((rebindError as Error).message).toContain("private or local network address");
  });
});
