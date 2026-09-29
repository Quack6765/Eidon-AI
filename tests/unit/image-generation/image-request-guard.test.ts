import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isExplicitImageRequest,
  isImageEditContinuation,
  isImageGenerationRequested,
  hasProhibitedImageIntent,
  isImageMetaDiscussion
} from "@/lib/image-generation/follow-up-context";
import { getLatestUserRequestText, hasActiveImageSession } from "@/lib/prompt-analysis";
import { executeImageGeneration } from "@/lib/tool-executors";
import { createRuntimeAppSettings, createRuntimeProviderProfile } from "@/tests/provider-fixtures";
import type { PromptMessage } from "@/lib/types";

const { compileImageInstruction, generateImages, resolveEditInputImages, createAttachments, bindAttachmentsToMessage } =
  vi.hoisted(() => ({
    compileImageInstruction: vi.fn(),
    generateImages: vi.fn(),
    resolveEditInputImages: vi.fn(),
    createAttachments: vi.fn(),
    bindAttachmentsToMessage: vi.fn()
  }));

vi.mock("@/lib/image-generation/compile-image-instruction", () => ({ compileImageInstruction }));
vi.mock("@/lib/image-generation/provider", () => ({ generateImages }));
vi.mock("@/lib/image-generation/edit-inputs", () => ({ resolveEditInputImages }));
vi.mock("@/lib/attachments", () => ({
  createAttachments,
  bindAttachmentsToMessage,
  resolveAbsoluteImagePathPart: vi.fn()
}));

function createContext(promptMessages: PromptMessage[], onActionStart = vi.fn()) {
  return {
    input: {
      settings: createRuntimeProviderProfile(),
      appSettings: createRuntimeAppSettings({
        imageGeneration: {
          providerId: "openai_gpt_image",
          credentials: { apiKey: "openai-key" }
        }
      }),
      conversationId: "conv_guard",
      assistantMessageId: "msg_guard",
      onActionStart
    },
    timelineSortOrder: 0,
    promptMessages
  };
}

describe("image request detection", () => {
  it.each([
    "Don't ever generate images until I tell you to",
    "don't generate an image of a cat",
    "never make images again",
    "stop creating pictures",
    "no more images please",
    "I don't want an image for this",
    "do not use images in your answer"
  ])("treats %j as a prohibition and never as a request", (text) => {
    expect(hasProhibitedImageIntent(text)).toBe(true);
    expect(isExplicitImageRequest(text)).toBe(false);
    expect(isImageGenerationRequested(text, true)).toBe(false);
    expect(isImageGenerationRequested(text, false)).toBe(false);
  });

  it.each([
    "why did you generate an image?",
    "did you make a picture?",
    "what image do you see?"
  ])("treats %j as meta discussion, not a request", (text) => {
    expect(isImageMetaDiscussion(text)).toBe(true);
    expect(isImageGenerationRequested(text, true)).toBe(false);
  });

  it.each([
    "generate an image of a cat",
    "draw me a picture of the Eiffel tower",
    "I want an image of my dog",
    "can you make a poster of my dog?",
    "make me a 16:9 render of a castle",
    "Generate a simple blue square",
    "don't forget to generate an image of a cat"
  ])("treats %j as an explicit image request", (text) => {
    expect(isExplicitImageRequest(text)).toBe(true);
    expect(isImageGenerationRequested(text, false)).toBe(true);
  });

  it.each([
    "merge the duplicate iPad memories, keeping the richer one",
    "do a memory audit",
    "make sure the deployment is clean",
    "summarize the changes for end users"
  ])("does not treat unrelated task text %j as an image request even with image context", (text) => {
    expect(isExplicitImageRequest(text)).toBe(false);
    expect(isImageEditContinuation(text, true)).toBe(false);
    expect(isImageGenerationRequested(text, true)).toBe(false);
  });

  it.each([
    "add a hat",
    "make it 16:9",
    "give it sunglasses",
    "another one",
    "the image you generated is wrong — make the cat bigger"
  ])("treats %j as an edit continuation when an image session is active", (text) => {
    expect(isImageEditContinuation(text, true)).toBe(true);
    expect(isImageGenerationRequested(text, true)).toBe(true);
    expect(isImageGenerationRequested(text, false)).toBe(false);
  });

  it("does not treat a confirmation reply as a request", () => {
    expect(isImageGenerationRequested("yes, go ahead", true)).toBe(false);
    expect(isImageGenerationRequested("ok do it", true)).toBe(false);
  });
});

