import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_WEB_READ_RESPONSE_BYTES,
  isPublicAddress,
  readWebPage
} from "@/lib/web-read";
import { TRUNCATION_MARKER } from "@/lib/bounded-text";
import { createRuntimeAppSettings } from "@/tests/provider-fixtures";

const { agentOptions, fetchMock, getWebPageReaderMock, lookupMock, providerReaderMock } = vi.hoisted(() => ({
  agentOptions: [] as Array<Record<string, unknown>>,
  fetchMock: vi.fn(),
  getWebPageReaderMock: vi.fn(),
  lookupMock: vi.fn(),
  providerReaderMock: vi.fn()
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

vi.mock("@/lib/web-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/web-search")>()),
  getWebPageReader: getWebPageReaderMock
}));

const ARTICLE = `<html><head><title>Example Domain</title></head><body><main>
  <h1>Example Domain</h1>
  <p>${"This domain is for use in illustrative examples in documents. ".repeat(40)}</p>
  <p>More <a href="/info">information</a>.</p>
</main></body></html>`;

function htmlResponse(body = ARTICLE, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers ?? {}) }
  });
}

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

async function guardedLookup(hostname: string, options: { all?: boolean } = { all: true }) {
  const lookup = (agentOptions.at(-1)?.connect as { lookup: (...args: unknown[]) => void }).lookup;
  return new Promise<unknown[]>((resolve) => {
    lookup(hostname, options, (...callbackArgs: unknown[]) => resolve(callbackArgs));
  });
}

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "ff02::1",
    "64:ff9b::a00:1",
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    "::ffff:7f00:1"
  ])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:5db8:d822"])(
    "allows %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );

  it("rejects values that are not IP addresses", () => {
    expect(isPublicAddress("example.com")).toBe(false);
    expect(isPublicAddress("::ffff:zz")).toBe(false);
  });
});

