import { generateGoogleNanoBananaImages } from "@/lib/image-generation/google-nano-banana";
import type {
  CompiledImageInstruction,
  ImageGenerationReferenceImage
} from "@/lib/image-generation/types";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => ({
  Modality: { IMAGE: "IMAGE" },
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: generateContentMock
    }
  }))
}));

function instruction(overrides: Partial<CompiledImageInstruction> = {}): CompiledImageInstruction {
  return {
    mode: "generate",
    imagePrompt: "poster of Seoul at dusk",
    negativePrompt: "",
    assistantText: "",
    aspectRatio: "1:1",
    count: 1,
    ...overrides
  };
}

function referenceImage(
  overrides: Partial<ImageGenerationReferenceImage> = {}
): ImageGenerationReferenceImage {
  return {
    bytes: Buffer.from("reference-bytes"),
    mimeType: "image/png",
    filename: "reference.png",
    role: "canvas",
    label: "base image",
    ...overrides
  };
}

function mockImageResponse() {
  generateContentMock.mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: Buffer.from("png-bytes").toString("base64")
              }
            }
          ]
        }
      }
    ]
  });
}

function request() {
  return generateContentMock.mock.calls[0][0];
}

describe("generateGoogleNanoBananaImages", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    mockImageResponse();
  });

  it("returns image buffers from Google Nano Banana", async () => {
    const result = await generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction()
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      mimeType: "image/png"
    });
    expect(result.images[0].filename).toMatch(/^202\d{5}-\d{6}-[a-f0-9]{8}-1\.png$/i);
  });

  it("passes reference images inline before the edit prompt", async () => {
    await generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction({ mode: "edit", imagePrompt: "change the hat color to red" }),
      inputImages: [referenceImage()]
    });

    expect(request()).toMatchObject({
      model: "gemini-3.1-flash-image-preview",
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
        abortSignal: undefined
      }
    });
    expect(request().contents).toHaveLength(2);
    expect(request().contents[0]).toEqual({
      inlineData: {
        mimeType: "image/png",
        data: Buffer.from("reference-bytes").toString("base64")
      }
    });
    expect(request().contents[1].text).toContain("Image 1 (base image) — the canvas.");
    expect(request().contents[1].text).toContain("Change requested: change the hat color to red");
  });

  it("orders reference images canvas-first and labels each slot in the prompt", async () => {
    await generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction({
        mode: "edit",
        imagePrompt: "place the logo and make the photo moodier",
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
      inputImages: [
        referenceImage({ filename: "logo.png", role: "content", label: "the logo" }),
        referenceImage({ filename: "base.png", role: "canvas", label: "base photo" })
      ]
    });

    const contents = request().contents;
    expect(contents).toHaveLength(3);
    expect(contents[0].inlineData.data).toEqual(Buffer.from("reference-bytes").toString("base64"));
    expect(contents[2].text).toContain("Image 1 (base photo) — the canvas.");
    expect(contents[2].text).toContain("Image 2 (the logo) — content to place into the canvas, reproduce it exactly.");
    expect(contents[2].text).toContain(
      "Place the subject of Image 2 in the bottom-right corner of Image 1, about 22% of its width."
    );
    expect(contents[2].text).toContain("Reproduce Image 2 exactly");
  });

  it("carries semantic placement hints into the prompt", async () => {
    await generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction({
        mode: "edit",
        imagePrompt: "add the logo",
        negativePrompt: "distortion",
        placement: { kind: "semantic", hint: "onto the black t-shirt" }
      }),
      inputImages: [
        referenceImage({ filename: "base.png", role: "canvas", label: "base photo" }),
        referenceImage({ filename: "logo.png", role: "content", label: "the logo" })
      ]
    });

    const text = request().contents[2].text;
    expect(text).toContain("Place the subject of Image 2 onto the black t-shirt in Image 1.");
    expect(text).toContain("Reproduce Image 2 exactly");
    expect(text).toContain("Avoid: distortion");
  });

  it("requests the compiled aspect ratio instead of relying on the input images", async () => {
    await generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction({ aspectRatio: "16:9" }),
      inputImages: [referenceImage()]
    });

    expect(request().config.imageConfig).toEqual({ aspectRatio: "16:9" });
  });

  it("throws when Google Nano Banana returns no image parts", async () => {
    generateContentMock.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: "I could not produce an image." }]
          }
        }
      ]
    });

    await expect(generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction()
    })).rejects.toThrow("Google Nano Banana returned no images");

    generateContentMock.mockResolvedValue({});
    await expect(generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: instruction()
    })).rejects.toThrow("Google Nano Banana returned no images");
  });
});
