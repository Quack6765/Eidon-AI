import { decryptValue } from "@/lib/crypto";
import { getSettings, getSettingsWithApiKey, updateSettings } from "@/lib/settings";

describe("settings storage", () => {
  it("stores the API key encrypted and keeps it across partial updates", () => {
    updateSettings({
      apiBaseUrl: "https://api.example.com/v1",
      apiKey: "sk-test-123",
      model: "gpt-test",
      apiMode: "responses",
      systemPrompt: "Be exact.",
      temperature: 0.4,
      maxOutputTokens: 512,
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 16384,
      compactionThreshold: 0.8,
      freshTailCount: 12
    });

    const stored = getSettings();
    const withApiKey = getSettingsWithApiKey();

    expect(stored.apiKeyEncrypted).not.toBe("sk-test-123");
    expect(decryptValue(stored.apiKeyEncrypted)).toBe("sk-test-123");
    expect(withApiKey.apiKey).toBe("sk-test-123");

    updateSettings({
      apiBaseUrl: "https://api.example.com/v1",
      apiKey: "",
      model: "gpt-test-2",
      apiMode: "responses",
      systemPrompt: "Be exact.",
      temperature: 0.3,
      maxOutputTokens: 256,
      reasoningEffort: "low",
      reasoningSummaryEnabled: false,
      modelContextLimit: 12288,
      compactionThreshold: 0.75,
      freshTailCount: 10
    });

    expect(getSettingsWithApiKey().apiKey).toBe("sk-test-123");
  });
});