describe("readWebPage built-in reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentOptions.length = 0;
    getWebPageReaderMock.mockReturnValue(null);
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    fetchMock.mockImplementation(async () => htmlResponse());
  });

  it.each([
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:a00:1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://0.0.0.0/",
    "http://localhost/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://db.internal/"
  ])("rejects %s before issuing a request", async (url) => {
    await expect(readWebPage({ url })).rejects.toThrow("private or local network address");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["ftp://example.com/file", "file:///etc/passwd", "javascript:alert(1)", "not a url", ""])(
    "rejects non-http URL %j",
    async (url) => {
      await expect(readWebPage({ url })).rejects.toThrow("url must be an absolute http(s) URL");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("rejects URLs carrying credentials", async () => {
    await expect(readWebPage({ url: "https://user:secret@example.com/" })).rejects.toThrow(
      "url must not contain credentials"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins DNS results into the connection and rejects private resolutions", async () => {
    await readWebPage({ url: "https://example.com/" });

    const [error, addresses] = await guardedLookup("example.com");
    expect(error).toBeNull();
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);

    const [singleError, single, family] = await guardedLookup("example.com", {});
    expect(singleError).toBeNull();
    expect(single).toBe("93.184.216.34");
    expect(family).toBe(4);

    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.5", family: 4 }
    ]);
    const [mixedError] = await guardedLookup("rebind.example");
    expect(mixedError).toBeInstanceOf(Error);
    expect((mixedError as Error).message).toContain("private or local network address");

    lookupMock.mockResolvedValueOnce([]);
    const [emptyError] = await guardedLookup("nowhere.example");
    expect(emptyError).toBeInstanceOf(Error);

    lookupMock.mockRejectedValueOnce("ENOTFOUND");
    const [failureError] = await guardedLookup("missing.example");
    expect((failureError as Error).message).toBe("ENOTFOUND");
  });

  it("returns the page as Markdown with a title and source line", async () => {
    const result = await readWebPage({ url: "https://example.com/" });

    expect(result.startsWith("# Example Domain\nSource: https://example.com/\n\n")).toBe(true);
    expect(result).toContain("[information](https://example.com/info)");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) })
    );
  });

  it("follows redirects while re-validating each hop", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/moved", 301))
      .mockResolvedValueOnce(redirect("https://cdn.example.com/final", 308))
      .mockResolvedValueOnce(htmlResponse());

    const result = await readWebPage({ url: "https://example.com/start" });

    expect(result).toContain("Source: https://cdn.example.com/final");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://example.com/start",
      "https://example.com/moved",
      "https://cdn.example.com/final"
    ]);
  });

  it("rejects redirects to private hosts, downgrades, and missing locations", async () => {
    fetchMock.mockResolvedValueOnce(redirect("http://127.0.0.1/admin"));
    await expect(readWebPage({ url: "https://example.com/" })).rejects.toThrow(
      "private or local network address"
    );

    fetchMock.mockResolvedValueOnce(redirect("http://example.com/plain"));
    await expect(readWebPage({ url: "https://example.com/" })).rejects.toThrow(
      "Redirect downgraded the connection to http"
    );

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(readWebPage({ url: "https://example.com/" })).rejects.toThrow(
      "Page request failed with status 302"
    );
  });

  it("gives up after too many redirects", async () => {
    fetchMock.mockImplementation(async (url: URL) => redirect(`${url.origin}/hop${Math.random()}`));

    await expect(readWebPage({ url: "https://example.com/" })).rejects.toThrow("Too many redirects");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("surfaces non-success statuses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("missing", { status: 404 }));

    await expect(readWebPage({ url: "https://example.com/missing" })).rejects.toThrow(
      "Page request failed with status 404"
    );
  });

  it.each(["application/pdf", "image/png", "application/octet-stream"])(
    "rejects unsupported content type %s",
    async (contentType) => {
      fetchMock.mockResolvedValueOnce(
        new Response("binary", { status: 200, headers: { "content-type": contentType } })
      );

      await expect(readWebPage({ url: "https://example.com/file" })).rejects.toThrow(
        `Unsupported content type: ${contentType}`
      );
    }
  );

  it("passes plain text and markdown through untouched", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("  just text\nline two  ", { status: 200, headers: { "content-type": "text/plain" } })
    );
    await expect(readWebPage({ url: "https://example.com/notes.txt" })).resolves.toBe(
      "Source: https://example.com/notes.txt\n\njust text\nline two"
    );

    fetchMock.mockResolvedValueOnce(
      new Response("# Readme", { status: 200, headers: { "content-type": "text/markdown" } })
    );
    await expect(readWebPage({ url: "https://example.com/README.md" })).resolves.toBe(
      "Source: https://example.com/README.md\n\n# Readme"
    );
  });

  it("treats a missing content type as HTML and decodes declared charsets", async () => {
    fetchMock.mockResolvedValueOnce(new Response(new TextEncoder().encode(ARTICLE), { status: 200 }));
    await expect(readWebPage({ url: "https://example.com/" })).resolves.toContain("# Example Domain");

    const latin1 = new Uint8Array([0x43, 0x61, 0x66, 0xe9]);
    fetchMock.mockResolvedValueOnce(
      new Response(latin1, { status: 200, headers: { "content-type": 'text/plain; charset="iso-8859-1"' } })
    );
    await expect(readWebPage({ url: "https://example.com/latin" })).resolves.toContain("Café");

    fetchMock.mockResolvedValueOnce(
      new Response("plain", { status: 200, headers: { "content-type": "text/plain; charset=nonsense" } })
    );
    await expect(readWebPage({ url: "https://example.com/odd" })).resolves.toContain("plain");
  });

  it("rejects oversized bodies announced by content-length or discovered while streaming", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<p>small</p>", { headers: { "content-length": String(MAX_WEB_READ_RESPONSE_BYTES + 1) } })
    );
    await expect(readWebPage({ url: "https://example.com/big" })).rejects.toThrow(
      "Page exceeded the 2 MB limit"
    );

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_WEB_READ_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(16));
        controller.close();
      }
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "content-type": "text/html" } })
    );
    await expect(readWebPage({ url: "https://example.com/stream" })).rejects.toThrow(
      "Page exceeded the 2 MB limit"
    );
  });

  it("propagates unexpected body read failures", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("socket hang up");
      }
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "content-type": "text/html" } })
    );

    await expect(readWebPage({ url: "https://example.com/broken" })).rejects.toThrow("socket hang up");
  });

  it("clamps max_chars and truncates the result", async () => {
    const long = await readWebPage({ url: "https://example.com/", maxChars: 1200 });
    expect(long.length).toBeLessThanOrEqual(1200);
    expect(long.endsWith(TRUNCATION_MARKER)).toBe(true);

    fetchMock.mockResolvedValueOnce(htmlResponse());
    const clampedLow = await readWebPage({ url: "https://example.com/", maxChars: 10 });
    expect(clampedLow.length).toBeGreaterThan(10);
    expect(clampedLow.length).toBeLessThanOrEqual(1000);

    fetchMock.mockResolvedValueOnce(htmlResponse());
    const clampedHigh = await readWebPage({ url: "https://example.com/", maxChars: 99_999 });
    expect(clampedHigh.endsWith(TRUNCATION_MARKER)).toBe(false);
  });

  it("rejects immediately when the caller already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(readWebPage({ url: "https://example.com/", abortSignal: controller.signal })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("readWebPage provider readers", () => {
  const settings = createRuntimeAppSettings();

  beforeEach(() => {
    vi.clearAllMocks();
    agentOptions.length = 0;
    getWebPageReaderMock.mockReturnValue(providerReaderMock);
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    fetchMock.mockImplementation(async () => htmlResponse());
  });

  it("uses the configured provider reader instead of fetching directly", async () => {
    providerReaderMock.mockResolvedValue("# Provider title\nSource: https://example.com/\n\nProvider body");

    await expect(readWebPage({ url: "https://example.com/", settings, maxChars: 5000 })).resolves.toBe(
      "# Provider title\nSource: https://example.com/\n\nProvider body"
    );
    expect(getWebPageReaderMock).toHaveBeenCalledWith(settings);
    expect(providerReaderMock).toHaveBeenCalledWith({
      url: "https://example.com/",
      maxChars: 5000,
      settings,
      abortSignal: expect.any(AbortSignal),
      timeout: 20_000
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("truncates provider output to the requested size", async () => {
    providerReaderMock.mockResolvedValue("x".repeat(5_000));

    const result = await readWebPage({ url: "https://example.com/", settings, maxChars: 1500 });

    expect(result.length).toBeLessThanOrEqual(1500);
    expect(result.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("uses the built-in reader when no provider reader is available", async () => {
    getWebPageReaderMock.mockReturnValue(null);

    await expect(readWebPage({ url: "https://example.com/", settings })).resolves.toContain("# Example Domain");
    await expect(readWebPage({ url: "https://example.com/" })).resolves.toContain("# Example Domain");
    expect(getWebPageReaderMock).toHaveBeenCalledWith(undefined);
    expect(providerReaderMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the built-in reader when the provider call fails", async () => {
    providerReaderMock.mockRejectedValue(new Error("provider down"));

    await expect(readWebPage({ url: "https://example.com/", settings })).resolves.toContain("# Example Domain");

    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(readWebPage({ url: "https://example.com/", settings })).rejects.toThrow(
      "Page request failed with status 500"
    );
  });

  it("does not fall back when the provider failed because the caller aborted", async () => {
    const controller = new AbortController();
    providerReaderMock.mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });

    await expect(
      readWebPage({ url: "https://example.com/", settings, abortSignal: controller.signal })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
