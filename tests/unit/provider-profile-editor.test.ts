import {
  applyPresetToProviderProfile,
  createProviderProfileEditorDraft,
  getMatchingEditorPresetId,
  setProviderApiMode,
  switchProviderProfileKind
} from "@/lib/provider-profile-editor";

describe("provider profile editor", () => {
  it("creates configuration shaped for each provider kind", () => {
    const openAi = createProviderProfileEditorDraft({ providerKind: "openai_compatible" });
    const anthropic = createProviderProfileEditorDraft({ providerKind: "anthropic" });
    const copilot = createProviderProfileEditorDraft({ providerKind: "github_copilot" });

    expect(openAi.providerConfig).toMatchObject({
      apiMode: "responses",
      processingMode: "standard",
      reasoningParameterMode: "standard"
    });
    expect(anthropic.providerConfig).toEqual({ apiBaseUrl: "https://api.anthropic.com" });
    expect(copilot.providerConfig).toEqual({});
  });

  it("switches provider kinds while preserving shared profile behavior", () => {
    const original = createProviderProfileEditorDraft({
      id: "profile_test",
      name: "Shared profile"
    });
    const unchanged = switchProviderProfileKind(original, "openai_compatible");
    const switched = switchProviderProfileKind(original, "anthropic");

    expect(unchanged).toBe(original);
    expect(switched).toMatchObject({
      id: original.id,
      name: original.name,
      providerKind: "anthropic",
      systemPrompt: original.systemPrompt,
      compactionThreshold: original.compactionThreshold,
      freshTailCount: original.freshTailCount,
      visionMode: original.visionMode,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt
    });
  });

  it("applies only presets belonging to the selected provider kind", () => {
    const anthropic = createProviderProfileEditorDraft({ providerKind: "anthropic" });

    expect(applyPresetToProviderProfile(anthropic, "openrouter")).toBe(anthropic);
    expect(applyPresetToProviderProfile(anthropic, "anthropic_official")).toMatchObject({
      providerPresetId: "anthropic_official",
      providerConfig: { apiBaseUrl: "https://api.anthropic.com" },
      credentialAction: "clear"
    });
  });

  it("matches presets using each provider configuration shape", () => {
    const openAi = createProviderProfileEditorDraft({ providerKind: "openai_compatible" });
    const anthropic = createProviderProfileEditorDraft({ providerKind: "anthropic" });
    const copilot = createProviderProfileEditorDraft({ providerKind: "github_copilot" });

    expect(getMatchingEditorPresetId(openAi)).toBe("openai_official");
    expect(getMatchingEditorPresetId(anthropic)).toBe("anthropic_official");
    expect(getMatchingEditorPresetId(copilot)).toBeNull();
  });

  it("changes API mode only for OpenAI-compatible profiles", () => {
    const openAi = createProviderProfileEditorDraft({ providerKind: "openai_compatible" });
    const anthropic = createProviderProfileEditorDraft({ providerKind: "anthropic" });

    expect(setProviderApiMode(anthropic, "responses")).toBe(anthropic);
    expect(setProviderApiMode(openAi, "chat_completions")).toMatchObject({
      providerConfig: {
        apiMode: "chat_completions"
      },
      providerPresetId: null
    });
  });
});
