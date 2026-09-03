import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as pinnedFetch } from "undici";

import { readRequestBodyWithLimit, RequestBodyTooLargeError } from "@/lib/bounded-request";
import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";
import { htmlToMarkdown } from "@/lib/html-to-markdown";
import { formatPageContent, getWebPageReader } from "@/lib/web-search";
import type { RuntimeAppSettings } from "@/lib/types";

export const MAX_WEB_READ_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WEB_READ_TIMEOUT_MS = 20_000;
export const MAX_WEB_READ_REDIRECTS = 5;
export const MIN_WEB_READ_CHARS = 1_000;

const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown"];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAME_PATTERN = /^(?:localhost|.+\.localhost|.+\.local|.+\.internal)$/i;
const IPV4_MAPPED_PATTERN = /^::ffff:(.+)$/i;
const BLOCKED_IPV4_SUBNETS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];
const BLOCKED_IPV6_SUBNETS: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
];

const blockedAddresses = new BlockList();
for (const [address, prefix] of BLOCKED_IPV4_SUBNETS) blockedAddresses.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of BLOCKED_IPV6_SUBNETS) blockedAddresses.addSubnet(address, prefix, "ipv6");

export type WebReadInput = {
  url: string;
  maxChars?: number;
  settings?: RuntimeAppSettings;
  abortSignal?: AbortSignal;
};

function unwrapMappedAddress(address: string) {
  const mapped = IPV4_MAPPED_PATTERN.exec(address);
  if (!mapped) return address;
  const tail = mapped[1];
  if (isIP(tail) === 4) return tail;
  const [high, low] = tail.split(":").map((part) => Number.parseInt(part || "0", 16));
  if (!Number.isFinite(high) || !Number.isFinite(low)) return address;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isPublicAddress(address: string) {
  const normalized = unwrapMappedAddress(address);
  const family = isIP(normalized);
  if (family === 4) return !blockedAddresses.check(normalized, "ipv4");
  if (family === 6) return !blockedAddresses.check(normalized, "ipv6");
  return false;
}

function parsePageUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("url must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("url must be an absolute http(s) URL");
  }
  if (url.username || url.password) {
    throw new Error("url must not contain credentials");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAME_PATTERN.test(hostname) || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new Error("url points to a private or local network address");
  }
  return url;
}

type LookupCallback = (
  error: Error | null,
  result: Array<{ address: string; family: number }> | string,
  family?: number
) => void;

async function guardedLookup(hostname: string, options: { all?: boolean } | number, callback: LookupCallback) {
  try {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new Error("url points to a private or local network address");
    }
    if (typeof options === "object" && options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)), []);
  }
}

let dispatcher: Agent | null = null;

function getDispatcher() {
  dispatcher ??= new Agent({
    connect: { lookup: guardedLookup } as unknown as Agent.Options["connect"],
    headersTimeout: WEB_READ_TIMEOUT_MS,
    bodyTimeout: WEB_READ_TIMEOUT_MS
  });
  return dispatcher;
}

function contentTypeOf(header: string | null) {
  const [mediaType = "", ...params] = (header ?? "text/html").split(";").map((part) => part.trim().toLowerCase());
  const charset = params.find((part) => part.startsWith("charset="))?.slice("charset=".length).replace(/^"|"$/g, "");
  return { mediaType, charset };
}

function decodeBody(bytes: ArrayBuffer, charset: string | undefined) {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchPublicPage(initialUrl: URL, signal: AbortSignal) {
  let url = initialUrl;
  for (let hop = 0; hop <= MAX_WEB_READ_REDIRECTS; hop += 1) {
    const response = await pinnedFetch(url, {
      dispatcher: getDispatcher(),
      redirect: "manual",
      signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,text/markdown;q=0.9",
        "user-agent": "Mozilla/5.0 (compatible; Eidon/1.0; read_page)"
      }
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error(`Page request failed with status ${response.status}`);
      const next = parsePageUrl(new URL(location, url).toString());
      if (url.protocol === "https:" && next.protocol === "http:") {
        throw new Error("Redirect downgraded the connection to http");
      }
      url = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Page request failed with status ${response.status}`);
    }

    const { mediaType, charset } = contentTypeOf(response.headers.get("content-type"));
    if (!ALLOWED_CONTENT_TYPES.includes(mediaType)) {
      await response.body?.cancel();
      throw new Error(`Unsupported content type: ${mediaType || "unknown"}`);
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await readRequestBodyWithLimit(
        response as unknown as { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null },
        MAX_WEB_READ_RESPONSE_BYTES
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        throw new Error(`Page exceeded the ${MAX_WEB_READ_RESPONSE_BYTES / (1024 * 1024)} MB limit`);
      }
      throw error;
    }

    return { finalUrl: url.toString(), mediaType, text: decodeBody(bytes, charset) };
  }
  throw new Error("Too many redirects");
}

async function readBuiltIn(url: URL, signal: AbortSignal) {
  const page = await fetchPublicPage(url, signal);
  if (page.mediaType === "text/html" || page.mediaType === "application/xhtml+xml") {
    const { title, markdown } = htmlToMarkdown(page.text, page.finalUrl);
    return formatPageContent(title, page.finalUrl, markdown);
  }
  return formatPageContent("", page.finalUrl, page.text.trim());
}

export async function readWebPage(input: WebReadInput) {
  const url = parsePageUrl(input.url);
  const maxChars =
    typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
      ? Math.max(MIN_WEB_READ_CHARS, Math.min(MAX_RUNTIME_TOOL_RESULT_CHARS, Math.round(input.maxChars)))
      : MAX_RUNTIME_TOOL_RESULT_CHARS;
  const signal = AbortSignal.any(
    [input.abortSignal, AbortSignal.timeout(WEB_READ_TIMEOUT_MS)].filter((entry): entry is AbortSignal => Boolean(entry))
  );
  signal.throwIfAborted();

  const providerReader = getWebPageReader(input.settings);
  let text: string;
  if (providerReader && input.settings) {
    try {
      text = await providerReader({
        url: url.toString(),
        maxChars,
        settings: input.settings,
        abortSignal: signal,
        timeout: WEB_READ_TIMEOUT_MS
      });
    } catch {
      signal.throwIfAborted();
      text = await readBuiltIn(url, signal);
    }
  } else {
    text = await readBuiltIn(url, signal);
  }
  return truncateText(text, maxChars);
}
