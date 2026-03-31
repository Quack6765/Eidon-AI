import { decryptValue } from "@/lib/crypto";
import {
  getDefaultProviderProfileWithApiKey,
  getSettings,
  listProviderProfiles,
  updateSettings
} from "@/lib/settings";

function buildProfile(
  overrides: Partial<{
    id: string;
    name: string;
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    apiMode: "responses" | "chat_completions";
    systemPrompt: string;
    temperature: number;
    maxOutputTokens: number;
    reasoningEffort: "low" | "medium" | "high" | "xhigh";
    reasoningSummaryEnabled: boolean;
    modelContextLimit: number;
    compactionThreshold: number;
    freshTailCount: number;
  }> = {}
) {
  return {
    id: overrides.id ?? `profile_${crypto.randomUUID()}`,
    name: overrides.name ?? "Profile",
    apiBaseUrl: overrides.apiBaseUrl ?? "https://api.example.com/v1",
    apiKey: overrides.apiKey ?? "",
    model: overrides.model ?? "gpt-test",
    apiMode: overrides.apiMode ?? "responses",
    systemPrompt: overrides.systemPrompt ?? "Be exact.",
    temperature: overrides.temperature ?? 0.4,
    maxOutputTokens: overrides.maxOutputTokens ?? 512,
    reasoningEffort: overrides.reasoningEffort ?? "medium",
    reasoningSummaryEnabled: overrides.reasoningSummaryEnabled ?? true,
    modelContextLimit: overrides.modelContextLimit ?? 16384,
    compactionThreshold: overrides.compactionThreshold ?? 0.8,
    freshTailCount: overrides.freshTailCount ?? 12
  };
}

describe("settings storage", () => {
  it("stores multiple provider profiles, encrypts their keys, and switches the default", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });
    const beta = buildProfile({
      id: "profile_beta",
      name: "Beta",
      apiKey: "sk-beta",
      apiBaseUrl: "https://api.beta.example.com/v1",
      model: "gpt-beta"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: true,
      providerProfiles: [alpha, beta]
    });

    const storedProfiles = listProviderProfiles();
    const defaultProfile = getDefaultProviderProfileWithApiKey();

    expect(getSettings().defaultProviderProfileId).toBe(alpha.id);
    expect(getSettings().skillsEnabled).toBe(true);
    expect(storedProfiles).toHaveLength(2);
    expect(storedProfiles.map((profile) => profile.name)).toEqual(["Alpha", "Beta"]);
    expect(decryptValue(storedProfiles[0].apiKeyEncrypted)).toBe("sk-alpha");
    expect(decryptValue(storedProfiles[1].apiKeyEncrypted)).toBe("sk-beta");
    expect(defaultProfile?.apiKey).toBe("sk-alpha");

    updateSettings({
      defaultProviderProfileId: beta.id,
      skillsEnabled: false,
      providerProfiles: [
        {
          ...alpha,
          apiKey: ""
        },
        {
          ...beta,
          apiKey: ""
        }
      ]
    });

    expect(getSettings().defaultProviderProfileId).toBe(beta.id);
    expect(getSettings().skillsEnabled).toBe(false);
    expect(getDefaultProviderProfileWithApiKey()?.apiKey).toBe("sk-beta");
    expect(
      decryptValue(
        listProviderProfiles().find((profile) => profile.id === alpha.id)?.apiKeyEncrypted ?? ""
      )
    ).toBe("sk-alpha");
  });
});
