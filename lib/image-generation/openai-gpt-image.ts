import OpenAI, { toFile } from "openai";
import type { ImageEditParams, ImageEditParamsNonStreaming, ImageGenerateParams } from "openai/resources";
import {
  DEFAULT_OPENAI_GPT_IMAGE_MODEL,
  DEFAULT_OPENAI_GPT_IMAGE_QUALITY,
  type OpenAiGptImageQuality
} from "@/lib/image-generation/catalog";
import { composeImagePrompt } from "./prompt-composer";
import { orderReferenceImages } from "./slots";
import type {
  CompiledImageInstruction,
  GenerateImageResult,
  ImageGenerationEditMask,
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

export async function generateOpenAiGptImages(input: {
  apiKey: string;
  model?: string;
  quality?: OpenAiGptImageQuality;
  instruction: CompiledImageInstruction;
  inputImages?: ImageGenerationReferenceImage[];
  mask?: ImageGenerationEditMask;
  abortSignal?: AbortSignal;
}): Promise<GenerateImageResult> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const model = input.model ?? DEFAULT_OPENAI_GPT_IMAGE_MODEL;
  const quality = (input.quality ?? DEFAULT_OPENAI_GPT_IMAGE_QUALITY) as ImageEditParams["quality"];
  const slots = orderReferenceImages(input.inputImages ?? []);

  const response = slots.length
    ? await client.images.edit(await buildEditParams({
        model,
        quality,
        instruction: input.instruction,
        slots,
        mask: input.mask
      }), { signal: input.abortSignal })
    : await client.images.generate({
        model,
        prompt: composeImagePrompt({ instruction: input.instruction }),
        n: input.instruction.count,
        size: ASPECT_RATIO_SIZES[input.instruction.aspectRatio] as ImageGenerateParams["size"],
        quality
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

async function buildEditParams(input: {
  model: string;
  quality: ImageEditParams["quality"];
  instruction: CompiledImageInstruction;
  slots: ImageGenerationReferenceImage[];
  mask?: ImageGenerationEditMask;
}): Promise<ImageEditParamsNonStreaming> {
  const params: ImageEditParamsNonStreaming = {
    model: input.model,
    prompt: composeImagePrompt({ instruction: input.instruction, slots: input.slots }),
    image: await Promise.all(input.slots.map((image) =>
      toFile(new Uint8Array(image.bytes), image.filename, { type: image.mimeType })
    )),
    n: input.instruction.count,
    quality: input.quality
  };

  if (input.mask) {
    params.mask = await toFile(
      new Uint8Array(input.mask.bytes),
      input.mask.filename,
      { type: input.mask.mimeType }
    );
  }

  return params;
}
