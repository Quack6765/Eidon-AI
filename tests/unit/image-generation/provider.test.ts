import { generateImages } from "@/lib/image-generation/provider";
import { createRuntimeAppSettings } from "@/tests/provider-fixtures";

const { generateGoogleNanoBananaImages } = vi.hoisted(() => ({
  generateGoogleNanoBananaImages: vi.fn().mockResolvedValue({
    assistantText: "generated",
    images: []
  })
}));

vi.mock("@/lib/image-generation/google-nano-banana", () => ({
  generateGoogleNanoBananaImages
}));

const instruction = {
  imagePrompt: "a reusable provider test",
  negativePrompt: "",
  assistantText: "",
  aspectRatio: "1:1" as const,
  count: 1
};

describe("image generation provider", () => {
  it("rejects disabled generation before dispatch", () => {
    expect(() => generateImages({
      settings: createRuntimeAppSettings(),
      instruction
    })).toThrow("Image generation is disabled");
  });

  it("passes normalized credentials and configuration to the selected provider", async () => {
    const abortController = new AbortController();
    await generateImages({
      settings: createRuntimeAppSettings({
        imageGeneration: {
          providerId: "google_nano_banana",
          configuration: { model: "gemini-2.5-flash-image" },
          credentials: { apiKey: "image-key" }
        }
      }),
      instruction,
      abortSignal: abortController.signal
    });

    expect(generateGoogleNanoBananaImages).toHaveBeenCalledWith({
      apiKey: "image-key",
      model: "gemini-2.5-flash-image",
      instruction,
      abortSignal: abortController.signal
    });
  });

  it("reports missing required credentials before dispatch", () => {
    expect(() => generateImages({
      settings: createRuntimeAppSettings({
        imageGeneration: { providerId: "google_nano_banana" }
      }),
      instruction
    })).toThrow("requires an API key");
  });
});
