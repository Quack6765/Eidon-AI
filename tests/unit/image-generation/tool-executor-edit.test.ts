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

const editPromptMessages: PromptMessage[] = [
  { role: "user", content: "generate an image of a keyboard" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_prev", name: "generate_image", arguments: JSON.stringify({ prompt: "a keyboard" }) }]
  },
  {
    role: "tool",
    toolCallId: "call_prev",
    content: "Successfully generated 1 image. Generated 1 image: keyboard.png"
  },
  { role: "user", content: "Change all keys to blue" }
];

const generatePromptMessages: PromptMessage[] = [
  { role: "user", content: "Generate an image of a landscape" }
];

function createContext(promptMessages: PromptMessage[] = editPromptMessages) {
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

    expect(resolveEditInputImages).toHaveBeenCalledWith(editPromptMessages, "conv_1", undefined);
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

    await executeImageGeneration("call_3", { prompt: "generate a landscape" }, createContext(generatePromptMessages));

    expect(resolveEditInputImages).not.toHaveBeenCalled();
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({ inputImages: undefined }));
  });

  it("threads explicit image roles from the tool arguments", async () => {
    compileImageInstruction.mockResolvedValue({
      mode: "edit",
      imagePrompt: "place the logo",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    resolveEditInputImages.mockReturnValue([{
      bytes: Buffer.from("base"),
      mimeType: "image/png",
      filename: "base.png",
      role: "canvas",
      label: "base photo"
    }]);
    generateImages.mockResolvedValue({
      assistantText: "",
      images: [{ bytes: Buffer.from("edited"), mimeType: "image/png", filename: "generated-1.png" }]
    });

    await executeImageGeneration("call_4", {
      prompt: "place the logo",
      images: [
        { filename: "logo.png", role: "content", label: "the logo" },
        { filename: "base.png", role: "canvas", label: "base photo" }
      ]
    }, createContext());

    expect(resolveEditInputImages).toHaveBeenCalledWith(editPromptMessages, "conv_1", [
      { filename: "logo.png", role: "content", label: "the logo" },
      { filename: "base.png", role: "canvas", label: "base photo" }
    ]);
  });

  it("resolves input images when placement is set even without edit mode", async () => {
    compileImageInstruction.mockResolvedValue({
      mode: "generate",
      imagePrompt: "make the photo moodier",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1,
      placement: {
        kind: "anchor",
        anchor: "bottom-right",
        widthPercent: 22,
        opacity: 1,
        rotationDeg: 0,
        marginPercent: 3,
        restyle: true
      }
    });
    resolveEditInputImages.mockReturnValue([{
      bytes: Buffer.from("base"),
      mimeType: "image/png",
      filename: "base.png",
      role: "canvas",
      label: "base photo"
    }]);
    generateImages.mockResolvedValue({
      assistantText: "",
      images: [{ bytes: Buffer.from("edited"), mimeType: "image/png", filename: "generated-1.png" }]
    });

    const result = await executeImageGeneration("call_6", { prompt: "add the logo" }, createContext());

    expect(resolveEditInputImages).toHaveBeenCalledWith(editPromptMessages, "conv_1", undefined);
    expect(generateImages).toHaveBeenCalled();
    expect(result.toolSucceeded).toBe(true);
  });

  it("fails instead of discarding images when placement is set but nothing resolves", async () => {
    compileImageInstruction.mockResolvedValue({
      mode: "generate",
      imagePrompt: "make the photo moodier",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1,
      placement: { kind: "semantic", hint: "onto the black t-shirt" }
    });
    resolveEditInputImages.mockReturnValue([]);

    const result = await executeImageGeneration("call_7", { prompt: "add the logo" }, createContext());

    expect(result.toolSucceeded).toBe(false);
    expect(result.promptMessages.at(-1)?.content).toContain("Error: No reference image was available to edit");
    expect(generateImages).not.toHaveBeenCalled();
  });

  it("names the resolved roles in the result summary", async () => {
    compileImageInstruction.mockResolvedValue({
      mode: "edit",
      imagePrompt: "place the logo",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    resolveEditInputImages.mockReturnValue([
      {
        bytes: Buffer.from("base"),
        mimeType: "image/png",
        filename: "base.png",
        role: "canvas",
        label: "base photo"
      },
      {
        bytes: Buffer.from("logo"),
        mimeType: "image/png",
        filename: "logo.png",
        role: "content",
        label: "the logo"
      }
    ]);
    generateImages.mockResolvedValue({
      assistantText: "",
      images: [{ bytes: Buffer.from("edited"), mimeType: "image/png", filename: "generated-1.png" }]
    });

    const result = await executeImageGeneration("call_5", { prompt: "place the logo" }, createContext());

    expect(result.promptMessages.at(-1)?.content).toContain("using base photo + the logo");
    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({ mask: undefined }));
  });
});
