import fs from "node:fs";
import path from "node:path";

import { compileImageInstruction, extractJsonObject } from "@/lib/image-generation/compile-image-instruction";
import type { RuntimeProviderProfile } from "@/lib/types";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

const { callProviderText } = vi.hoisted(() => ({
  callProviderText: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  callProviderText
}));

function createSettings(): RuntimeProviderProfile {
  return createRuntimeProviderProfile({
    id: "profile_test",
    name: "Test profile",
    providerConfig: { apiBaseUrl: "https://api.example.com/v1", apiMode: "responses" },
    credentials: { apiKey: "sk-test" },
    model: "gpt-5-mini",
    systemPrompt: "Be exact",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium",
    reasoningSummaryEnabled: true,
    modelContextLimit: 16000,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    tokenizerModel: "gpt-tokenizer",
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    visionMode: "native",
    providerPresetId: null,
    providerKind: "openai_compatible",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

const profile = createSettings();

describe("compileImageInstruction", () => {
  beforeEach(() => {
    callProviderText.mockReset();
  });

  it("describes images attached to the latest user request with dimensions and edit-input note", async () => {
    callProviderText.mockResolvedValue(`
\`\`\`json
{"imagePrompt":"make a noir poster like this photo","mode":"edit","assistantText":"","count":1}
\`\`\`
`);

    const relativePath = "conv_desc/att_desc_photo.png";
    const absolutePath = path.resolve(process.env.EIDON_DATA_DIR!, "attachments", relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.copyFileSync(path.resolve("tests/fixtures/images/tiny.png"), absolutePath);

    try {
      await compileImageInstruction({
        settings: profile,
        promptMessages: [
          {
            role: "user",
            content: [
              { type: "text", text: "make a poster like this" },
              {
                type: "image",
                attachmentId: "att_desc",
                filename: "photo.png",
                mimeType: "image/png",
                relativePath
              }
            ]
          }
        ],
        callProviderText
      });

      const prompt = callProviderText.mock.calls[0][0].prompt;
      expect(prompt).toContain("Images attached to the latest user request");
      expect(prompt).toContain("photo.png (8x8)");
      expect(prompt).toContain("provided to the image backend as edit inputs");
    } finally {
      fs.rmSync(path.resolve(process.env.EIDON_DATA_DIR!, "attachments"), {
        recursive: true,
        force: true
      });
    }
  });

  it("builds image instructions from the latest user message only", async () => {
    callProviderText.mockResolvedValue(`
\`\`\`json
{"imagePrompt":"generate a picture of a cat","assistantText":"","count":1}
\`\`\`
`);

    await compileImageInstruction({
      settings: profile,
      promptMessages: [
        { role: "user", content: "generate a picture of a mage" },
        { role: "assistant", content: "Generated 1 image." },
        { role: "user", content: "generate a picture of a cat" }
      ],
      callProviderText
    });

    const prompt = callProviderText.mock.calls[0][0].prompt;
    expect(prompt).toContain("user: generate a picture of a cat");
    expect(prompt).not.toContain("generate a picture of a mage");
    expect(prompt).not.toContain("Generated 1 image.");
  });

  it("includes recent user image context when the latest request explicitly refers to prior results", async () => {
    callProviderText.mockResolvedValue(`
\`\`\`json
{"imagePrompt":"make the previous mage noir","assistantText":"","count":1}
\`\`\`
`);

    await compileImageInstruction({
      settings: profile,
      promptMessages: [
        { role: "user", content: "generate a picture of a mage" },
        { role: "assistant", content: "Generated 1 image." },
        { role: "user", content: "make the previous mage noir" }
      ],
      callProviderText
    });

    const prompt = callProviderText.mock.calls[0][0].prompt;
    expect(prompt).toContain("Relevant earlier user image requests:");
    expect(prompt).toContain("user: generate a picture of a mage");
    expect(prompt).toContain("Latest user request:\nuser: make the previous mage noir");
  });

  it("includes prior context and an edit hint for short follow-up revisions", async () => {
    callProviderText.mockResolvedValue(`
\`\`\`json
{"imagePrompt":"pixel theme version of the previous scene","mode":"edit","assistantText":"","count":1}
\`\`\`
`);

    await compileImageInstruction({
      settings: profile,
      promptMessages: [
        { role: "user", content: "generate a picture of a mage" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_prev", name: "generate_image", arguments: "{}" }]
        },
        {
          role: "tool",
          toolCallId: "call_prev",
          content: "Successfully generated 1 image. Generated 1 image: mage.png"
        },
        { role: "user", content: "No, use a pixel theme." }
      ],
      callProviderText
    });

    const prompt = callProviderText.mock.calls[0][0].prompt;
    expect(prompt).toContain("Relevant earlier user image requests:");
    expect(prompt).toContain("user: generate a picture of a mage");
    expect(prompt).toContain("short follow-up revising a recently generated image");
    expect(prompt).toContain("Latest user request:\nuser: No, use a pixel theme.");
  });

  it("extracts fenced JSON and defaults optional fields", async () => {
    callProviderText.mockResolvedValue(`
\`\`\`json
{"imagePrompt":"cinematic Seoul skyline at dusk","assistantText":"Here is a first pass.","count":1}
\`\`\`
`);

    const instruction = await compileImageInstruction({
      settings: profile,
      promptMessages: [
        { role: "user", content: "Generate a cinematic Seoul skyline at dusk" }
      ],
      callProviderText
    });

    expect(instruction).toEqual({
      mode: "generate",
      imagePrompt: "cinematic Seoul skyline at dusk",
      negativePrompt: "",
      assistantText: "Here is a first pass.",
      aspectRatio: "1:1",
      count: 1
    });
  });

  it("keeps edit mode when the compiler flags a modification request", async () => {
    callProviderText.mockResolvedValue(`
\`\`\`json
{"mode":"edit","imagePrompt":"change the hat color to red","assistantText":"Updated the hat.","count":1}
\`\`\`
`);

    const instruction = await compileImageInstruction({
      settings: profile,
      promptMessages: [
        { role: "user", content: "generate a cat wearing a hat" },
        { role: "assistant", content: "Successfully generated 1 image." },
        { role: "user", content: "change the hat to red" }
      ],
      callProviderText
    });

    expect(instruction.mode).toBe("edit");
    expect(instruction.imagePrompt).toBe("change the hat color to red");
    const prompt = callProviderText.mock.calls[0][0].prompt;
    expect(prompt).toContain('mode: "generate" | "edit"');
  });

  it("throws when the provider returns non-json output", async () => {
    callProviderText.mockResolvedValue("just do something cool");

    await expect(
      compileImageInstruction({
        settings: profile,
        promptMessages: [{ role: "user", content: "make it noir" }],
        callProviderText
      })
    ).rejects.toThrow("Provider returned invalid image instruction JSON");
  });
});

describe("extractJsonObject", () => {
  it("extracts JSON from fenced code block", () => {
    const raw = `\`\`\`json\n{"key":"value"}\n\`\`\``;
    expect(extractJsonObject(raw)).toEqual({ key: "value" });
  });

  it("extracts JSON from plain text with braces", () => {
    const raw = `Some text before {"key":"value"} some text after`;
    expect(extractJsonObject(raw)).toEqual({ key: "value" });
  });

  it("throws when no braces found", () => {
    expect(() => extractJsonObject("no json here")).toThrow(
      "Provider returned invalid image instruction JSON"
    );
  });
});
