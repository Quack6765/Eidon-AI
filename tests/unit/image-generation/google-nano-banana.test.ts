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

describe("generateGoogleNanoBananaImages", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
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
      settings: {
        googleNanoBananaModel: "gemini-3.1-flash-image-preview",
        googleNanoBananaApiKey: "google-secret"
      },
      instruction: {
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
      settings: {
        googleNanoBananaModel: "gemini-3.1-flash-image-preview",
        googleNanoBananaApiKey: "google-secret"
      },
      instruction: {
        imagePrompt: "poster of Seoul at dusk",
        negativePrompt: "",
        assistantText: "",
        aspectRatio: "1:1",
        count: 1
      }
    })).rejects.toThrow("Google Nano Banana returned no images");
  });
});
