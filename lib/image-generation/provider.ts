import {
  DEFAULT_GOOGLE_NANO_BANANA_MODEL,
  DEFAULT_OPENAI_GPT_IMAGE_MODEL,
  DEFAULT_OPENAI_GPT_IMAGE_QUALITY,
  getImageGenerationReadinessError,
  type ImageGenerationProviderId
} from "@/lib/image-generation/catalog";
import type { RuntimeAppSettings } from "@/lib/types";
import { generateGoogleNanoBananaImages } from "./google-nano-banana";
import { generateOpenAiGptImages } from "./openai-gpt-image";
import type {
  CompiledImageInstruction,
  GenerateImageResult,
  ImageGenerationReferenceImage
} from "./types";

export interface ImageGenerationProvider {
  getReadinessError(settings: RuntimeAppSettings): string | null;
  generate(input: {
    settings: RuntimeAppSettings;
    instruction: CompiledImageInstruction;
    inputImages?: ImageGenerationReferenceImage[];
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
        model: input.settings.imageGeneration.configuration.model ?? DEFAULT_GOOGLE_NANO_BANANA_MODEL,
        instruction: input.instruction,
        inputImages: input.inputImages,
        abortSignal: input.abortSignal
      });
    }
  },
  openai_gpt_image: {
    getReadinessError(settings) {
      return getImageGenerationReadinessError(settings.imageGeneration);
    },
    generate(input) {
      return generateOpenAiGptImages({
        apiKey: input.settings.imageGeneration.credentials.apiKey ?? "",
        model: input.settings.imageGeneration.configuration.model ?? DEFAULT_OPENAI_GPT_IMAGE_MODEL,
        quality: input.settings.imageGeneration.configuration.quality ?? DEFAULT_OPENAI_GPT_IMAGE_QUALITY,
        instruction: input.instruction,
        inputImages: input.inputImages,
        abortSignal: input.abortSignal
      });
    }
  }
} satisfies Record<Exclude<ImageGenerationProviderId, "disabled">, ImageGenerationProvider>;

export function generateImages(input: {
  settings: RuntimeAppSettings;
  instruction: CompiledImageInstruction;
  inputImages?: ImageGenerationReferenceImage[];
  abortSignal?: AbortSignal;
}) {
  const providerId = input.settings.imageGeneration.providerId;
  if (providerId === "disabled") throw new Error("Image generation is disabled");
  const provider = IMAGE_GENERATION_PROVIDERS[providerId];
  const readinessError = provider.getReadinessError(input.settings);
  if (readinessError) throw new Error(readinessError);
  return provider.generate(input);
}
