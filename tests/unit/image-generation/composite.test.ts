import sharp from "sharp";

import {
  buildPreserveMask,
  compositeOntoCanvas,
  type CompositedImage,
  type ImageRegion
} from "@/lib/image-generation/composite";
import type { ImageGenerationAnchor, ImageGenerationAnchorPlacement } from "@/lib/image-generation/types";

async function solid(
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha: number }
) {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}

async function circleMark(diameter: number) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${diameter}" height="${diameter}">
      <circle cx="${diameter / 2}" cy="${diameter / 2}" r="${diameter / 2 - 1}" fill="#e6006e"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixelAt(bytes: Buffer, x: number, y: number) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + x) * 4;
  return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
}

async function alphaRow(bytes: Buffer, y: number) {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const row: number[] = [];
  for (let x = 0; x < info.width; x += 1) {
    row.push(data[(y * info.width + x) * 4 + 3]);
  }
  return row;
}

function regions(result: CompositedImage): ImageRegion[] {
  return result.layers.map(({ left, top, width, height }) => ({ left, top, width, height }));
}

function placement(overrides: Partial<ImageGenerationAnchorPlacement> = {}): ImageGenerationAnchorPlacement {
  return {
    kind: "anchor",
    anchor: "bottom-right",
    widthPercent: 25,
    opacity: 1,
    rotationDeg: 0,
    marginPercent: 3,
    restyle: true,
    ...overrides
  };
}

const RED = { r: 255, g: 0, b: 0, alpha: 1 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

describe("compositeOntoCanvas", () => {
  it("resizes content to the configured share of the canvas width", async () => {
    const canvas = await solid(200, 100, WHITE);
    const content = await solid(40, 20, RED);

    const result = await compositeOntoCanvas({
      canvas: { bytes: canvas },
      content: [{ bytes: content }],
      placement: placement({ anchor: "top-left" })
    });

    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(regions(result)).toEqual([{ left: 6, top: 3, width: 50, height: 25 }]);
  });

  it("places content in the bottom-right with margin padding and leaves the canvas untouched elsewhere", async () => {
    const canvas = await solid(200, 100, WHITE);
    const content = await solid(40, 20, RED);

    const result = await compositeOntoCanvas({
      canvas: { bytes: canvas },
      content: [{ bytes: content }],
      placement: placement({ anchor: "bottom-right" })
    });

    expect(regions(result)).toEqual([{ left: 144, top: 72, width: 50, height: 25 }]);
    expect(await pixelAt(result.bytes, 169, 84)).toMatchObject({ r: 255, g: 0, b: 0, a: 255 });
    expect(await pixelAt(result.bytes, 10, 90)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 });

    const metadata = await sharp(result.bytes).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });

  it.each<[ImageGenerationAnchor, ImageRegion]>([
    ["top-left", { left: 6, top: 3, width: 50, height: 25 }],
    ["top", { left: 75, top: 3, width: 50, height: 25 }],
    ["top-right", { left: 144, top: 3, width: 50, height: 25 }],
    ["left", { left: 6, top: 38, width: 50, height: 25 }],
    ["center", { left: 75, top: 38, width: 50, height: 25 }],
    ["right", { left: 144, top: 38, width: 50, height: 25 }],
    ["bottom-left", { left: 6, top: 72, width: 50, height: 25 }],
    ["bottom", { left: 75, top: 72, width: 50, height: 25 }],
    ["bottom-right", { left: 144, top: 72, width: 50, height: 25 }]
  ])("resolves the %s anchor to the expected region", async (anchor, expected) => {
    const canvas = await solid(200, 100, WHITE);
    const content = await solid(40, 20, RED);

    const result = await compositeOntoCanvas({
      canvas: { bytes: canvas },
      content: [{ bytes: content }],
      placement: placement({ anchor })
    });

    expect(regions(result)).toEqual([expected]);
  });

  it("applies opacity to the placed content", async () => {
    const canvas = await solid(200, 100, WHITE);
    const content = await solid(40, 20, RED);

    const result = await compositeOntoCanvas({
      canvas: { bytes: canvas },
      content: [{ bytes: content }],
      placement: placement({ anchor: "top-left", opacity: 0.5 })
    });

    const pixel = await pixelAt(result.bytes, 20, 15);
    expect(pixel.a).toBe(255);
    expect(pixel.r).toBe(255);
    expect(pixel.g).toBeGreaterThan(120);
    expect(pixel.g).toBeLessThan(190);
  });

  it("renders content fully opaque when opacity is one", async () => {
    const canvas = await solid(200, 100, WHITE);
    const content = await solid(40, 20, RED);

    const result = await compositeOntoCanvas({
      canvas: { bytes: canvas },
      content: [{ bytes: content }],
      placement: placement({ anchor: "top-left", opacity: 1 })
    });

    expect(await pixelAt(result.bytes, 20, 15)).toMatchObject({ r: 255, g: 0, b: 0, a: 255 });
  });

  it("stacks several content slots down from the anchor", async () => {
    const canvas = await solid(200, 100, WHITE);
    const content = await solid(40, 20, RED);

    const result = await compositeOntoCanvas({
      canvas: { bytes: canvas },
      content: [{ bytes: content }, { bytes: content }],
      placement: placement({ anchor: "top-left" })
    });

    expect(result.layers).toHaveLength(2);
    expect(regions(result)[0]).toEqual({ left: 6, top: 3, width: 50, height: 25 });
    expect(result.layers[1].top).toBeGreaterThan(
      result.layers[0].top + result.layers[0].height - 1
    );
  });

  it("rejects an unreadable canvas", async () => {
    await expect(compositeOntoCanvas({
      canvas: { bytes: Buffer.from("not-an-image") },
      content: [{ bytes: Buffer.from("not-an-image") }],
      placement: placement()
    })).rejects.toThrow();
  });
});

