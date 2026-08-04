import { z } from "zod";

import type { IntegrationProviderDescriptor } from "@/lib/integration-types";

export const IMAGE_GENERATION_MODEL_IDS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview"
] as const;
export type ImageGenerationModelId = typeof IMAGE_GENERATION_MODEL_IDS[number];

export const IMAGE_GENERATION_PROVIDER_IDS = ["disabled", "google_nano_banana"] as const;
export type ImageGenerationProviderId = typeof IMAGE_GENERATION_PROVIDER_IDS[number];
export type ImageGenerationConfiguration = { model?: ImageGenerationModelId };

export const DEFAULT_IMAGE_GENERATION_MODEL: ImageGenerationModelId =
  "gemini-3.1-flash-image-preview";

export const IMAGE_GENERATION_MODEL_OPTIONS = [
  { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image" },
  { value: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview" },
  { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview" }
] as const satisfies ReadonlyArray<{ value: ImageGenerationModelId; label: string }>;

const credentialFields = {
  credential: z.string().optional(),
  credentialAction: z.enum(["preserve", "replace", "clear"]).default("preserve")
};

export const imageGenerationIntegrationUpdateSchema = z.discriminatedUnion("providerId", [
  z.object({ providerId: z.literal("disabled"), configuration: z.object({}).strict(), ...credentialFields }).strict(),
  z.object({
    providerId: z.literal("google_nano_banana"),
    configuration: z.object({ model: z.enum(IMAGE_GENERATION_MODEL_IDS) }).strict(),
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
  }
} satisfies Record<
  ImageGenerationProviderId,
  IntegrationProviderDescriptor<ImageGenerationConfiguration>
>;

export function isImageGenerationProviderId(value: string): value is ImageGenerationProviderId {
  return value in IMAGE_GENERATION_PROVIDER_CATALOG;
}

function isImageGenerationModelId(value: unknown): value is ImageGenerationModelId {
  return typeof value === "string" && IMAGE_GENERATION_MODEL_IDS.includes(
    value as ImageGenerationModelId
  );
}

export function normalizeImageGenerationSelection(
  providerId: string,
  configuration: Record<string, unknown>
): { providerId: ImageGenerationProviderId; configuration: ImageGenerationConfiguration } {
  if (providerId !== "google_nano_banana") {
    return { providerId: "disabled", configuration: {} };
  }
  return {
    providerId,
    configuration: {
      model: isImageGenerationModelId(configuration.model)
        ? configuration.model
        : DEFAULT_IMAGE_GENERATION_MODEL
    }
  };
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
