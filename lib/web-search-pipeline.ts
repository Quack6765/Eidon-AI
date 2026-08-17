import { throwIfChatTurnAborted } from "@/lib/chat-turn-control";
import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";
import { getLatestUserPromptContent } from "@/lib/prompt-analysis";
import { callProviderText } from "@/lib/provider";
import { searchWeb } from "@/lib/web-search";
import type { WebSearchPipelineMode } from "@/lib/web-search-catalog";
import type { PromptMessage, RuntimeAppSettings, RuntimeProviderProfile } from "@/lib/types";

export type WebSearchPipelinePlan =
  | { action: "direct" }
  | { action: "fan_out"; subqueries: string[] };

export type WebSearchPipelineStrategy = "direct" | "fan_out";

export type WebSearchPipelineResult = {
  resultSummary: string;
  strategy: WebSearchPipelineStrategy;
  plannedQueries: string[];
  succeeded: number;
  failed: number;
  duplicates: number;
};

export const WEB_SEARCH_PLANNING_TIMEOUT_MS = 15_000;
const PLANNING_USER_CONTEXT_MAX_CHARS = 2_000;
const RRF_K = 60;
const MIN_FAN_OUT_QUERIES = 2;

const TRACKING_URL_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "fbclid",
  "gclid",
  "msclkid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
  "spm",
  "vd_source",
  "si"
]);

const URL_PATTERN = /(https?:\/\/[^\s<>"'`]+)/g;

function combinedAbortSignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (!present.length) return undefined;
  if (present.length === 1) return present[0];
  const controller = new AbortController();
  const abort = () => {
    for (const signal of present) signal.removeEventListener("abort", abort);
    if (!controller.signal.aborted) {
      controller.abort(present.find((signal) => signal.aborted)?.reason);
    }
  };
  for (const signal of present) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

export function normalizeResultUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_URL_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    let normalized = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    const search = url.searchParams.toString();
    if (search) normalized += `?${search}`;
    return normalized;
  } catch {
    return null;
  }
}

function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  return matches.map((match) => match.replace(/[)\]},.;:!?]+$/, ""));
}

export function parsePlanningResponse(text: unknown): WebSearchPipelinePlan | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const candidates: string[] = [text.trim()];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.unshift(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const plan = parsed as { action?: unknown; subqueries?: unknown };
    if (plan.action === "direct") return { action: "direct" };
    if (plan.action !== "fan_out") continue;
    if (!Array.isArray(plan.subqueries)) continue;
    const subqueries = plan.subqueries
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (subqueries.length < MIN_FAN_OUT_QUERIES) continue;
    return { action: "fan_out", subqueries };
  }
  return null;
}

export function normalizeSubqueries(queries: string[], maxQueries: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
    if (normalized.length >= maxQueries) break;
  }
  return normalized;
}

const QUERY_CACHE_TTL_MS = 15 * 60 * 1000;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.7;
const DUPLICATE_MIN_WORDS = 5;

type CachedQueryEntry = { query: string; words: Set<string>; at: number };
const queryCache = new Map<string, Map<string, CachedQueryEntry>>();

export function clearWebSearchQueryCache() {
  queryCache.clear();
}

function queryWords(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  );
}

