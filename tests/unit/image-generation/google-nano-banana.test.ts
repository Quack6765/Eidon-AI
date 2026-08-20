import { generateGoogleNanoBananaImages } from "@/lib/image-generation/google-nano-banana";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => ({
  Modality: { IMAGE: "IMAGE" },
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: generateContentMock
    }
  }))
}));

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

describe("generateGoogleNanoBananaImages", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    mockImageResponse();
  });

  it("returns image buffers from Google Nano Banana", async () => {
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

    const result = await generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: {
        mode: "generate",
        imagePrompt: "poster of Seoul at dusk",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      }
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
      instruction: {
        mode: "edit",
        imagePrompt: "change the hat color to red",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      },
      inputImages: [{
        bytes: Buffer.from("reference-bytes"),
        mimeType: "image/png",
        filename: "reference.png"
      }]
    });

    expect(generateContentMock).toHaveBeenCalledWith({
      model: "gemini-3.1-flash-image-preview",
      contents: [
        {
          inlineData: {
            mimeType: "image/png",
            data: Buffer.from("reference-bytes").toString("base64")
          }
        },
        {
          text: "Apply this edit to the provided image, preserving its composition, layout, text, and style except for what the edit changes: change the hat color to red"
        }
      ],
      config: { responseModalities: ["IMAGE"], abortSignal: undefined }
    });
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
      instruction: {
        mode: "generate",
        imagePrompt: "poster of Seoul at dusk",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      }
    })).rejects.toThrow("Google Nano Banana returned no images");

    generateContentMock.mockResolvedValue({});
    await expect(generateGoogleNanoBananaImages({
      model: "gemini-3.1-flash-image-preview",
      apiKey: "google-secret",
      instruction: {
        mode: "generate",
        imagePrompt: "poster of Seoul at dusk",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      }
    })).rejects.toThrow("Google Nano Banana returned no images");
  });
});
