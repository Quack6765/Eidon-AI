import OpenAI, { toFile } from "openai";
import type { ImageGenerateParams } from "openai/resources";
import {
  DEFAULT_OPENAI_GPT_IMAGE_MODEL,
  DEFAULT_OPENAI_GPT_IMAGE_QUALITY,
  type OpenAiGptImageQuality
} from "@/lib/image-generation/catalog";
import type {
  CompiledImageInstruction,
  GenerateImageResult,
  ImageGenerationReferenceImage
} from "./types";
import { renameGeneratedImages } from "./generated-filenames";

const ASPECT_RATIO_SIZES: Record<CompiledImageInstruction["aspectRatio"], string> = {
  "1:1": "1024x1024",
  "16:9": "1536x864",
  "9:16": "864x1536",
  "4:3": "1280x960",
  "3:4": "960x1280"
};

function buildPrompt(instruction: CompiledImageInstruction) {
  return instruction.negativePrompt
    ? `${instruction.imagePrompt}\n\nAvoid: ${instruction.negativePrompt}`
    : instruction.imagePrompt;
}

function buildEditPrompt(instruction: CompiledImageInstruction) {
  const directive = `Apply this edit to the provided image, preserving its composition, layout, text, and style except for what the edit changes: ${instruction.imagePrompt}`;
  return instruction.negativePrompt
    ? `${directive}\n\nAvoid: ${instruction.negativePrompt}`
    : directive;
}

export async function generateOpenAiGptImages(input: {
  apiKey: string;
  model?: string;
  quality?: OpenAiGptImageQuality;
  instruction: CompiledImageInstruction;
  inputImages?: ImageGenerationReferenceImage[];
  abortSignal?: AbortSignal;
}): Promise<GenerateImageResult> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const response = input.inputImages?.length
    ? await client.images.edit({
        model: input.model ?? DEFAULT_OPENAI_GPT_IMAGE_MODEL,
        prompt: buildEditPrompt(input.instruction),
        image: await Promise.all(input.inputImages.map((image) =>
          toFile(new Uint8Array(image.bytes), image.filename, { type: image.mimeType })
        )),
        n: input.instruction.count,
        quality: input.quality ?? DEFAULT_OPENAI_GPT_IMAGE_QUALITY
      }, { signal: input.abortSignal })
    : await client.images.generate({
        model: input.model ?? DEFAULT_OPENAI_GPT_IMAGE_MODEL,
        prompt: buildPrompt(input.instruction),
        n: input.instruction.count,
        size: ASPECT_RATIO_SIZES[input.instruction.aspectRatio] as ImageGenerateParams["size"],
        quality: input.quality ?? DEFAULT_OPENAI_GPT_IMAGE_QUALITY
      }, { signal: input.abortSignal });

  const images = renameGeneratedImages((response.data ?? [])
    .filter((item): item is { b64_json: string } => Boolean(item?.b64_json))
    .map((item, index) => ({
      bytes: Buffer.from(item.b64_json, "base64"),
      mimeType: "image/png",
      filename: `generated-${index + 1}.png`
    })));

  if (!images.length) {
    throw new Error("OpenAI GPT Image returned no images");
  }

  return {
    assistantText: input.instruction.assistantText || "",
    images
  };
}
