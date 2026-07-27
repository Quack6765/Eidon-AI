import { GoogleGenAI, Modality } from "@google/genai";
import type { AppSettings } from "@/lib/types";
import type { CompiledImageInstruction, GenerateImageResult } from "./types";
import { renameGeneratedImages } from "./generated-filenames";

export async function generateGoogleNanoBananaImages(input: {
  settings: Pick<AppSettings, "googleNanoBananaApiKey" | "googleNanoBananaModel">;
  instruction: CompiledImageInstruction;
  abortSignal?: AbortSignal;
}): Promise<GenerateImageResult> {
  const ai = new GoogleGenAI({ apiKey: input.settings.googleNanoBananaApiKey });
  const request = {
    model: input.settings.googleNanoBananaModel,
    contents: input.instruction.imagePrompt,
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
