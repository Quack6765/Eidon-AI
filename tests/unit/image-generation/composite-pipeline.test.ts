import sharp from "sharp";

import { prepareCompositeStage } from "@/lib/image-generation/composite";
import type {
  ImageGenerationPlacement,
  ImageGenerationReferenceImage
} from "@/lib/image-generation/types";

async function solid(width: number, height: number, red: boolean) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: red ? { r: 255, g: 0, b: 0, alpha: 1 } : { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).png().toBuffer();
}

function slot(overrides: Partial<ImageGenerationReferenceImage> = {}): ImageGenerationReferenceImage {
  return {
    bytes: Buffer.from("bytes"),
    mimeType: "image/png",
    filename: "image.png",
    role: "canvas",
    label: "base image",
    ...overrides
  };
}

const anchorPlacement: ImageGenerationPlacement = {
  kind: "anchor",
  anchor: "bottom-right",
  widthPercent: 25,
  opacity: 1,
  rotationDeg: 0,
  marginPercent: 3,
  restyle: true
};

describe("prepareCompositeStage", () => {
  it("returns the input slots untouched when there is no placement", async () => {
    const slots = [slot()];
    const stage = await prepareCompositeStage({ slots });

    expect(stage).toEqual({ slots });
  });

  it("returns the input slots untouched for semantic placement", async () => {
    const slots = [
      slot({ filename: "base.png", label: "base photo" }),
      slot({ filename: "logo.png", role: "content", label: "the logo" })
    ];
    const stage = await prepareCompositeStage({
      slots,
      placement: { kind: "semantic", hint: "onto the black t-shirt" }
    });

    expect(stage).toEqual({ slots });
  });

  it("returns the input slots untouched when no content slot exists", async () => {
    const slots = [slot({ filename: "base.png", label: "base photo" })];
    const stage = await prepareCompositeStage({ slots, placement: anchorPlacement });

    expect(stage).toEqual({ slots });
  });

  it("composites the content into the canvas, drops the content slot, and attaches a preserve mask", async () => {
    const canvasBytes = await solid(200, 100, false);
    const logoBytes = await solid(40, 20, true);

    const stage = await prepareCompositeStage({
      slots: [
        slot({ bytes: logoBytes, filename: "logo.png", role: "content", label: "the logo" }),
        slot({ bytes: canvasBytes, filename: "base.png", role: "canvas", label: "base photo" }),
        slot({ bytes: canvasBytes, filename: "mood.png", role: "style", label: "mood board" })
      ],
      placement: anchorPlacement
    });

    expect(stage.directResult).toBeUndefined();
    expect(stage.slots.map((entry) => entry.filename)).toEqual(["base.png", "mood.png"]);
    expect(stage.slots[0].role).toBe("canvas");
    expect(stage.slots[0].label).toBe("base photo");
    expect(stage.slots[0].preserveNote).toBe(
      "An element has already been composited into this canvas in the bottom-right corner. "
      + "Leave that element exactly as it is — do not re-colour, re-light, grade, blur or redraw it, and keep its exact original colours (hue, saturation and brightness) completely unchanged. "
      + "Apply the requested change to the rest of the canvas only."
    );
    expect(stage.slots[1].preserveNote).toBeUndefined();
    expect(stage.mask).toMatchObject({ mimeType: "image/png", filename: "edit-mask.png" });

    const metadata = await sharp(stage.slots[0].bytes).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });

  it("returns the composite directly and skips generation when restyle is off", async () => {
    const canvasBytes = await solid(200, 100, false);
    const logoBytes = await solid(40, 20, true);

    const stage = await prepareCompositeStage({
      slots: [
        slot({ bytes: canvasBytes, filename: "base.png", role: "canvas", label: "base photo" }),
        slot({ bytes: logoBytes, filename: "logo.png", role: "content", label: "the logo" })
      ],
      placement: { ...anchorPlacement, restyle: false }
    });

    expect(stage.slots).toEqual([]);
    expect(stage.mask).toBeUndefined();
    expect(stage.directResult).toMatchObject({ mimeType: "image/png", filename: "generated-1.png" });

    const metadata = await sharp(stage.directResult!.bytes).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });
});
