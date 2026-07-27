import { describe, expect, it, vi, beforeEach } from "vitest";

import { searchSearxng } from "@/lib/searxng";

describe("searxng search", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("requests the JSON search endpoint and formats top results", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "First result",
            url: "https://example.com/first",
            content: "First summary"
          },
          {
            title: "Second result",
            url: "https://example.com/second",
            content: "Second summary"
          }
        ]
      })
    } as Response);

    const result = await searchSearxng({
      baseUrl: "https://search.example.com/",
      query: "eidon ai",
      maxResults: 1
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://search.example.com/search?q=eidon+ai&format=json",
      expect.objectContaining({
        headers: { Accept: "application/json" }
      })
    );
    expect(result).toContain('SearXNG search results for "eidon ai"');
    expect(result).toContain("1. First result");
    expect(result).not.toContain("Second result");
  });

  it("returns a stable no-results message", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] })
    } as Response);

    await expect(
      searchSearxng({
        baseUrl: "https://search.example.com",
        query: "no matches"
      })
    ).resolves.toBe('No SearXNG results found for "no matches".');
  });

  it("treats a missing results array as an empty search response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({})
    } as Response);

    await expect(
      searchSearxng({
        baseUrl: " https://search.example.com/ ",
        query: "missing results"
      })
    ).resolves.toBe('No SearXNG results found for "missing results".');
  });

  it("formats fallback fields when the instance omits title, URL, or summary", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{}]
      })
    } as Response);

    const result = await searchSearxng({
      baseUrl: "https://search.example.com",
      query: "fallbacks"
    });

    expect(result).toContain("1. Untitled result");
    expect(result).toContain("No URL provided");
    expect(result).toContain("No summary available.");
  });

  it("throws a descriptive error when the instance rejects JSON output", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 403
    } as Response);

    await expect(
      searchSearxng({
        baseUrl: "https://search.example.com",
        query: "blocked"
      })
    ).rejects.toThrow("SearXNG search failed with status 403.");
  });

  it("passes cancellation through to fetch and rejects oversized responses", async () => {
    const controller = new AbortController();
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(600 * 1024) }
      })
    );

    await expect(
      searchSearxng({
        baseUrl: "https://search.example.com",
        query: "large response",
        abortSignal: controller.signal
      })
    ).rejects.toThrow("SearXNG response exceeded the size limit.");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("bounds formatted result text before returning it to the tool runtime", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: Array.from({ length: 10 }, (_, index) => ({
          title: `Result ${index} ${"t".repeat(1_000)}`,
          url: `https://example.com/${"u".repeat(3_000)}`,
          content: "c".repeat(10_000)
        }))
      })
    } as Response);

    const { MAX_SEARXNG_RESULT_CHARS } = await import("@/lib/searxng");
    const result = await searchSearxng({
      baseUrl: "https://search.example.com",
      query: "bounded",
      maxResults: 10
    });

    expect(result.length).toBeLessThanOrEqual(MAX_SEARXNG_RESULT_CHARS);
    expect(result).toContain("...[truncated]");
  });
});
