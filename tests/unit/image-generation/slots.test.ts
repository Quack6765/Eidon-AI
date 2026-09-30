import { orderReferenceImages, parseImageSlotOverrides } from "@/lib/image-generation/slots";
import type { ImageGenerationReferenceImage } from "@/lib/image-generation/types";

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

describe("orderReferenceImages", () => {
  it("sorts canvas first, then content, style and character", () => {
    const ordered = orderReferenceImages([
      slot({ filename: "character.png", role: "character" }),
      slot({ filename: "style.png", role: "style" }),
      slot({ filename: "logo.png", role: "content" }),
      slot({ filename: "base.png", role: "canvas" })
    ]);

    expect(ordered.map((entry) => entry.filename)).toEqual([
      "base.png",
      "logo.png",
      "style.png",
      "character.png"
    ]);
  });

  it("keeps the original order within a role", () => {
    const ordered = orderReferenceImages([
      slot({ filename: "b.png", role: "content" }),
      slot({ filename: "a.png", role: "content" }),
      slot({ filename: "c.png", role: "content" })
    ]);

    expect(ordered.map((entry) => entry.filename)).toEqual(["b.png", "a.png", "c.png"]);
  });
});

describe("parseImageSlotOverrides", () => {
  it("returns undefined for a missing or malformed value", () => {
    expect(parseImageSlotOverrides(undefined)).toBeUndefined();
    expect(parseImageSlotOverrides("nope")).toBeUndefined();
    expect(parseImageSlotOverrides([])).toBeUndefined();
    expect(parseImageSlotOverrides([{ filename: "", role: "canvas" }])).toBeUndefined();
    expect(parseImageSlotOverrides([{ filename: "a.png", role: "nonsense" }])).toBeUndefined();
  });

  it("keeps well-formed overrides and trims the label", () => {
    expect(parseImageSlotOverrides([
      { filename: "base.png", role: "canvas", label: "  base photo  " },
      { filename: "logo.png", role: "content" },
      { filename: "junk.png", role: "bogus" }
    ])).toEqual([
      { filename: "base.png", role: "canvas", label: "base photo" },
      { filename: "logo.png", role: "content", label: "" }
    ]);
  });
});
