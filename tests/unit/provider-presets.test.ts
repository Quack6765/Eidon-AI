import { DEFAULT_PROVIDER_SETTINGS } from "@/lib/constants";
import {
  applyProviderPreset,
  getMatchingProviderPresetId,
  getProviderPreset
} from "@/lib/provider-presets";

function createProfile() {
  return {
    id: "profile_test",
    name: "Original profile",
    apiBaseUrl: "https://example.com/v1",
    model: "example-model",
    apiMode: "responses" as const,
    reasoningEffort: "high" as const,
    reasoningSummaryEnabled: false,
    modelContextLimit: 32000,
    apiKey: "sk-test",
    hasApiKey: true,
    systemPrompt: "Keep this prompt.",
    temperature: 0.3,
    maxOutputTokens: 900,
    compactionThreshold: 0.81,
    freshTailCount: 19
  };
}

describe("provider presets", () => {
  it("applies the Ollama Cloud preset values without overwriting the name", () => {
    const profile = applyProviderPreset(createProfile(), "ollama_cloud");

    expect(profile.name).toBe("Original profile");
    expect(profile.apiBaseUrl).toBe("https://ollama.com/v1");
    expect(profile.model).toBe("glm-4.7:cloud");
    expect(profile.apiMode).toBe("chat_completions");
    expect(profile.reasoningEffort).toBe("medium");
    expect(profile.reasoningSummaryEnabled).toBe(true);
    expect(profile.modelContextLimit).toBe(64000);
  });

  it("applies the GLM Coding Plan preset values without overwriting the name", () => {
    const profile = applyProviderPreset(createProfile(), "glm_coding_plan");

    expect(profile.name).toBe("Original profile");
    expect(profile.apiBaseUrl).toBe("https://api.z.ai/api/coding/paas/v4");
    expect(profile.model).toBe("glm-5.1");
    expect(profile.apiMode).toBe("chat_completions");
    expect(profile.reasoningEffort).toBe("medium");
    expect(profile.reasoningSummaryEnabled).toBe(true);
    expect(profile.modelContextLimit).toBe(200000);
  });

  it("applies the custom OpenAI compatible preset values without overwriting the name", () => {
    const profile = applyProviderPreset(createProfile(), "custom_openai_compatible");

    expect(profile.name).toBe("Original profile");
    expect(profile.apiBaseUrl).toBe("https://api.openai.com/v1");
    expect(profile.model).toBe("gpt-5-mini");
    expect(profile.apiMode).toBe("responses");
    expect(profile.reasoningEffort).toBe("medium");
    expect(profile.reasoningSummaryEnabled).toBe(true);
    expect(profile.modelContextLimit).toBe(200000);
  });

  it("applies the OpenRouter preset values without overwriting the name", () => {
    const profile = applyProviderPreset(createProfile(), "openrouter");

    expect(profile.name).toBe("Original profile");
    expect(profile.apiBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(profile.model).toBe("");
    expect(profile.apiMode).toBe(DEFAULT_PROVIDER_SETTINGS.apiMode);
    expect(profile.reasoningEffort).toBe(DEFAULT_PROVIDER_SETTINGS.reasoningEffort);
    expect(profile.reasoningSummaryEnabled).toBe(
      DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled
    );
    expect(profile.modelContextLimit).toBe(200000);
  });

  it("applies the OpenCode Go preset values without overwriting the name", () => {
    const profile = applyProviderPreset(createProfile(), "opencode_go");

    expect(profile.name).toBe("Original profile");
    expect(profile.apiBaseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(profile.model).toBe("kimi-k2.6");
    expect(profile.apiMode).toBe("chat_completions");
    expect(profile.reasoningEffort).toBe("medium");
    expect(profile.reasoningSummaryEnabled).toBe(true);
    expect(profile.modelContextLimit).toBe(200000);
  });

  it("matches a profile back to the OpenCode Go preset when the provider fields align", () => {
    const profile = {
      ...createProfile(),
      ...getProviderPreset("opencode_go").values
    };

    expect(getMatchingProviderPresetId(profile)).toBe("opencode_go");
  });

  it("matches a profile back to its preset even with a different name", () => {
    const { name: _presetName, ...presetValues } = getProviderPreset("ollama_cloud").values;
    const profile = {
      ...createProfile(),
      ...presetValues,
      name: "My Custom Ollama"
    };

    expect(getMatchingProviderPresetId(profile)).toBe("ollama_cloud");
  });

  it("preserves non-provider tuning and secrets when applying a preset", () => {
    const original = createProfile();
    const profile = applyProviderPreset(original, "glm_coding_plan");

    expect(profile.apiKey).toBe(original.apiKey);
    expect(profile.hasApiKey).toBe(original.hasApiKey);
    expect(profile.systemPrompt).toBe(original.systemPrompt);
    expect(profile.temperature).toBe(original.temperature);
    expect(profile.maxOutputTokens).toBe(original.maxOutputTokens);
    expect(profile.compactionThreshold).toBe(original.compactionThreshold);
    expect(profile.freshTailCount).toBe(original.freshTailCount);
  });

  it("matches a profile back to its preset when the provider fields align", () => {
    const profile = {
      ...createProfile(),
      ...getProviderPreset("glm_coding_plan").values
    };

    expect(getMatchingProviderPresetId(profile)).toBe("glm_coding_plan");
  });

  it("matches a profile back to the OpenRouter preset when the provider fields align", () => {
    const profile = {
      ...createProfile(),
      ...getProviderPreset("openrouter").values
    };

    expect(getMatchingProviderPresetId(profile)).toBe("openrouter");
  });

  it("returns null when a profile no longer matches a preset exactly", () => {
    const profile = {
      ...createProfile(),
      ...getProviderPreset("ollama_cloud").values,
      model: "glm-4.7:cloud-custom"
    };

    expect(getMatchingProviderPresetId(profile)).toBeNull();
  });

  it("throws for unknown preset id", () => {
    expect(() => getProviderPreset("nonexistent_preset" as any)).toThrow("Unknown provider preset");
  });

  it("applies the Anthropic official preset to an anthropic profile", () => {
    const profile = applyProviderPreset(
      { ...createProfile(), providerKind: "anthropic" },
      "anthropic_official"
    );

    expect(profile.apiBaseUrl).toBe("https://api.anthropic.com");
    expect(profile.model).toBe("claude-opus-4-8");
  });

  it("applies the OpenCode Go Anthropic preset to an anthropic profile", () => {
    const profile = applyProviderPreset(
      { ...createProfile(), providerKind: "anthropic" },
      "opencode_go_anthropic"
    );

    expect(profile.apiBaseUrl).toBe("https://opencode.ai/zen/go");
    expect(profile.model).toBe("qwen3.7-max");
  });

  it("does not apply an anthropic preset to an openai_compatible profile", () => {
    const original = { ...createProfile(), providerKind: "openai_compatible" as const };
    const profile = applyProviderPreset(original, "anthropic_official");

    expect(profile.apiBaseUrl).toBe(original.apiBaseUrl);
    expect(profile.model).toBe(original.model);
  });

  it("matches an anthropic profile back to its preset", () => {
    const profile = {
      ...createProfile(),
      providerKind: "anthropic" as const,
      ...getProviderPreset("anthropic_official").values
    };

    expect(getMatchingProviderPresetId(profile)).toBe("anthropic_official");
  });

  it("does not match an openai_compatible profile to an anthropic preset", () => {
    const profile = {
      ...createProfile(),
      providerKind: "openai_compatible" as const,
      ...getProviderPreset("anthropic_official").values
    };

    expect(getMatchingProviderPresetId(profile)).toBeNull();
  });
});
