import { z } from "zod";

import type { IntegrationProviderDescriptor } from "@/lib/integration-types";
import {
  EXTERNAL_STT_PROVIDERS,
  EXTERNAL_STT_PROVIDER_IDS,
  type ExternalSttLanguage,
  type ExternalSttModel,
  getExternalSttDefaultModel,
  getExternalSttLanguageCodes,
  getExternalSttLanguageOptions,
  isExternalSttModelForProvider,
  isExternalSttMultiLanguage,
  type SttProvider
} from "@/lib/speech/external-providers";

export type TranscriptionProviderId = "browser" | "canary" | SttProvider;
export type TranscriptionConfiguration = {
  language: "auto" | "en" | "fr" | "es" | ExternalSttLanguage;
  model?: ExternalSttModel;
};
export type SttEngine = "browser" | "embedded" | "external";

const credentialFields = {
  credential: z.string().optional(),
  credentialAction: z.enum(["preserve", "replace", "clear"]).default("preserve")
};

function createExternalSttConfigurationSchema(providerId: SttProvider) {
  const provider = EXTERNAL_STT_PROVIDERS[providerId];
  const multiLanguage = isExternalSttMultiLanguage(providerId);
  if (!("modelOptions" in provider)) {
    const language = multiLanguage
      ? z.array(z.enum(getExternalSttLanguageCodes(providerId)))
      : z.enum(getExternalSttLanguageCodes(providerId));
    return z.object({ language }).strict() as z.ZodType<TranscriptionConfiguration>;
  }
  const modelSchemas = provider.modelOptions.map((model) => {
    const language = multiLanguage
      ? z.array(z.enum(getExternalSttLanguageCodes(providerId, model.value)))
      : z.enum(getExternalSttLanguageCodes(providerId, model.value));
    return z.object({
      model: z.literal(model.value),
      language
    }).strict();
  });
  if (modelSchemas.length === 1) {
    return modelSchemas[0] as z.ZodType<TranscriptionConfiguration>;
  }
  return z.union(modelSchemas as unknown as [
    z.ZodTypeAny,
    z.ZodTypeAny,
    ...z.ZodTypeAny[]
  ]) as z.ZodType<TranscriptionConfiguration>;
}

function createExternalSttUpdateSchema<Provider extends SttProvider>(providerId: Provider) {
  return z.object({
    providerId: z.literal(providerId),
    configuration: createExternalSttConfigurationSchema(providerId),
    ...credentialFields
  }).strict();
}

const externalSttUpdateSchemas = EXTERNAL_STT_PROVIDER_IDS.map(
  createExternalSttUpdateSchema
);

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
  ...externalSttUpdateSchemas
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
  const model = isExternalSttModelForProvider(providerId, configuration.model)
    ? configuration.model
    : getExternalSttDefaultModel(providerId);
  if (isExternalSttMultiLanguage(providerId)) {
    const validCodes = new Set<string>(getExternalSttLanguageCodes(providerId, model));
    const raw = Array.isArray(configuration.language) ? configuration.language : [];
    const language = raw.filter(
      (code): code is string => typeof code === "string" && validCodes.has(code)
    ) as unknown as ExternalSttLanguage;
    return {
      providerId,
      configuration: { language, ...(model ? { model } : {}) }
    };
  }
  const languages = getExternalSttLanguageOptions(providerId, model);
  const language = languages.some((entry) => entry.value === configuration.language)
    ? configuration.language as ExternalSttLanguage
    : languages[0].value as ExternalSttLanguage;
  return {
    providerId,
    configuration: { language, ...(model ? { model } : {}) }
  };
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
