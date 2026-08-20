import { executeImageGeneration } from "@/lib/tool-executors";
import { createRuntimeAppSettings, createRuntimeProviderProfile } from "@/tests/provider-fixtures";
import type { PromptMessage } from "@/lib/types";

const { compileImageInstruction, generateImages, resolveEditInputImages, createAttachments } = vi.hoisted(() => ({
  compileImageInstruction: vi.fn(),
  generateImages: vi.fn(),
  resolveEditInputImages: vi.fn(),
  createAttachments: vi.fn()
}));

vi.mock("@/lib/image-generation/compile-image-instruction", () => ({ compileImageInstruction }));
vi.mock("@/lib/image-generation/provider", () => ({ generateImages }));
vi.mock("@/lib/image-generation/edit-inputs", () => ({ resolveEditInputImages }));
vi.mock("@/lib/attachments", () => ({
  createAttachments,
  bindAttachmentsToMessage: vi.fn()
}));

const promptMessages: PromptMessage[] = [
  { role: "user", content: "Change all keys to blue" }
];

function createContext() {
  return {
    input: {
      settings: createRuntimeProviderProfile(),
      appSettings: createRuntimeAppSettings({
        imageGeneration: {
          providerId: "openai_gpt_image",
          credentials: { apiKey: "openai-key" }
        }
      }),
      conversationId: "conv_1",
      assistantMessageId: "msg_1"
    },
    timelineSortOrder: 0,
    promptMessages
  };
}

describe("executeImageGeneration edit handling", () => {
  beforeEach(() => {
    compileImageInstruction.mockReset();
    generateImages.mockReset();
    resolveEditInputImages.mockReset();
    createAttachments.mockReset();
    createAttachments.mockResolvedValue([{ id: "att_1", filename: "generated-1.png" }]);
  });

  it("fails the action instead of silently generating when edit mode finds no reference image", async () => {
    compileImageInstruction.mockResolvedValue({
      mode: "edit",
      imagePrompt: "color every key blue",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    resolveEditInputImages.mockReturnValue([]);

    const result = await executeImageGeneration("call_1", { prompt: "Change all keys to blue" }, createContext());

    expect(result.toolSucceeded).toBe(false);
    expect(result.promptMessages.at(-1)?.content).toContain("Error: No reference image was available to edit");
    expect(generateImages).not.toHaveBeenCalled();
  });

  it("resolves edit inputs from the conversation and passes them to the provider", async () => {
    const inputImages = [{
      bytes: Buffer.from("reference-bytes"),
      mimeType: "image/png",
      filename: "keyboard.png"
    }];
    compileImageInstruction.mockResolvedValue({
      mode: "edit",
      imagePrompt: "color every key blue",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    resolveEditInputImages.mockReturnValue(inputImages);
    generateImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("edited"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });

    const context = createContext();
    const result = await executeImageGeneration("call_2", { prompt: "Change all keys to blue" }, context);

    expect(resolveEditInputImages).toHaveBeenCalledWith(promptMessages, "conv_1");
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({
      instruction: expect.objectContaining({ mode: "edit" }),
      inputImages
    }));
    expect(result.toolSucceeded).toBe(true);
  });

  it("does not resolve edit inputs in generate mode", async () => {
    compileImageInstruction.mockResolvedValue({
      mode: "generate",
      imagePrompt: "a brand new landscape",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    generateImages.mockResolvedValue({
      assistantText: "",
      images: [{
        bytes: Buffer.from("fresh"),
        mimeType: "image/png",
        filename: "generated-1.png"
      }]
    });

    await executeImageGeneration("call_3", { prompt: "generate a landscape" }, createContext());

    expect(resolveEditInputImages).not.toHaveBeenCalled();
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({ inputImages: undefined }));
  });
});
