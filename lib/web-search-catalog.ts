import { z } from "zod";

import type { IntegrationProviderDescriptor } from "@/lib/integration-types";

export const WEB_SEARCH_PROVIDER_IDS = ["disabled", "exa", "tavily", "searxng"] as const;
export type WebSearchProviderId = typeof WEB_SEARCH_PROVIDER_IDS[number];
export type WebSearchConfiguration = { baseUrl?: string };

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

export const webSearchIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({ providerId: z.literal("disabled"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({ providerId: z.literal("exa"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({ providerId: z.literal("tavily"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({
    providerId: z.literal("searxng"),
    configuration: z.object({ baseUrl: searxngBaseUrlSchema }).strict(),
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
  if (!isWebSearchProviderId(providerId)) return { providerId: "exa", configuration: {} };
  if (providerId !== "searxng") return { providerId, configuration: {} };
  const baseUrl = String(configuration.baseUrl ?? "").trim();
  try {
    new URL(baseUrl);
    return { providerId, configuration: { baseUrl } };
  } catch {
    return { providerId: "exa", configuration: {} };
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