describe("buildPreserveMask", () => {
  it("keeps the protected pixels opaque and the rest editable", async () => {
    const mark = await solid(20, 20, { r: 255, g: 255, b: 255, alpha: 1 });
    const mask = await buildPreserveMask({
      width: 100,
      height: 100,
      layers: [{ bytes: mark, left: 20, top: 20, width: 20, height: 20 }]
    });

    expect(mask.mimeType).toBe("image/png");
    expect((await pixelAt(mask.bytes, 30, 30)).a).toBe(255);
    expect((await pixelAt(mask.bytes, 90, 90)).a).toBe(0);
  });

  it("feathers the boundary of the protected area", async () => {
    const mark = await solid(20, 20, { r: 255, g: 255, b: 255, alpha: 1 });
    const mask = await buildPreserveMask({
      width: 100,
      height: 100,
      layers: [{ bytes: mark, left: 20, top: 20, width: 20, height: 20 }],
      featherPx: 8
    });

    const row = await alphaRow(mask.bytes, 30);
    expect(row.filter((value) => value > 0 && value < 255).length).toBeGreaterThan(0);
  });

  it("protects only the pixels the overlay actually paints, not its bounding box", async () => {
    const mark = await circleMark(40);
    const mask = await buildPreserveMask({
      width: 100,
      height: 100,
      layers: [{ bytes: mark, left: 20, top: 20, width: 40, height: 40 }],
      featherPx: 2
    });

    expect((await pixelAt(mask.bytes, 40, 40)).a).toBe(255);
    expect((await pixelAt(mask.bytes, 21, 21)).a).toBe(0);
    expect((await pixelAt(mask.bytes, 58, 58)).a).toBe(0);
    expect((await pixelAt(mask.bytes, 21, 58)).a).toBe(0);
    expect((await pixelAt(mask.bytes, 58, 21)).a).toBe(0);
  });

  it("rejects a mask with no protected layers", async () => {
    await expect(buildPreserveMask({ width: 10, height: 10, layers: [] }))
      .rejects.toThrow("A preserve mask requires at least one protected layer");
  });
});