function normalizedQueryKey(query: string): string {
  return [...queryWords(query)].sort().join(" ");
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function findDuplicateQuery(scopeKey: string, query: string): string | null {
  const scope = queryCache.get(scopeKey);
  if (!scope) return null;
  const now = Date.now();
  const words = queryWords(query);
  const exact = scope.get(normalizedQueryKey(query));
  if (exact && now - exact.at <= QUERY_CACHE_TTL_MS) return exact.query;

  let best: { query: string; similarity: number } | null = null;
  for (const entry of scope.values()) {
    if (now - entry.at > QUERY_CACHE_TTL_MS) continue;
    if (words.size < DUPLICATE_MIN_WORDS || entry.words.size < DUPLICATE_MIN_WORDS) continue;
    const similarity = jaccardSimilarity(words, entry.words);
    if (!best || similarity > best.similarity) best = { query: entry.query, similarity };
  }
  return best && best.similarity >= DUPLICATE_SIMILARITY_THRESHOLD ? best.query : null;
}

function recordQuery(scopeKey: string, query: string) {
  let scope = queryCache.get(scopeKey);
  if (!scope) {
    scope = new Map();
    queryCache.set(scopeKey, scope);
  }
  scope.set(normalizedQueryKey(query), { query, words: queryWords(query), at: Date.now() });
}

function forgetQuery(scopeKey: string, query: string) {
  queryCache.get(scopeKey)?.delete(normalizedQueryKey(query));
}

export function buildPlanningPrompt(input: {
  query: string;
  userContext?: string;
  forceFanOut: boolean;
  maxQueries: number;
}): string {
  const userContext = (input.userContext ?? "").slice(0, PLANNING_USER_CONTEXT_MAX_CHARS).trim();
  const lines = [
    "You plan web searches for an AI assistant. The assistant wants to search the web."
  ];
  if (userContext) {
    lines.push("", "Latest user message:", userContext);
  }
  lines.push("", `Assistant's search query: "${input.query}"`, "");
  if (input.forceFanOut) {
    lines.push(
      "Split this search into parallel sub-queries that together cover everything needed to answer.",
      `Reply with ONLY minified JSON, no markdown fences, no extra text:`,
      `{"action":"fan_out","subqueries":["<query 1>","<query 2>",...]}`
    );
  } else {
    lines.push(
      "Decide how to execute this search:",
      '- "direct" if one straightforward search is enough: a single fact, entity, definition, price, score, date, or a navigational lookup.',
      '- "fan_out" if the question spans multiple distinct facets, comparisons, multiple entities, or if different phrasings would surface different sources.',
      "",
      "Reply with ONLY minified JSON, no markdown fences, no extra text:",
      '{"action":"direct"}',
      "or",
      '{"action":"fan_out","subqueries":["<query 1>","<query 2>",...]}'
    );
  }
  lines.push(
    "",
    "Sub-query rules:",
    `- Between ${MIN_FAN_OUT_QUERIES} and ${input.maxQueries} queries, each a standalone search-engine-style query.`,
    "- Each targets a DIFFERENT facet needed to answer; no near-duplicates.",
    "- Same language as the user's question. Keep each under roughly 12 words."
  );
  return lines.join("\n");
}

export async function planWebSearch(input: {
  providerProfile?: RuntimeProviderProfile;
  query: string;
  userContext?: string;
  forceFanOut: boolean;
  maxQueries: number;
  abortSignal?: AbortSignal;
}): Promise<WebSearchPipelinePlan> {
  if (!input.providerProfile) return { action: "direct" };
  try {
    const timeoutSignal = AbortSignal.timeout(WEB_SEARCH_PLANNING_TIMEOUT_MS);
    const text = await callProviderText({
      settings: input.providerProfile,
      prompt: buildPlanningPrompt({
        query: input.query,
        userContext: input.userContext,
        forceFanOut: input.forceFanOut,
        maxQueries: input.maxQueries
      }),
      purpose: "web_search_planning",
      abortSignal: combinedAbortSignal([input.abortSignal, timeoutSignal])
    });
    return parsePlanningResponse(text) ?? { action: "direct" };
  } catch {
    throwIfChatTurnAborted(input.abortSignal);
    return { action: "direct" };
  }
}

type FanOutSection = {
  query: string;
  status: "fulfilled" | "rejected";
  text: string;
  error?: string;
  duplicateOf?: string;
};

async function runSearchWithTimeout(input: {
  query: string;
  settings: RuntimeAppSettings;
  maxResults?: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const perSearchSignal = combinedAbortSignal([
    input.abortSignal,
    AbortSignal.timeout(input.timeoutMs)
  ]);
  return searchWeb({
    settings: input.settings,
    query: input.query,
    maxResults: input.maxResults,
    abortSignal: perSearchSignal,
    timeout: input.timeoutMs
  });
}

const MAX_CONCURRENT_SEARCHES = 4;
const SEARCH_RETRY_DELAY_MS = 400;

let activeConcurrentSearches = 0;
const searchSlotWaiters: Array<() => void> = [];

async function acquireSearchSlot(): Promise<void> {
  if (activeConcurrentSearches >= MAX_CONCURRENT_SEARCHES) {
    await new Promise<void>((resolve) => searchSlotWaiters.push(resolve));
    return;
  }
  activeConcurrentSearches += 1;
}

function releaseSearchSlot(): void {
  const next = searchSlotWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeConcurrentSearches = Math.max(0, activeConcurrentSearches - 1);
}

async function runSearchWithRetry(input: {
  query: string;
  settings: RuntimeAppSettings;
  maxResults?: number;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  await acquireSearchSlot();
  try {
    try {
      return await runSearchWithTimeout(input);
    } catch (error) {
      if (input.abortSignal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, SEARCH_RETRY_DELAY_MS));
      throwIfChatTurnAborted(input.abortSignal);
      return await runSearchWithTimeout(input);
    }
  } finally {
    releaseSearchSlot();
  }
}

export async function runWebSearchFanOut(input: {
  subqueries: string[];
  settings: RuntimeAppSettings;
  maxResults?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}): Promise<FanOutSection[]> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const results = await Promise.allSettled(
    input.subqueries.map((query) =>
      runSearchWithRetry({
        query,
        settings: input.settings,
        maxResults: input.maxResults,
        timeoutMs,
        abortSignal: input.abortSignal
      })
    )
  );
  throwIfChatTurnAborted(input.abortSignal);
  return results.map((result, index) => {
    const query = input.subqueries[index];
    if (result.status === "fulfilled") {
      return { query, status: "fulfilled" as const, text: result.value };
    }
    const reason = result.reason;
    const message =
      reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "search failed";
    return { query, status: "rejected" as const, text: "", error: truncateText(message, 200) };
  });
}

type SectionParagraph = {
  text: string;
  url?: string;
  rrf?: number;
};

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildSectionParagraphs(text: string): SectionParagraph[] {
  return splitIntoParagraphs(text).map((paragraphText) => {
    const firstUrl = extractUrls(paragraphText).map(normalizeResultUrl).find(Boolean);
    return firstUrl ? { text: paragraphText, url: firstUrl } : { text: paragraphText };
  });
}

function computeRrfScores(sections: Array<{ paragraphs: SectionParagraph[] }>): void {
  const rankBySection = sections.map((section) => {
    const ranks = new Map<string, number>();
    let rank = 0;
    for (const paragraph of section.paragraphs) {
      if (!paragraph.url || ranks.has(paragraph.url)) continue;
      rank += 1;
      ranks.set(paragraph.url, rank);
    }
    return ranks;
  });

  sections.forEach((section, sectionIndex) => {
    for (const paragraph of section.paragraphs) {
      if (!paragraph.url) continue;
      let score = 0;
      for (const ranks of rankBySection) {
        const rank = ranks.get(paragraph.url);
        if (rank) score += 1 / (RRF_K + rank);
      }
      paragraph.rrf = score;
    }
  });
}

export function fuseFanOutResults(
  sections: FanOutSection[],
  maxChars = MAX_RUNTIME_TOOL_RESULT_CHARS
): string {
  const succeededSections = sections.filter(
    (section) => section.status === "fulfilled" && !section.duplicateOf
  );
  const failedSections = sections.filter((section) => section.status === "rejected");
  const duplicateSections = sections.filter((section) => section.duplicateOf);
  const parsedSections = succeededSections.map((section) => ({
    ...section,
    paragraphs: buildSectionParagraphs(section.text)
  }));

  computeRrfScores(parsedSections);

  const seenUrls = new Set<string>();
  let duplicatesRemoved = 0;
  for (const section of parsedSections) {
    section.paragraphs = section.paragraphs.filter((paragraph) => {
      if (!paragraph.url) return true;
      if (seenUrls.has(paragraph.url)) {
        duplicatesRemoved += 1;
        return false;
      }
      seenUrls.add(paragraph.url);
      return true;
    });
  }

  const headerLines = [
    `Parallel web search results (${sections.length} queries: ${succeededSections.length} succeeded, ${failedSections.length} failed${
      duplicateSections.length
        ? `, ${duplicateSections.length} already searched this turn`
        : ""
    }${duplicatesRemoved ? `, ${duplicatesRemoved} duplicate result${duplicatesRemoved === 1 ? "" : "s"} removed` : ""}).`
  ];

  const bodyBudget = Math.max(1_000, maxChars - 500);
  const perSectionBudget = Math.max(200, Math.floor(bodyBudget / Math.max(1, parsedSections.length)));
  const sectionBlocks: string[] = [];

  for (const section of parsedSections) {
    let kept = section.paragraphs;
    let usedChars = kept.reduce((total, paragraph) => total + paragraph.text.length + 2, 0);
    if (usedChars > perSectionBudget) {
      const droppable = kept
        .filter((paragraph) => paragraph.url !== undefined)
        .sort((a, b) => (a.rrf ?? 0) - (b.rrf ?? 0));
      for (const paragraph of droppable) {
        if (usedChars <= perSectionBudget || kept.length <= 1) break;
        kept = kept.filter((candidate) => candidate !== paragraph);
        usedChars -= paragraph.text.length + 2;
      }
    }
    sectionBlocks.push(
      [`## Query: "${section.query}"`, truncateText(kept.map((paragraph) => paragraph.text).join("\n\n"), perSectionBudget)].join(
        "\n"
      )
    );
  }

  for (const section of failedSections) {
    sectionBlocks.push(`## Query: "${section.query}" (failed: ${section.error ?? "search failed"})`);
  }

  for (const section of duplicateSections) {
    sectionBlocks.push(
      `## Query: "${section.query}" (already searched this turn as "${section.duplicateOf}" — see its results above)`
    );
  }

  return truncateText([...headerLines, "", ...sectionBlocks].join("\n\n"), maxChars);
}

export async function runWebSearchPipeline(input: {
  query?: string;
  queries?: string[];
  mode: WebSearchPipelineMode;
  maxQueries: number;
  maxResults?: number;
  settings: RuntimeAppSettings;
  providerProfile?: RuntimeProviderProfile;
  userContext?: string;
  mcpTimeout?: number;
  abortSignal?: AbortSignal;
  assistantMessageId?: string;
  conversationId?: string;
}): Promise<WebSearchPipelineResult> {
  throwIfChatTurnAborted(input.abortSignal);

  const scopeKey = input.mode === "off"
    ? undefined
    : input.assistantMessageId ?? input.conversationId;

  const explicitQueries = normalizeSubqueries(input.queries ?? [], input.maxQueries);
  let strategy: WebSearchPipelineStrategy;
  let plannedQueries: string[];

  if (input.mode === "off") {
    strategy = "direct";
    plannedQueries = [input.query || explicitQueries[0] || ""].filter(Boolean);
  } else if (explicitQueries.length >= MIN_FAN_OUT_QUERIES) {
    strategy = "fan_out";
    plannedQueries = explicitQueries;
  } else {
    const plan = await planWebSearch({
      providerProfile: input.providerProfile,
      query: input.query || explicitQueries[0] || "",
      userContext: input.userContext,
      forceFanOut: input.mode === "always",
      maxQueries: input.maxQueries,
      abortSignal: input.abortSignal
    });
    const subqueries = plan.action === "fan_out"
      ? normalizeSubqueries(plan.subqueries, input.maxQueries)
      : [];
    if (subqueries.length >= MIN_FAN_OUT_QUERIES) {
      strategy = "fan_out";
      plannedQueries = subqueries;
    } else {
      strategy = "direct";
      plannedQueries = [input.query || explicitQueries[0] || ""].filter(Boolean);
    }
  }

  if (strategy === "direct") {
    const query = plannedQueries[0];
    if (!query) {
      throw new Error("query is required");
    }
    if (scopeKey) {
      const duplicateOf = findDuplicateQuery(scopeKey, query);
      if (duplicateOf) {
        return {
          resultSummary: `Skipped search: this query is a near-duplicate of "${duplicateOf}" which was already searched earlier in this turn. Its results are already in the conversation above. Refine the query if you need different information, or answer using the results you already have.`,
          strategy,
          plannedQueries: [query],
          succeeded: 0,
          failed: 0,
          duplicates: 1
        };
      }
    }
    const resultSummary = truncateText(
      await runSearchWithRetry({
        query,
        settings: input.settings,
        maxResults: input.maxResults,
        timeoutMs: input.mcpTimeout ?? 120_000,
        abortSignal: input.abortSignal
      }),
      MAX_RUNTIME_TOOL_RESULT_CHARS
    );
    if (scopeKey) recordQuery(scopeKey, query);
    return { resultSummary, strategy, plannedQueries: [query], succeeded: 1, failed: 0, duplicates: 0 };
  }

  const freshSubqueries: string[] = [];
  const duplicateOfByQuery = new Map<string, string>();
  for (const subquery of plannedQueries) {
    const duplicateOf = scopeKey ? findDuplicateQuery(scopeKey, subquery) : null;
    if (duplicateOf) {
      duplicateOfByQuery.set(subquery, duplicateOf);
    } else {
      if (scopeKey) recordQuery(scopeKey, subquery);
      freshSubqueries.push(subquery);
    }
  }

  const freshSections = await runWebSearchFanOut({
    subqueries: freshSubqueries,
    settings: input.settings,
    maxResults: input.maxResults,
    timeoutMs: input.mcpTimeout,
    abortSignal: input.abortSignal
  });
  for (const section of freshSections) {
    if (section.status === "rejected" && scopeKey) {
      forgetQuery(scopeKey, section.query);
    }
  }

  const sections: FanOutSection[] = plannedQueries.map((query) => {
    const duplicateOf = duplicateOfByQuery.get(query);
    if (duplicateOf) return { query, status: "fulfilled" as const, text: "", duplicateOf };
    return freshSections.find((section) => section.query === query)!;
  });

  const succeeded = sections.filter(
    (section) => section.status === "fulfilled" && !section.duplicateOf
  ).length;
  const duplicates = sections.filter((section) => section.duplicateOf).length;
  const failed = sections.length - succeeded - duplicates;
  if (!succeeded && !duplicates) {
    const firstError = sections.find((section) => section.error)?.error ?? "search failed";
    throw new Error(`All ${sections.length} web searches failed: ${firstError}`);
  }

  return {
    resultSummary: fuseFanOutResults(sections),
    strategy,
    plannedQueries,
    succeeded,
    failed,
    duplicates
  };
}

export function getPipelineUserContext(promptMessages: PromptMessage[] | undefined): string {
  if (!promptMessages?.length) return "";
  return getLatestUserPromptContent(promptMessages);
}
