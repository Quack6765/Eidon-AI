import { z } from "zod";

import type { IntegrationProviderDescriptor } from "@/lib/integration-types";

export const GOOGLE_NANO_BANANA_MODEL_IDS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview"
] as const;
export const OPENAI_GPT_IMAGE_MODEL_IDS = ["gpt-image-2"] as const;
export const IMAGE_GENERATION_MODEL_IDS = [
  ...GOOGLE_NANO_BANANA_MODEL_IDS,
  ...OPENAI_GPT_IMAGE_MODEL_IDS
] as const;
export type ImageGenerationModelId = typeof IMAGE_GENERATION_MODEL_IDS[number];

export const OPENAI_GPT_IMAGE_QUALITIES = ["auto", "low", "medium", "high"] as const;
export type OpenAiGptImageQuality = typeof OPENAI_GPT_IMAGE_QUALITIES[number];

export const IMAGE_GENERATION_PROVIDER_IDS = ["disabled", "google_nano_banana", "openai_gpt_image"] as const;
export type ImageGenerationProviderId = typeof IMAGE_GENERATION_PROVIDER_IDS[number];
export type ImageGenerationConfiguration = {
  model?: ImageGenerationModelId;
  quality?: OpenAiGptImageQuality;
};

export const DEFAULT_GOOGLE_NANO_BANANA_MODEL: ImageGenerationModelId =
  "gemini-3.1-flash-image-preview";
export const DEFAULT_OPENAI_GPT_IMAGE_MODEL: ImageGenerationModelId = "gpt-image-2";
export const DEFAULT_OPENAI_GPT_IMAGE_QUALITY: OpenAiGptImageQuality = "auto";

export const GOOGLE_NANO_BANANA_MODEL_OPTIONS = [
  { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
  { value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview" },
  { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" }
] as const satisfies ReadonlyArray<{ value: ImageGenerationModelId; label: string }>;

export const OPENAI_GPT_IMAGE_MODEL_OPTIONS = [
  { value: "gpt-image-2", label: "GPT Image 2" }
] as const satisfies ReadonlyArray<{ value: ImageGenerationModelId; label: string }>;

export const OPENAI_GPT_IMAGE_QUALITY_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
] as const satisfies ReadonlyArray<{ value: OpenAiGptImageQuality; label: string }>;

export function getImageGenerationModelOptions(
  providerId: ImageGenerationProviderId
): ReadonlyArray<{ value: ImageGenerationModelId; label: string }> {
  if (providerId === "google_nano_banana") return GOOGLE_NANO_BANANA_MODEL_OPTIONS;
  if (providerId === "openai_gpt_image") return OPENAI_GPT_IMAGE_MODEL_OPTIONS;
  return [];
}

export function getDefaultImageGenerationConfiguration(
  providerId: ImageGenerationProviderId
): ImageGenerationConfiguration {
  if (providerId === "google_nano_banana") {
    return { model: DEFAULT_GOOGLE_NANO_BANANA_MODEL };
  }
  if (providerId === "openai_gpt_image") {
    return { model: DEFAULT_OPENAI_GPT_IMAGE_MODEL, quality: DEFAULT_OPENAI_GPT_IMAGE_QUALITY };
  }
  return {};
}

const credentialFields = {
  credential: z.string().optional(),
  credentialAction: z.enum(["preserve", "replace", "clear"]).default("preserve")
};

export const imageGenerationIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({ providerId: z.literal("disabled"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({
    providerId: z.literal("google_nano_banana"),
    configuration: z.object({ model: z.enum(GOOGLE_NANO_BANANA_MODEL_IDS) }).strict(),
    ...credentialFields
  }).strict(),
  z.object({
    providerId: z.literal("openai_gpt_image"),
    configuration: z.object({
      model: z.enum(OPENAI_GPT_IMAGE_MODEL_IDS),
      quality: z.enum(OPENAI_GPT_IMAGE_QUALITIES).optional()
    }).strict(),
    ...credentialFields
  }).strict()
]);

export const IMAGE_GENERATION_PROVIDER_CATALOG = {
  disabled: {
    label: "Disabled",
    requiresCredential: false,
    getReadinessError: () => "Image generation is disabled"
  },
  google_nano_banana: {
    label: "Google Nano Banana",
    requiresCredential: true,
    getReadinessError: ({ credentials }) => credentials.apiKey?.trim()
      ? null
      : "The configured image generation provider requires an API key"
  },
  openai_gpt_image: {
    label: "OpenAI GPT Image",
    requiresCredential: true,
    getReadinessError: ({ credentials }) => credentials.apiKey?.trim()
      ? null
      : "The configured image generation provider requires an API key"
  }
} satisfies Record<
  ImageGenerationProviderId,
  IntegrationProviderDescriptor<ImageGenerationConfiguration>
>;

export function isImageGenerationProviderId(value: string): value is ImageGenerationProviderId {
  return value in IMAGE_GENERATION_PROVIDER_CATALOG;
}

function isGoogleNanoBananaModelId(value: unknown): value is typeof GOOGLE_NANO_BANANA_MODEL_IDS[number] {
  return typeof value === "string" && GOOGLE_NANO_BANANA_MODEL_IDS.includes(
    value as typeof GOOGLE_NANO_BANANA_MODEL_IDS[number]
  );
}

function isOpenAiGptImageModelId(value: unknown): value is typeof OPENAI_GPT_IMAGE_MODEL_IDS[number] {
  return typeof value === "string" && OPENAI_GPT_IMAGE_MODEL_IDS.includes(
    value as typeof OPENAI_GPT_IMAGE_MODEL_IDS[number]
  );
}

function isOpenAiGptImageQuality(value: unknown): value is OpenAiGptImageQuality {
  return typeof value === "string" && OPENAI_GPT_IMAGE_QUALITIES.includes(
    value as OpenAiGptImageQuality
  );
}

export function normalizeImageGenerationSelection(
  providerId: string,
  configuration: Record<string, unknown>
): { providerId: ImageGenerationProviderId; configuration: ImageGenerationConfiguration } {
  if (providerId === "google_nano_banana") {
    return {
      providerId,
      configuration: {
        model: isGoogleNanoBananaModelId(configuration.model)
          ? configuration.model
          : DEFAULT_GOOGLE_NANO_BANANA_MODEL
      }
    };
  }
  if (providerId === "openai_gpt_image") {
    return {
      providerId,
      configuration: {
        model: isOpenAiGptImageModelId(configuration.model)
          ? configuration.model
          : DEFAULT_OPENAI_GPT_IMAGE_MODEL,
        quality: isOpenAiGptImageQuality(configuration.quality)
          ? configuration.quality
          : DEFAULT_OPENAI_GPT_IMAGE_QUALITY
      }
    };
  }
  return { providerId: "disabled", configuration: {} };
}

export function getImageGenerationReadinessError(input: {
  providerId: ImageGenerationProviderId;
  configuration: ImageGenerationConfiguration;
  credentials: { apiKey?: string };
}) {
  return IMAGE_GENERATION_PROVIDER_CATALOG[input.providerId].getReadinessError(input);
}

export function isImageGenerationConfigured(input: {
  providerId: ImageGenerationProviderId;
  configuration: ImageGenerationConfiguration;
  credentials: { apiKey?: string };
}) {
  if (input.providerId === "disabled") return true;
  return getImageGenerationReadinessError(input) === null;
}
