import type { RuntimeAppSettings } from "@/lib/types";
import { generateGoogleNanoBananaImages } from "./google-nano-banana";
import type { CompiledImageInstruction, GenerateImageResult } from "./types";

export interface ImageGenerationProvider {
  generate(input: {
    settings: RuntimeAppSettings;
    instruction: CompiledImageInstruction;
    abortSignal?: AbortSignal;
  }): Promise<GenerateImageResult>;
}

const IMAGE_GENERATION_PROVIDERS = {
  google_nano_banana: {
    generate(input) {
      return generateGoogleNanoBananaImages({
        apiKey: input.settings.imageGeneration.credentials.apiKey ?? "",
        model: input.settings.imageGeneration.configuration.model ??
          "gemini-3.1-flash-image-preview",
        instruction: input.instruction,
        abortSignal: input.abortSignal
      });
    }
  }
} satisfies Record<Exclude<RuntimeAppSettings["imageGeneration"]["providerId"], "disabled">, ImageGenerationProvider>;

export function generateImages(input: {
  settings: RuntimeAppSettings;
  instruction: CompiledImageInstruction;
  abortSignal?: AbortSignal;
}) {
  if (input.settings.imageGeneration.providerId === "disabled") {
    throw new Error("Image generation is disabled");
  }
  return IMAGE_GENERATION_PROVIDERS[input.settings.imageGeneration.providerId].generate(input);
}
