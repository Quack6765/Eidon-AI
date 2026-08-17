import { z } from "zod";

import type { IntegrationProviderDescriptor } from "@/lib/integration-types";

export const WEB_SEARCH_PROVIDER_IDS = ["disabled", "exa", "tavily", "searxng"] as const;
export type WebSearchProviderId = typeof WEB_SEARCH_PROVIDER_IDS[number];

export const WEB_SEARCH_PIPELINE_MODES = ["auto", "always", "off"] as const;
export type WebSearchPipelineMode = typeof WEB_SEARCH_PIPELINE_MODES[number];

export type WebSearchPipelineConfiguration = {
  mode: WebSearchPipelineMode;
  maxQueries?: number;
};

export type WebSearchConfiguration = {
  baseUrl?: string;
  pipeline?: WebSearchPipelineConfiguration;
};

export const DEFAULT_WEB_SEARCH_PIPELINE: WebSearchPipelineConfiguration = {
  mode: "auto",
  maxQueries: 4
};

export function normalizeWebSearchPipeline(value: unknown): WebSearchPipelineConfiguration {
  if (!value || typeof value !== "object") return { ...DEFAULT_WEB_SEARCH_PIPELINE };
  const candidate = value as Partial<WebSearchPipelineConfiguration>;
  const maxQueries = candidate.maxQueries;
  return {
    mode: WEB_SEARCH_PIPELINE_MODES.includes(candidate.mode as WebSearchPipelineMode)
      ? (candidate.mode as WebSearchPipelineMode)
      : DEFAULT_WEB_SEARCH_PIPELINE.mode,
    maxQueries:
      typeof maxQueries === "number" && Number.isFinite(maxQueries)
        ? Math.max(1, Math.min(5, Math.round(maxQueries)))
        : DEFAULT_WEB_SEARCH_PIPELINE.maxQueries
  };
}

export function getWebSearchPipeline(
  configuration: WebSearchConfiguration | undefined
): WebSearchPipelineConfiguration {
  return configuration?.pipeline
    ? normalizeWebSearchPipeline(configuration.pipeline)
    : { ...DEFAULT_WEB_SEARCH_PIPELINE };
}

const credentialFields = {
  credential: z.string().optional(),
  credentialAction: z.enum(["preserve", "replace", "clear"]).default("preserve")
};

export const searxngBaseUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.username === ""
      && url.password === ""
      && url.hash === "";
  } catch {
    return false;
  }
}, "SearXNG base URL must be an http(s) URL without credentials or fragments.");

const webSearchPipelineSchema = z.object({
  mode: z.enum(WEB_SEARCH_PIPELINE_MODES).default("auto"),
  maxQueries: z.number().int().min(1).max(5).optional()
});

export const webSearchIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({
    providerId: z.literal("disabled"),
    configuration: z.object({ pipeline: webSearchPipelineSchema.optional() }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("exa"),
    configuration: z.object({ pipeline: webSearchPipelineSchema.optional() }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("tavily"),
    configuration: z.object({ pipeline: webSearchPipelineSchema.optional() }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("searxng"),
    configuration: z.object({ baseUrl: searxngBaseUrlSchema, pipeline: webSearchPipelineSchema.optional() }).strict(),
    ...credentialFields
  }).strict()
]);

export type WebSearchIntegrationUpdate = z.infer<typeof webSearchIntegrationUpdateSchema>;

export function getWebSearchEndpointUrl(
  update: WebSearchIntegrationUpdate | undefined
): string | null {
  if (update?.providerId !== "searxng") return null;
  return update.configuration.baseUrl;
}

export const WEB_SEARCH_PROVIDER_CATALOG = {
  disabled: {
    label: "Disabled",
    requiresCredential: false,
    getReadinessError: () => "Web search is disabled"
  },
  exa: {
    label: "Exa",
    requiresCredential: false,
    getReadinessError: () => null
  },
  tavily: {
    label: "Tavily",
    requiresCredential: true,
    getReadinessError: ({ credentials }) => credentials.apiKey?.trim()
      ? null
      : "Tavily API key is required."
  },
  searxng: {
    label: "SearXNG",
    requiresCredential: false,
    getReadinessError: ({ configuration }) => {
      const baseUrl = String(configuration.baseUrl ?? "").trim();
      if (!baseUrl) return "SearXNG base URL is required.";
      try {
        new URL(baseUrl);
        return null;
      } catch {
        return "SearXNG base URL must be valid.";
      }
    }
  }
} satisfies Record<
  WebSearchProviderId,
  IntegrationProviderDescriptor<WebSearchConfiguration>
>;

export function isWebSearchProviderId(value: string): value is WebSearchProviderId {
  return value in WEB_SEARCH_PROVIDER_CATALOG;
}

export function normalizeWebSearchSelection(
  providerId: string,
  configuration: Record<string, unknown>
): { providerId: WebSearchProviderId; configuration: WebSearchConfiguration } {
  const pipeline = normalizeWebSearchPipeline(configuration.pipeline);
  if (!isWebSearchProviderId(providerId)) {
    return { providerId: "exa", configuration: { pipeline } };
  }
  if (providerId !== "searxng") return { providerId, configuration: { pipeline } };
  const baseUrl = String(configuration.baseUrl ?? "").trim();
  try {
    new URL(baseUrl);
    return { providerId, configuration: { baseUrl, pipeline } };
  } catch {
    return { providerId: "exa", configuration: { pipeline } };
  }
}

export function getWebSearchReadinessError(input: {
  providerId: WebSearchProviderId;
  configuration: WebSearchConfiguration;
  credentials: { apiKey?: string };
}) {
  return WEB_SEARCH_PROVIDER_CATALOG[input.providerId].getReadinessError(input);
}

export function isWebSearchConfigured(input: {
  providerId: WebSearchProviderId;
  configuration: WebSearchConfiguration;
  credentials: { apiKey?: string };
}) {
  if (input.providerId === "disabled") return true;
  return getWebSearchReadinessError(input) === null;
}
