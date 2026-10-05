import { composeImagePrompt } from "@/lib/image-generation/prompt-composer";
import type {
  CompiledImageInstruction,
  ImageGenerationReferenceImage
} from "@/lib/image-generation/types";

function instruction(overrides: Partial<CompiledImageInstruction> = {}): CompiledImageInstruction {
  return {
    mode: "edit",
    imagePrompt: "make the photo moodier",
    negativePrompt: "",
    assistantText: "",
    aspectRatio: "1:1",
    count: 1,
    ...overrides
  };
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

describe("composeImagePrompt", () => {
  it("returns the bare prompt with the avoid clause when there are no slots", () => {
    expect(composeImagePrompt({
      instruction: instruction({ mode: "generate", imagePrompt: "poster of Seoul", negativePrompt: "blur" })
    })).toBe("poster of Seoul\n\nAvoid: blur");
  });

  it("omits the avoid clause when there is no negative prompt", () => {
    expect(composeImagePrompt({
      instruction: instruction({ mode: "generate", imagePrompt: "poster of Seoul" })
    })).toBe("poster of Seoul");
  });

  it("composes indexed role labels, placement and invariants", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({
        imagePrompt: "make the photo moodier",
        negativePrompt: "blur",
        placement: {
          kind: "anchor",
          anchor: "bottom-right",
          widthPercent: 22,
          opacity: 1,
          rotationDeg: 0,
          marginPercent: 3,
          restyle: true
        }
      }),
      slots: [
        slot({ filename: "base.png", label: "base photo" }),
        slot({ filename: "logo.png", role: "content", label: "the logo" })
      ]
    });

    expect(prompt).toBe([
      "Image 1 (base photo) — the canvas.",
      "Image 2 (the logo) — content to place into the canvas, reproduce it exactly.",
      "",
      "Place the subject of Image 2 in the bottom-right corner of Image 1, about 22% of its width.",
      "",
      "Use Image 1 as the canvas: keep its composition, layout, text and style unchanged except for the change requested below.",
      "Reproduce Image 2 exactly as it appears in that image — its shape, proportions, letterforms and exact original colours (hue, saturation and brightness) must remain completely unchanged. Do not apply the requested change to it.",
      "",
      "Change requested: make the photo moodier",
      "",
      "Avoid: blur"
    ].join("\n"));
  });

  it("renders semantic placement hints and keeps the reproduce clause", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({
        placement: { kind: "semantic", hint: "onto the black t-shirt" }
      }),
      slots: [
        slot({ filename: "base.png", label: "base photo" }),
        slot({ filename: "logo.png", role: "content", label: "the logo" })
      ]
    });

    expect(prompt).toContain("Place the subject of Image 2 onto the black t-shirt in Image 1.");
    expect(prompt).toContain("Reproduce Image 2 exactly");
  });

  it("falls back to the canvas invariant only when no placement is available", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({ imagePrompt: "change the hat color to red" }),
      slots: [slot({ filename: "photo.png", label: "base photo" })]
    });

    expect(prompt).toContain("Image 1 (base photo) — the canvas.");
    expect(prompt).not.toContain("Place the subject");
    expect(prompt).not.toContain("Reproduce Image 1 exactly");
    expect(prompt).toContain("Change requested: change the hat color to red");
  });

  it("describes style and character slots without invariants", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({ imagePrompt: "restyle the scene" }),
      slots: [
        slot({ filename: "base.png", label: "base photo" }),
        slot({ filename: "mood.png", role: "style", label: "mood board" }),
        slot({ filename: "hero.png", role: "character", label: "the hero" })
      ]
    });

    expect(prompt).toContain("Image 2 (mood board) — a style reference, match its visual style.");
    expect(prompt).toContain("Image 3 (the hero) — a character reference, keep this character's appearance consistent.");
    expect(prompt).not.toContain("Reproduce Image");
    expect(prompt).not.toContain("Place the subject");
  });

  it("references every content slot when more than one is placed", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({
        placement: {
          kind: "anchor",
          anchor: "center",
          widthPercent: 30,
          opacity: 1,
          rotationDeg: 0,
          marginPercent: 3,
          restyle: true
        }
      }),
      slots: [
        slot({ filename: "base.png", label: "base photo" }),
        slot({ filename: "logo.png", role: "content", label: "the logo" }),
        slot({ filename: "sticker.png", role: "content", label: "the sticker" })
      ]
    });

    expect(prompt).toContain("Place the subjects of Image 2 and Image 3 in the centre of Image 1");
    expect(prompt).toContain("Reproduce Image 2 exactly");
    expect(prompt).toContain("Reproduce Image 3 exactly");
  });

  it("carries a preserve note from a composited canvas into the invariants", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({ imagePrompt: "make the photo moodier" }),
      slots: [
        slot({
          filename: "base.png",
          label: "base photo",
          preserveNote:
            "An element has already been composited into this canvas in the bottom-right corner. "
            + "Leave that element exactly as it is — do not re-colour, re-light, grade, blur or redraw it, and keep its exact original colours (hue, saturation and brightness) completely unchanged. "
            + "Apply the requested change to the rest of the canvas only."
        })
      ]
    });

    expect(prompt).toContain("An element has already been composited into this canvas in the bottom-right corner.");
    expect(prompt).toContain("Leave that element exactly as it is");
    expect(prompt).toContain("keep its exact original colours (hue, saturation and brightness) completely unchanged");
  });

  it("treats the first slot as the canvas when no slot carries the canvas role", () => {
    const prompt = composeImagePrompt({
      instruction: instruction({ imagePrompt: "merge them" }),
      slots: [
        slot({ filename: "a.png", role: "content", label: "first" }),
        slot({ filename: "b.png", role: "content", label: "second" })
      ]
    });

    expect(prompt).toContain("Use Image 1 as the canvas");
    expect(prompt).not.toContain("Use Image 2 as the canvas");
  });
});
