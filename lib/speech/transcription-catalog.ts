import { z } from "zod";

import type { IntegrationProviderDescriptor } from "@/lib/integration-types";
import {
  EXTERNAL_STT_LANGUAGE_CODES,
  EXTERNAL_STT_PROVIDERS,
  type ExternalSttLanguage,
  type SttProvider
} from "@/lib/speech/external-providers";

export type TranscriptionProviderId = "browser" | "canary" | SttProvider;
export type TranscriptionConfiguration = {
  language: "auto" | "en" | "fr" | "es" | ExternalSttLanguage;
};
export type SttEngine = "browser" | "embedded" | "external";

const credentialFields = {
  credential: z.string().optional(),
  credentialAction: z.enum(["preserve", "replace", "clear"]).default("preserve")
};

export const speechTranscriptionIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({
    providerId: z.literal("browser"),
    configuration: z.object({ language: z.enum(["auto", "en", "fr", "es"]) }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("canary"),
    configuration: z.object({ language: z.enum(["en", "fr", "es"]) }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("elevenlabs"),
    configuration: z.object({ language: z.enum(EXTERNAL_STT_LANGUAGE_CODES) }).strict(),
    ...credentialFields
  }).strict()
]);

const externalProviders = Object.fromEntries(
  Object.entries(EXTERNAL_STT_PROVIDERS).map(([providerId, provider]) => [
    providerId,
    {
      label: provider.label,
      engine: "external" as const,
      requiresCredential: true,
      getReadinessError: ({ credentials }: {
        configuration: TranscriptionConfiguration;
        credentials: { apiKey?: string };
      }) => credentials.apiKey?.trim()
        ? null
        : `${provider.label} API key is required.`
    }
  ])
) as Record<SttProvider, IntegrationProviderDescriptor<TranscriptionConfiguration> & {
  engine: "external";
}>;

export const TRANSCRIPTION_PROVIDER_CATALOG = {
  browser: {
    label: "Browser speech recognition",
    engine: "browser",
    requiresCredential: false,
    getReadinessError: () => null
  },
  canary: {
    label: "Canary 180M Flash",
    engine: "embedded",
    requiresCredential: false,
    getReadinessError: ({ configuration }) => configuration.language === "auto"
      ? "Canary transcription requires English, French, or Spanish."
      : null
  },
  ...externalProviders
} satisfies Record<
  TranscriptionProviderId,
  IntegrationProviderDescriptor<TranscriptionConfiguration> & { engine: SttEngine }
>;

export function isTranscriptionProviderId(value: string): value is TranscriptionProviderId {
  return value in TRANSCRIPTION_PROVIDER_CATALOG;
}

function normalizeLocalLanguage(value: unknown, allowAuto: boolean) {
  if (value === "en" || value === "fr" || value === "es") return value;
  return allowAuto ? "auto" as const : "en" as const;
}

export function normalizeTranscriptionSelection(
  providerId: string,
  configuration: Record<string, unknown>
): { providerId: TranscriptionProviderId; configuration: TranscriptionConfiguration } {
  if (!isTranscriptionProviderId(providerId)) {
    return { providerId: "browser", configuration: { language: "auto" } };
  }
  if (providerId === "browser") {
    return {
      providerId,
      configuration: { language: normalizeLocalLanguage(configuration.language, true) }
    };
  }
  if (providerId === "canary") {
    return {
      providerId,
      configuration: { language: normalizeLocalLanguage(configuration.language, false) }
    };
  }
  const provider = EXTERNAL_STT_PROVIDERS[providerId];
  const language = provider.languages.some((entry) => entry.value === configuration.language)
    ? configuration.language as ExternalSttLanguage
    : provider.languages[0].value;
  return { providerId, configuration: { language } };
}

export function getTranscriptionReadinessError(input: {
  providerId: TranscriptionProviderId;
  configuration: TranscriptionConfiguration;
  credentials: { apiKey?: string };
}) {
  return TRANSCRIPTION_PROVIDER_CATALOG[input.providerId].getReadinessError(input);
}

export function isTranscriptionConfigured(input: {
  providerId: TranscriptionProviderId;
  configuration: TranscriptionConfiguration;
  credentials: { apiKey?: string };
}) {
  return getTranscriptionReadinessError(input) === null;
}
