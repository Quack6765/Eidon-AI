import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";

export const MAX_SEARXNG_RESPONSE_BYTES = 512 * 1024;
export const MAX_SEARXNG_RESULT_CHARS = MAX_RUNTIME_TOOL_RESULT_CHARS;

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

type SearxngSearchInput = {
  baseUrl: string;
  query: string;
  maxResults?: number;
  abortSignal?: AbortSignal;
};

type SearxngResult = {
  title?: string;
  url?: string;
  content?: string;
};

async function readJsonResponse(response: Response) {
  const contentLength = Number(response.headers?.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SEARXNG_RESPONSE_BYTES) {
    throw new Error("SearXNG response exceeded the size limit.");
  }

  if (!response.body) {
    if (typeof response.text === "function") {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_SEARXNG_RESPONSE_BYTES) {
        throw new Error("SearXNG response exceeded the size limit.");
      }
      return JSON.parse(text) as unknown;
    }

    return await response.json() as unknown;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    bytesRead += chunk.value.byteLength;
    if (bytesRead > MAX_SEARXNG_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("SearXNG response exceeded the size limit.");
    }
    text += decoder.decode(chunk.value, { stream: true });
  }

  text += decoder.decode();
  return JSON.parse(text) as unknown;
}

export async function searchSearxng(input: SearxngSearchInput) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const parsedBaseUrl = new URL(baseUrl);
  if (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") {
    throw new Error("SearXNG base URL must use http or https.");
  }
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json"
    },
    signal: input.abortSignal
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed with status ${response.status}.`);
  }

  const payload = (await readJsonResponse(response)) as { results?: SearxngResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  const maxResults = input.maxResults ?? 5;
  const visibleResults = results.slice(0, maxResults);

  if (!visibleResults.length) {
    return `No SearXNG results found for "${input.query}".`;
  }

  return truncateText([
    `SearXNG search results for "${input.query}":`,
    ...visibleResults.map((result, index) =>
      [
        `${index + 1}. ${truncateText(result.title?.trim() || "Untitled result", 500)}`,
        truncateText(result.url?.trim() || "No URL provided", 2_048),
        truncateText(result.content?.trim() || "No summary available.", 4_000)
      ].join("\n")
    )
  ].join("\n\n"), MAX_SEARXNG_RESULT_CHARS);
}
