import { generateOpenAiGptImages } from "@/lib/image-generation/openai-gpt-image";

const { generateMock, editMock, toFileMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  editMock: vi.fn(),
  toFileMock: vi.fn()
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    images: {
      generate: generateMock,
      edit: editMock
    }
  })),
  toFile: toFileMock
}));

function instruction(overrides: Record<string, unknown> = {}) {
  return {
    mode: "generate" as const,
    imagePrompt: "poster of Seoul at dusk",
    negativePrompt: "",
    assistantText: "",
    aspectRatio: "1:1" as const,
    count: 1,
    ...overrides
  };
}

function referenceImage(overrides: Record<string, unknown> = {}) {
  return {
    bytes: Buffer.from("reference-bytes"),
    mimeType: "image/png",
    filename: "reference.png",
    ...overrides
  };
}

describe("generateOpenAiGptImages", () => {
  beforeEach(() => {
    generateMock.mockReset();
    editMock.mockReset();
    toFileMock.mockReset();
    generateMock.mockResolvedValue({
      data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }]
    });
    editMock.mockResolvedValue({
      data: [{ b64_json: Buffer.from("edited-bytes").toString("base64") }]
    });
    toFileMock.mockImplementation(async (value: unknown, name: string | undefined, options: unknown) => ({
      value,
      name,
      options
    }));
  });

  it("decodes returned base64 images with generated filenames", async () => {
    const result = await generateOpenAiGptImages({
      apiKey: "openai-secret",
      model: "gpt-image-2",
      quality: "high",
      instruction: instruction()
    });

    expect(editMock).not.toHaveBeenCalled();
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      mimeType: "image/png",
      bytes: Buffer.from("png-bytes")
    });
    expect(result.images[0].filename).toMatch(/^202\d{5}-\d{6}-[a-f0-9]{8}-1\.png$/i);
  });

  it("passes model, quality, count, mapped size, and assistant text", async () => {
    const result = await generateOpenAiGptImages({
      apiKey: "openai-secret",
      model: "gpt-image-2",
      quality: "medium",
      instruction: instruction({ aspectRatio: "16:9", count: 2, assistantText: "Here you go" })
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-image-2",
        prompt: "poster of Seoul at dusk",
        n: 2,
        size: "1536x864",
        quality: "medium"
      }),
      { signal: undefined }
    );
    expect(result.assistantText).toBe("Here you go");
  });

  it("appends the negative prompt, applies defaults, and forwards the abort signal", async () => {
    const abortController = new AbortController();

    await generateOpenAiGptImages({
      apiKey: "openai-secret",
      instruction: instruction({ negativePrompt: "blur, watermark", aspectRatio: "3:4" }),
      abortSignal: abortController.signal
    });

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "poster of Seoul at dusk\n\nAvoid: blur, watermark",
        size: "960x1280",
        model: "gpt-image-2",
        quality: "auto"
      }),
      { signal: abortController.signal }
    );
  });

  it("edits reference images through the edit endpoint without a fixed size", async () => {
    const abortController = new AbortController();

    const result = await generateOpenAiGptImages({
      apiKey: "openai-secret",
      quality: "high",
      instruction: instruction({
        mode: "edit",
        imagePrompt: "change the hat color to red",
        count: 2
      }),
      inputImages: [referenceImage(), referenceImage({ filename: "second.jpg", mimeType: "image/jpeg" })],
      abortSignal: abortController.signal
    });

    expect(generateMock).not.toHaveBeenCalled();
    expect(toFileMock).toHaveBeenCalledTimes(2);
    expect(toFileMock).toHaveBeenNthCalledWith(
      1,
      new Uint8Array(Buffer.from("reference-bytes")),
      "reference.png",
      { type: "image/png" }
    );
    expect(editMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-image-2",
        prompt: "change the hat color to red",
        n: 2,
        quality: "high"
      }),
      { signal: abortController.signal }
    );
    expect(editMock.mock.calls[0][0]).not.toHaveProperty("size");
    expect(result.images[0].bytes).toEqual(Buffer.from("edited-bytes"));
  });

  it("falls back to generation when edit mode resolves no reference images", async () => {
    await generateOpenAiGptImages({
      apiKey: "openai-secret",
      instruction: instruction({ mode: "edit" }),
      inputImages: []
    });

    expect(editMock).not.toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it("throws when no images are returned", async () => {
    generateMock.mockResolvedValue({ data: [] });
    await expect(generateOpenAiGptImages({
      apiKey: "openai-secret",
      instruction: instruction()
    })).rejects.toThrow("OpenAI GPT Image returned no images");

    editMock.mockResolvedValue({ data: [{ revised_prompt: "x" }] });
    await expect(generateOpenAiGptImages({
      apiKey: "openai-secret",
      instruction: instruction({ mode: "edit" }),
      inputImages: [referenceImage()]
    })).rejects.toThrow("OpenAI GPT Image returned no images");
  });
});
