import { describe, expect, it } from "vitest";
import {
  isExplicitImageRequest,
  isImageEditContinuation,
  isImageGenerationRequested,
  hasProhibitedImageIntent,
  isImageMetaDiscussion
} from "@/lib/image-generation/follow-up-context";
import { getLatestUserRequestText, hasActiveImageSession } from "@/lib/prompt-analysis";
import type { PromptMessage } from "@/lib/types";

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
    "No, use a pixel theme.",
    "add a hat",
    "make it 16:9",
    "give it sunglasses",
    "another one",
    "same but pixel art",
    "16:9",
    "a pixel theme instead",
    "the image you generated is wrong — make the cat bigger"
  ])("treats %j as an edit continuation when an image session is active", (text) => {
    expect(isImageEditContinuation(text, true)).toBe(true);
    expect(isImageGenerationRequested(text, true)).toBe(true);
    expect(isImageGenerationRequested(text, false)).toBe(false);
  });

  it("excludes bare acknowledgments from edit continuations", () => {
    expect(isImageEditContinuation("No.", true)).toBe(false);
    expect(isImageEditContinuation("yes", true)).toBe(false);
    expect(isImageEditContinuation("perfect.", true)).toBe(false);
    expect(isImageEditContinuation("yes, go ahead", false)).toBe(false);
    expect(isImageEditContinuation("yes, go ahead", true)).toBe(true);
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
      { role: "user", content: "No, use a pixel theme." }
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
