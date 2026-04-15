import { generateGoogleNanoBananaImages } from "@/lib/image-generation/google-nano-banana";

vi.mock("@google/genai", () => ({
  Modality: { IMAGE: "IMAGE" },
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: vi.fn().mockResolvedValue({
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
      })
    }
  }))
}));

describe("generateGoogleNanoBananaImages", () => {
  it("returns image buffers from Google Nano Banana", async () => {
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
      mimeType: "image/png",
      filename: "generated-1.png"
    });
  });
});
