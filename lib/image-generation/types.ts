export type CompiledImageInstruction = {
  imagePrompt: string;
  negativePrompt: string;
  assistantText: string;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  width?: number;
  height?: number;
  seed?: number;
  count: number;
};

export type GenerateImageResult = {
  assistantText: string;
  images: Array<{
    bytes: Buffer;
    mimeType: string;
    filename: string;
  }>;
};
