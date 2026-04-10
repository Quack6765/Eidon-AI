import type { ProviderProfileWithApiKey } from "@/lib/types";

const callProviderText = vi.fn();

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
    visionMode: "none",
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

describe("conversation title generator", () => {
  beforeEach(() => {
    callProviderText.mockReset();
  });

  it("builds a compact title-generation prompt", async () => {
    const { buildConversationTitlePrompt } = await import("@/lib/conversation-title-generator");
    const prompt = buildConversationTitlePrompt("Build a deployment checklist for me");

    expect(prompt).toContain("Prefer 2 to 4 words.");
    expect(prompt).toContain("Return only the title.");
    expect(prompt).toContain("Build a deployment checklist for me");
  });

  it("sanitizes quotes, line breaks, and excessive length", async () => {
    const { sanitizeGeneratedConversationTitle } = await import("@/lib/conversation-title-generator");

    expect(
      sanitizeGeneratedConversationTitle(
        "\"A very long generated title that keeps going far past the maximum length for the sidebar\"\nSecond line"
      )
    ).toBe("A very long generated title that keeps going");
  });

  it("truncates without word boundary when no space exists after position 16", async () => {
    const { sanitizeGeneratedConversationTitle } = await import("@/lib/conversation-title-generator");

    const result = sanitizeGeneratedConversationTitle(
      "Superlongwordthatexceedsthemaxlengthbyfar"
    );
    expect(result).toBe("Superlongwordthatexceedsthemaxlengthbyfar".slice(0, 48));
  });

  it("calls the provider with title purpose and returns a sanitized title", async () => {
    callProviderText.mockResolvedValue('  "Deployment Checklist."\n');

    const { generateConversationTitle } = await import("@/lib/conversation-title-generator");
    const title = await generateConversationTitle({
      settings: createSettings(),
      firstMessage: "Build a deployment checklist for me"
    });

    expect(title).toBe("Deployment Checklist");
    expect(callProviderText).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          model: "gpt-5-mini",
          apiMode: "responses"
        }),
        purpose: "title"
      })
    );
  });

  it("treats empty sanitized output as a failure", async () => {
    callProviderText.mockResolvedValue('""');

    const { generateConversationTitle } = await import("@/lib/conversation-title-generator");

    await expect(
      generateConversationTitle({
        settings: createSettings(),
        firstMessage: "Build a deployment checklist for me"
      })
    ).rejects.toThrow("Provider returned an empty title");
  });
});
