export type ImageGenerationMode = "generate" | "edit";

export const IMAGE_GENERATION_IMAGE_ROLES = ["canvas", "content", "style", "character"] as const;
export type ImageGenerationImageRole = typeof IMAGE_GENERATION_IMAGE_ROLES[number];

export const IMAGE_GENERATION_ANCHORS = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right"
] as const;
export type ImageGenerationAnchor = typeof IMAGE_GENERATION_ANCHORS[number];

export type ImageGenerationAnchorPlacement = {
  kind: "anchor";
  anchor: ImageGenerationAnchor;
  widthPercent: number;
  opacity: number;
  rotationDeg: number;
  marginPercent: number;
  restyle: boolean;
};

export type ImageGenerationSemanticPlacement = {
  kind: "semantic";
  hint: string;
};

export type ImageGenerationPlacement =
  | ImageGenerationAnchorPlacement
  | ImageGenerationSemanticPlacement;

export type ImageGenerationInputSlot = {
  filename: string;
  role: ImageGenerationImageRole;
  label: string;
};

export type ImageGenerationReferenceImage = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
  role: ImageGenerationImageRole;
  label: string;
  preserveNote?: string;
};

export type ImageGenerationEditMask = {
  bytes: Buffer;
  mimeType: string;
  filename: string;
};

export type CompiledImageInstruction = {
  mode: ImageGenerationMode;
  imagePrompt: string;
  negativePrompt: string;
  assistantText: string;
  aspectRatio: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  count: number;
  inputs?: ImageGenerationInputSlot[];
  placement?: ImageGenerationPlacement;
};

export type GenerateImageResult = {
  assistantText: string;
  images: Array<{
    bytes: Buffer;
    mimeType: string;
    filename: string;
  }>;
};

export type GenerateImageInput = {
  instruction: CompiledImageInstruction;
  inputImages?: ImageGenerationReferenceImage[];
  mask?: ImageGenerationEditMask;
  abortSignal?: AbortSignal;
};
