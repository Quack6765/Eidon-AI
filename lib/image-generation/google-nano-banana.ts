import { GoogleGenAI, Modality } from "@google/genai";
import type { ImageGenerationModelId } from "@/lib/image-generation/catalog";
import type {
  CompiledImageInstruction,
  GenerateImageResult,
  ImageGenerationReferenceImage
} from "./types";
import { renameGeneratedImages } from "./generated-filenames";

export async function generateGoogleNanoBananaImages(input: {
  apiKey: string;
  model: ImageGenerationModelId;
  instruction: CompiledImageInstruction;
  inputImages?: ImageGenerationReferenceImage[];
  abortSignal?: AbortSignal;
}): Promise<GenerateImageResult> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const editDirective = input.inputImages?.length
    ? `Apply this edit to the provided image, preserving its composition, layout, text, and style except for what the edit changes: ${input.instruction.imagePrompt}`
    : input.instruction.imagePrompt;
  const contents = input.inputImages?.length
    ? [
        ...input.inputImages.map((image) => ({
          inlineData: { mimeType: image.mimeType, data: image.bytes.toString("base64") }
        })),
        { text: editDirective }
      ]
    : input.instruction.imagePrompt;
  const request = {
    model: input.model,
    contents,
    config: {
      responseModalities: [Modality.IMAGE],
      abortSignal: input.abortSignal
    }
  };
  const response = await ai.models.generateContent(request);

  const images = renameGeneratedImages((response.candidates?.[0]?.content?.parts ?? [])
    .filter((part): part is { inlineData: { mimeType: string; data: string } } =>
      Boolean(part && typeof part === "object" && "inlineData" in part && part.inlineData?.data)
    )
    .map((part, index) => ({
      bytes: Buffer.from(part.inlineData.data, "base64"),
      mimeType: part.inlineData.mimeType,
      filename: `generated-${index + 1}.${part.inlineData.mimeType.split("/")[1] ?? "png"}`
    })));

  if (!images.length) {
    throw new Error("Google Nano Banana returned no images");
  }

  return {
    assistantText: input.instruction.assistantText || "",
    images
  };
}