describe("prompt message helpers", () => {
  it("strips synthetic attachment lines from the latest user request text", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Don't ever generate images until I tell you to" },
          { type: "text", text: "Previous image reference: 20260929-202101-63d2c6c2-1.png" }
        ]
      }
    ];
    expect(getLatestUserRequestText(messages)).toBe("Don't ever generate images until I tell you to");
  });

  it("detects an active image session from a recent successful generate_image exchange", () => {
    const messages: PromptMessage[] = [
      { role: "user", content: "generate an image of a keyboard" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_prev", name: "generate_image", arguments: "{}" }]
      },
      { role: "tool", toolCallId: "call_prev", content: "Successfully generated 1 image. Generated 1 image: keyboard.png" },
      { role: "user", content: "add a hat" }
    ];
    expect(hasActiveImageSession(messages)).toBe(true);
  });

  it("does not treat an error result as an active image session", () => {
    const messages: PromptMessage[] = [
      { role: "user", content: "generate an image of a keyboard" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_prev", name: "generate_image", arguments: "{}" }]
      },
      { role: "tool", toolCallId: "call_prev", content: "Error: backend failed" },
      { role: "user", content: "add a hat" }
    ];
    expect(hasActiveImageSession(messages)).toBe(false);
  });

  it("treats baseline image reference parts as an active image session", () => {
    const messages: PromptMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "add a hat" },
          { type: "text", text: "Previous image reference: keyboard.png" }
        ]
      }
    ];
    expect(hasActiveImageSession(messages)).toBe(true);
  });

  it("has no image session when the conversation contains none", () => {
    const messages: PromptMessage[] = [
      { role: "user", content: "merge the duplicate memories" },
      { role: "assistant", content: "Done." },
      { role: "user", content: "add a hat" }
    ];
    expect(hasActiveImageSession(messages)).toBe(false);
  });
});

describe("executeImageGeneration guard", () => {
  beforeEach(() => {
    compileImageInstruction.mockReset();
    generateImages.mockReset();
    resolveEditInputImages.mockReset();
    createAttachments.mockReset();
    bindAttachmentsToMessage.mockReset();
    createAttachments.mockResolvedValue([{ id: "att_1", filename: "generated-1.png" }]);
    compileImageInstruction.mockResolvedValue({
      mode: "generate",
      imagePrompt: "compiled",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    generateImages.mockResolvedValue({
      assistantText: "",
      images: [{ bytes: Buffer.from("png"), mimeType: "image/png", filename: "generated-1.png" }]
    });
  });

  it("refuses unrequested generation without spending provider credits or opening an action", async () => {
    const onActionStart = vi.fn();
    const context = createContext(
      [{ role: "user", content: "merge the duplicate iPad memories, keeping the richer one" }],
      onActionStart
    );

    const result = await executeImageGeneration(
      "call_guard_1",
      { prompt: "a graph showing the merge completed" },
      context
    );

    expect(result.toolSucceeded).toBe(false);
    expect(result.promptMessages.at(-1)?.content).toContain("did not explicitly request an image");
    expect(generateImages).not.toHaveBeenCalled();
    expect(createAttachments).not.toHaveBeenCalled();
    expect(onActionStart).not.toHaveBeenCalled();
  });

  it("refuses generation on a prohibition even with an active image session", async () => {
    const context = createContext([
      { role: "user", content: "generate an image of a cat" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_prev", name: "generate_image", arguments: "{}" }]
      },
      { role: "tool", toolCallId: "call_prev", content: "Successfully generated 1 image. Generated 1 image: cat.png" },
      { role: "user", content: "Don't ever generate images until I tell you to" }
    ]);

    const result = await executeImageGeneration("call_guard_2", { prompt: "a cat" }, context);

    expect(result.toolSucceeded).toBe(false);
    expect(generateImages).not.toHaveBeenCalled();
  });

  it("allows generation for an explicit request", async () => {
    const context = createContext([{ role: "user", content: "generate an image of a cat" }]);

    const result = await executeImageGeneration("call_guard_3", { prompt: "a cat" }, context);

    expect(result.toolSucceeded).toBe(true);
    expect(generateImages).toHaveBeenCalledTimes(1);
  });

  it("allows an edit continuation after a recently generated image", async () => {
    const context = createContext([
      { role: "user", content: "generate an image of a keyboard" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_prev", name: "generate_image", arguments: "{}" }]
      },
      { role: "tool", toolCallId: "call_prev", content: "Successfully generated 1 image. Generated 1 image: keyboard.png" },
      { role: "user", content: "add a hat" }
    ]);

    const result = await executeImageGeneration("call_guard_4", { prompt: "add a hat to the keyboard" }, context);

    expect(result.toolSucceeded).toBe(true);
    expect(generateImages).toHaveBeenCalledTimes(1);
  });

  it("refuses the same edit continuation without an image session", async () => {
    const context = createContext([
      { role: "user", content: "add a hat" }
    ]);

    const result = await executeImageGeneration("call_guard_5", { prompt: "add a hat" }, context);

    expect(result.toolSucceeded).toBe(false);
    expect(generateImages).not.toHaveBeenCalled();
  });
});
