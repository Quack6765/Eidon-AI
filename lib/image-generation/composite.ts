import sharp from "sharp";

import { describeAnchor } from "./prompt-composer";
import type {
  GenerateImageResult,
  ImageGenerationAnchor,
  ImageGenerationAnchorPlacement,
  ImageGenerationEditMask,
  ImageGenerationPlacement,
  ImageGenerationReferenceImage
} from "./types";

export type CompositedLayer = {
  bytes: Buffer;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CompositedImage = {
  bytes: Buffer;
  width: number;
  height: number;
  layers: CompositedLayer[];
};

export type ImageRegion = Pick<CompositedLayer, "left" | "top" | "width" | "height">;

const MASK_FEATHER_PX = 8;

type Axis = "start" | "middle" | "end";

function anchorAxis(anchor: ImageGenerationAnchor): { horizontal: Axis; vertical: Axis } {
  return {
    horizontal: anchor.endsWith("left") ? "start" : anchor.endsWith("right") ? "end" : "middle",
    vertical: anchor.startsWith("top") ? "start" : anchor.startsWith("bottom") ? "end" : "middle"
  };
}

function placeAlong(axis: Axis, canvasSize: number, itemSize: number, margin: number) {
  if (axis === "start") return margin;
  if (axis === "end") return Math.max(0, canvasSize - itemSize - margin);
  return Math.max(0, Math.round((canvasSize - itemSize) / 2));
}

async function applyOpacity(bytes: Buffer, opacity: number) {
  if (opacity >= 1) return bytes;
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 3; index < data.length; index += 4) {
    data[index] = Math.round(data[index] * opacity);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function renderOverlay(
  bytes: Buffer,
  placement: ImageGenerationAnchorPlacement,
  canvasWidth: number,
  canvasHeight: number,
  slots: number
) {
  const widthBudget = Math.max(1, Math.round((canvasWidth * placement.widthPercent) / 100));
  const heightBudget = Math.max(1, Math.round(canvasHeight / Math.max(1, slots)));

  let pipeline = sharp(bytes).resize({
    width: widthBudget,
    height: heightBudget,
    fit: "inside",
    withoutEnlargement: false
  });
  if (placement.rotationDeg) {
    pipeline = pipeline.rotate(placement.rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }

  const resized = await pipeline.ensureAlpha().png().toBuffer();
  return applyOpacity(resized, placement.opacity);
}

export async function compositeOntoCanvas(input: {
  canvas: { bytes: Buffer };
  content: Array<{ bytes: Buffer }>;
  placement: ImageGenerationAnchorPlacement;
}): Promise<CompositedImage> {
  const metadata = await sharp(input.canvas.bytes).metadata();
  const canvasWidth = metadata.width ?? 0;
  const canvasHeight = metadata.height ?? 0;
  if (!canvasWidth || !canvasHeight) {
    throw new Error("Cannot composite onto a canvas with unknown dimensions");
  }

  const { horizontal, vertical } = anchorAxis(input.placement.anchor);
  const marginX = Math.round((canvasWidth * input.placement.marginPercent) / 100);
  const marginY = Math.round((canvasHeight * input.placement.marginPercent) / 100);

  const layers: CompositedLayer[] = [];
  const slotCount = input.content.length;

  for (const [index, slot] of input.content.entries()) {
    const overlay = await renderOverlay(slot.bytes, input.placement, canvasWidth, canvasHeight, slotCount);
    const overlayMetadata = await sharp(overlay).metadata();
    const width = overlayMetadata.width ?? 0;
    const height = overlayMetadata.height ?? 0;

    const stackHeight = slotCount * height + Math.max(0, slotCount - 1) * marginY;
    const stackTop = placeAlong(vertical, canvasHeight, stackHeight, marginY);
    const left = placeAlong(horizontal, canvasWidth, width, marginX);
    const top = Math.max(0, Math.min(canvasHeight - height, stackTop + index * (height + marginY)));

    layers.push({ bytes: overlay, left, top, width, height });
  }

  const bytes = await sharp(input.canvas.bytes)
    .composite(layers.map((layer) => ({ input: layer.bytes, left: layer.left, top: layer.top, blend: "over" as const })))
    .png()
    .toBuffer();

  return { bytes, width: canvasWidth, height: canvasHeight, layers };
}

async function buildCoverage(
  layers: CompositedLayer[],
  width: number,
  height: number
): Promise<Buffer> {
  const coverage = Buffer.alloc(width * height, 0);

  for (const layer of layers) {
    const { data, info } = await sharp(layer.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < info.height; y += 1) {
      const targetY = layer.top + y;
      if (targetY < 0 || targetY >= height) continue;
      for (let x = 0; x < info.width; x += 1) {
        const targetX = layer.left + x;
        if (targetX < 0 || targetX >= width) continue;
        const alpha = data[(y * info.width + x) * 4 + 3];
        const offset = targetY * width + targetX;
        if (alpha > coverage[offset]) coverage[offset] = alpha;
      }
    }
  }

  return coverage;
}

export async function buildPreserveMask(input: {
  width: number;
  height: number;
  layers: CompositedLayer[];
  featherPx?: number;
}): Promise<ImageGenerationEditMask> {
  if (!input.layers.length) {
    throw new Error("A preserve mask requires at least one protected layer");
  }

  const feather = input.featherPx ?? MASK_FEATHER_PX;
  const coverage = await buildCoverage(input.layers, input.width, input.height);

  const blurred = await sharp(coverage, {
    raw: { width: input.width, height: input.height, channels: 1 }
  })
    .blur(Math.max(0.1, feather / 2))
    .extractChannel(0)
    .raw()
    .toBuffer();

  const white = Buffer.alloc(input.width * input.height * 3, 255);
  const bytes = await sharp(white, { raw: { width: input.width, height: input.height, channels: 3 } })
    .joinChannel(blurred, { raw: { width: input.width, height: input.height, channels: 1 } })
    .png()
    .toBuffer();

  return { bytes, mimeType: "image/png", filename: "edit-mask.png" };
}

export async function prepareCompositeStage(input: {
  slots: ImageGenerationReferenceImage[];
  placement?: ImageGenerationPlacement;
}): Promise<{
  slots: ImageGenerationReferenceImage[];
  mask?: ImageGenerationEditMask;
  directResult?: GenerateImageResult["images"][number];
}> {
  const placement = input.placement;
  if (!placement || placement.kind !== "anchor") return { slots: input.slots };

  const canvas = input.slots.find((slot) => slot.role === "canvas") ?? input.slots[0];
  const content = input.slots.filter((slot) => slot.role === "content");
  if (!canvas || !content.length) return { slots: input.slots };

  const composited = await compositeOntoCanvas({
    canvas: { bytes: canvas.bytes },
    content: content.map((slot) => ({ bytes: slot.bytes })),
    placement
  });

  if (!placement.restyle) {
    return {
      slots: [],
      directResult: { bytes: composited.bytes, mimeType: "image/png", filename: "generated-1.png" }
    };
  }

  const mask = await buildPreserveMask({
    width: composited.width,
    height: composited.height,
    layers: composited.layers
  });

  return {
    slots: [
      {
        bytes: composited.bytes,
        mimeType: "image/png",
        filename: canvas.filename,
        role: "canvas",
        label: canvas.label,
        preserveNote:
          `An element has already been composited into this canvas in the ${describeAnchor(placement.anchor)}. `
          + "Leave that element exactly as it is — do not re-colour, re-light, grade, blur or redraw it, and keep its exact original colours (hue, saturation and brightness) completely unchanged. "
          + "Apply the requested change to the rest of the canvas only."
      },
      ...input.slots.filter((slot) => slot !== canvas && slot.role !== "content")
    ],
    mask
  };
}
