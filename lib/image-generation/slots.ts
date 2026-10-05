import {
  IMAGE_GENERATION_IMAGE_ROLES,
  type ImageGenerationImageRole,
  type ImageGenerationInputSlot,
  type ImageGenerationReferenceImage
} from "./types";

export const IMAGE_ROLE_ORDER: Record<ImageGenerationImageRole, number> = {
  canvas: 0,
  content: 1,
  style: 2,
  character: 3
};

export const IMAGE_ROLE_DEFAULT_LABELS: Record<ImageGenerationImageRole, string> = {
  canvas: "base image",
  content: "image to place",
  style: "style reference",
  character: "character reference"
};

export function orderReferenceImages(
  images: ImageGenerationReferenceImage[]
): ImageGenerationReferenceImage[] {
  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => IMAGE_ROLE_ORDER[a.image.role] - IMAGE_ROLE_ORDER[b.image.role] || a.index - b.index)
    .map(({ image }) => image);
}

export function parseImageSlotOverrides(value: unknown): ImageGenerationInputSlot[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const slots = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const filename = typeof raw.filename === "string" ? raw.filename.trim() : "";
    const role = typeof raw.role === "string" ? raw.role : "";
    if (!filename || !IMAGE_GENERATION_IMAGE_ROLES.includes(role as ImageGenerationImageRole)) return [];
    return [{
      filename,
      role: role as ImageGenerationImageRole,
      label: typeof raw.label === "string" ? raw.label.trim() : ""
    }];
  });

  return slots.length ? slots : undefined;
}
