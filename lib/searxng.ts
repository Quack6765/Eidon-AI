function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

type SearxngSearchInput = {
  baseUrl: string;
  query: string;
  maxResults?: number;
};

type SearxngResult = {
  title?: string;
  url?: string;
  content?: string;
};

export async function searchSearxng(input: SearxngSearchInput) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { results?: SearxngResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  const maxResults = input.maxResults ?? 5;
  const visibleResults = results.slice(0, maxResults);

  if (!visibleResults.length) {
    return `No SearXNG results found for "${input.query}".`;
  }

  return [
    `SearXNG search results for "${input.query}":`,
    ...visibleResults.map((result, index) =>
      [
        `${index + 1}. ${result.title?.trim() || "Untitled result"}`,
        result.url?.trim() || "No URL provided",
        result.content?.trim() || "No summary available."
      ].join("\n")
    )
  ].join("\n\n");
}
