import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  getImageGenerationReadinessError,
  type ImageGenerationProviderId
} from "@/lib/image-generation/catalog";
import type { RuntimeAppSettings } from "@/lib/types";
import { generateGoogleNanoBananaImages } from "./google-nano-banana";
import type { CompiledImageInstruction, GenerateImageResult } from "./types";

export interface ImageGenerationProvider {
  getReadinessError(settings: RuntimeAppSettings): string | null;
  generate(input: {
    settings: RuntimeAppSettings;
    instruction: CompiledImageInstruction;
    abortSignal?: AbortSignal;
  }): Promise<GenerateImageResult>;
}

const IMAGE_GENERATION_PROVIDERS = {
  google_nano_banana: {
    getReadinessError(settings) {
      return getImageGenerationReadinessError(settings.imageGeneration);
    },
    generate(input) {
      return generateGoogleNanoBananaImages({
        apiKey: input.settings.imageGeneration.credentials.apiKey ?? "",
        model: input.settings.imageGeneration.configuration.model ?? DEFAULT_IMAGE_GENERATION_MODEL,
        instruction: input.instruction,
        abortSignal: input.abortSignal
      });
    }
  }
} satisfies Record<Exclude<ImageGenerationProviderId, "disabled">, ImageGenerationProvider>;

export function generateImages(input: {
  settings: RuntimeAppSettings;
  instruction: CompiledImageInstruction;
  abortSignal?: AbortSignal;
}) {
  const providerId = input.settings.imageGeneration.providerId;
  if (providerId === "disabled") throw new Error("Image generation is disabled");
  const provider = IMAGE_GENERATION_PROVIDERS[providerId];
  const readinessError = provider.getReadinessError(input.settings);
  if (readinessError) throw new Error(readinessError);
  return provider.generate(input);
}
