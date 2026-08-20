import { generateImages } from "@/lib/image-generation/provider";
import { createRuntimeAppSettings } from "@/tests/provider-fixtures";

const { generateGoogleNanoBananaImages, generateOpenAiGptImages } = vi.hoisted(() => ({
  generateGoogleNanoBananaImages: vi.fn().mockResolvedValue({
    assistantText: "generated",
    images: []
  }),
  generateOpenAiGptImages: vi.fn().mockResolvedValue({
    assistantText: "generated",
    images: []
  })
}));

vi.mock("@/lib/image-generation/google-nano-banana", () => ({
  generateGoogleNanoBananaImages
}));

vi.mock("@/lib/image-generation/openai-gpt-image", () => ({
  generateOpenAiGptImages
}));

const instruction = {
  mode: "generate" as const,
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

  it("passes normalized credentials, model, and quality to the OpenAI provider", async () => {
    const abortController = new AbortController();
    const inputImages = [{
      bytes: Buffer.from("reference-bytes"),
      mimeType: "image/png",
      filename: "reference.png"
    }];
    await generateImages({
      settings: createRuntimeAppSettings({
        imageGeneration: {
          providerId: "openai_gpt_image",
          configuration: { model: "gpt-image-2", quality: "high" },
          credentials: { apiKey: "openai-image-key" }
        }
      }),
      instruction: { ...instruction, mode: "edit" },
      inputImages,
      abortSignal: abortController.signal
    });

    expect(generateOpenAiGptImages).toHaveBeenCalledWith({
      apiKey: "openai-image-key",
      model: "gpt-image-2",
      quality: "high",
      instruction: { ...instruction, mode: "edit" },
      inputImages,
      abortSignal: abortController.signal
    });
  });

  it("applies provider defaults when configuration is missing entries", async () => {
    await generateImages({
      settings: createRuntimeAppSettings({
        imageGeneration: {
          providerId: "openai_gpt_image",
          credentials: { apiKey: "openai-image-key" }
        }
      }),
      instruction
    });

    expect(generateOpenAiGptImages).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "openai-image-key",
        model: "gpt-image-2",
        quality: "auto"
      })
    );
  });

  it("reports missing required credentials before dispatch", () => {
    expect(() => generateImages({
      settings: createRuntimeAppSettings({
        imageGeneration: { providerId: "google_nano_banana" }
      }),
      instruction
    })).toThrow("requires an API key");

    expect(() => generateImages({
      settings: createRuntimeAppSettings({
        imageGeneration: { providerId: "openai_gpt_image" }
      }),
      instruction
    })).toThrow("requires an API key");
  });
});
