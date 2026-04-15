import { compileImageInstruction, extractJsonObject } from "@/lib/image-generation/compile-image-instruction";
import type { ProviderProfileWithApiKey } from "@/lib/types";

const { callProviderText } = vi.hoisted(() => ({
  callProviderText: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  callProviderText
}));

function createSettings(): ProviderProfileWithApiKey {
  return {
    id: "profile_test",
    name: "Test profile",
    apiBaseUrl: "https://api.example.com/v1",
    apiKeyEncrypted: "",
    apiKey: "sk-test",
    model: "gpt-5-mini",
    apiMode: "responses",
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
    visionMcpServerId: null,
    providerKind: "openai_compatible",
    githubUserAccessTokenEncrypted: "",
    githubRefreshTokenEncrypted: "",
    githubTokenExpiresAt: null,
    githubRefreshTokenExpiresAt: null,
    githubAccountLogin: null,
    githubAccountName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const profile = createSettings();

describe("compileImageInstruction", () => {
  beforeEach(() => {
    callProviderText.mockReset();
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
      imagePrompt: "cinematic Seoul skyline at dusk",
      negativePrompt: "",
      assistantText: "Here is a first pass.",
      aspectRatio: "1:1",
      count: 1
    });
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
