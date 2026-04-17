const createAttachments = vi.fn();
const bindAttachmentsToMessage = vi.fn();
const updateMessage = vi.fn();
const getMessage = vi.fn();
const compileImageInstruction = vi.fn();
const generateGoogleNanoBananaImages = vi.fn();

vi.mock("@/lib/attachments", () => ({
  createAttachments
}));

vi.mock("@/lib/conversations", () => ({
  bindAttachmentsToMessage,
  updateMessage,
  getMessage
}));

vi.mock("@/lib/image-generation/compile-image-instruction", () => ({
  compileImageInstruction
}));

vi.mock("@/lib/image-generation/google-nano-banana", () => ({
  generateGoogleNanoBananaImages
}));

describe("runImageTurn", () => {
  beforeEach(() => {
    vi.resetModules();
    createAttachments.mockReset();
    bindAttachmentsToMessage.mockReset();
    updateMessage.mockReset();
    getMessage.mockReset();
    compileImageInstruction.mockReset();
    generateGoogleNanoBananaImages.mockReset();

    compileImageInstruction.mockResolvedValue({
      imagePrompt: "blue square",
      negativePrompt: "",
      assistantText: "",
      aspectRatio: "1:1",
      count: 1
    });
    getMessage.mockReturnValue({
      id: "msg_assistant",
      conversationId: "conv_image",
      role: "assistant",
      content: "Generated 1 image.",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
      attachments: []
    });
    createAttachments.mockReturnValue([
      {
        id: "att_1",
        filename: "20260416-123456-deadbeef-1.png"
      }
    ]);
  });

  it("uses the google backend and falls back to a generic assistant message", async () => {
    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [
        {
          bytes: Buffer.from("png"),
          mimeType: "image/png",
          filename: "20260416-123456-deadbeef-1.png"
        }
      ]
    });

    const { runImageTurn } = await import("@/lib/image-generation/run-image-turn");

    await runImageTurn({
      conversationId: "conv_image",
      settings: {
        id: "profile_test",
        name: "Test profile",
        apiBaseUrl: "https://api.example.com/v1",
        apiKeyEncrypted: "",
        apiKey: "sk-test",
        model: "gpt-5-mini",
        apiMode: "responses",
        systemPrompt: "Be exact.",
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
      },
      appSettings: {
        defaultProviderProfileId: "profile_test",
        skillsEnabled: false,
        conversationRetention: "30d",
        memoriesEnabled: false,
        memoriesMaxCount: 100,
        mcpTimeout: 30000,
        sttEngine: "browser",
        sttLanguage: "auto",
        webSearchEngine: "disabled",
        exaApiKey: "",
        tavilyApiKey: "",
        searxngBaseUrl: "",
        imageGenerationBackend: "google_nano_banana",
        googleNanoBananaModel: "gemini-3.1-flash-image-preview",
        googleNanoBananaApiKey: "google-secret",
        updatedAt: new Date().toISOString()
      },
      assistantMessageId: "msg_assistant",
      promptMessages: [{ role: "user", content: "Generate a blue square" }]
    });

    expect(generateGoogleNanoBananaImages).toHaveBeenCalledTimes(1);
    expect(bindAttachmentsToMessage).toHaveBeenCalledWith("conv_image", "msg_assistant", ["att_1"]);
    expect(updateMessage).toHaveBeenCalledWith("msg_assistant", expect.objectContaining({
      content: "Generated 1 image.",
      status: "completed"
    }));
  });

  it("pluralizes the fallback assistant message when multiple images are stored", async () => {
    createAttachments.mockReturnValue([
      { id: "att_1", filename: "20260416-123456-deadbeef-1.png" },
      { id: "att_2", filename: "20260416-123456-deadbeef-2.png" }
    ]);
    generateGoogleNanoBananaImages.mockResolvedValue({
      assistantText: "",
      images: [
        {
          bytes: Buffer.from("png-one"),
          mimeType: "image/png",
          filename: "20260416-123456-deadbeef-1.png"
        },
        {
          bytes: Buffer.from("png-two"),
          mimeType: "image/png",
          filename: "20260416-123456-deadbeef-2.png"
        }
      ]
    });

    const { runImageTurn } = await import("@/lib/image-generation/run-image-turn");

    await runImageTurn({
      conversationId: "conv_image",
      settings: {
        id: "profile_test",
        name: "Test profile",
        apiBaseUrl: "https://api.example.com/v1",
        apiKeyEncrypted: "",
        apiKey: "sk-test",
        model: "gpt-5-mini",
        apiMode: "responses",
        systemPrompt: "Be exact.",
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
      },
      appSettings: {
        defaultProviderProfileId: "profile_test",
        skillsEnabled: false,
        conversationRetention: "30d",
        memoriesEnabled: false,
        memoriesMaxCount: 100,
        mcpTimeout: 30000,
        sttEngine: "browser",
        sttLanguage: "auto",
        webSearchEngine: "disabled",
        exaApiKey: "",
        tavilyApiKey: "",
        searxngBaseUrl: "",
        imageGenerationBackend: "google_nano_banana",
        googleNanoBananaModel: "gemini-3.1-flash-image-preview",
        googleNanoBananaApiKey: "google-secret",
        updatedAt: new Date().toISOString()
      },
      assistantMessageId: "msg_assistant",
      promptMessages: [{ role: "user", content: "Generate two blue squares" }]
    });

    expect(updateMessage).toHaveBeenCalledWith("msg_assistant", expect.objectContaining({
      content: "Generated 2 images.",
      status: "completed"
    }));
  });
});
