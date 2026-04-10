import { decryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createConversation, getConversation, updateConversationProviderProfile } from "@/lib/conversations";
import {
  getDefaultProviderProfile,
  getProviderProfile,
  getProviderProfileWithApiKey,
  getSanitizedSettings,
  getSettingsForUser,
  getDefaultProviderProfileWithApiKey,
  getSettingsDefaults,
  getSettings,
  listProviderProfiles,
  updateGeneralSettingsForUser,
  updateSettings
} from "@/lib/settings";
import { createLocalUser } from "@/lib/users";

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

  it("reassigns conversations when a provider profile is removed", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });
    const beta = buildProfile({
      id: "profile_beta",
      name: "Beta",
      apiKey: "sk-beta"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: true,
      providerProfiles: [alpha, beta]
    });

    const conversation = createConversation();
    updateConversationProviderProfile(conversation.id, beta.id);

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: true,
      providerProfiles: [alpha]
    });

    expect(getConversation(conversation.id)?.providerProfileId).toBe(alpha.id);
    expect(listProviderProfiles().map((profile) => profile.id)).toEqual([alpha.id]);
  });

  it("sanitizes profiles and tolerates unreadable encrypted keys", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });
    const beta = buildProfile({
      id: "profile_beta",
      name: "Beta",
      apiKey: ""
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      providerProfiles: [alpha, beta]
    });

    getDb()
      .prepare("UPDATE provider_profiles SET api_key_encrypted = ? WHERE id = ?")
      .run("not-valid-ciphertext", alpha.id);

    const sanitized = getSanitizedSettings();

    expect(sanitized.skillsEnabled).toBe(false);
    expect(sanitized.providerProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: alpha.id, hasApiKey: true }),
        expect.objectContaining({ id: beta.id, hasApiKey: false })
      ])
    );
    expect(getProviderProfileWithApiKey(alpha.id)?.apiKey).toBe("");
  });

  it("returns null for missing profiles and exposes defaults", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: true,
      providerProfiles: [alpha]
    });

    expect(getProviderProfile("missing")).toBeNull();
    expect(getProviderProfileWithApiKey("missing")).toBeNull();
    expect(getDefaultProviderProfile()?.id).toBe(alpha.id);
  });

  it("returns default provider settings including vision fields", () => {
    const defaults = getSettingsDefaults();

    expect(defaults.name).toBe("Default profile");
    expect(defaults.visionMode).toBe("native");
    expect(defaults.visionMcpServerId).toBeNull();
  });

  it("stores profiles with reasoning disabled and auto-compaction off", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha",
      reasoningSummaryEnabled: false
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      autoCompaction: false,
      memoriesEnabled: false,
      providerProfiles: [alpha]
    });

    expect(getSettings().skillsEnabled).toBe(false);
    expect(getSettings().autoCompaction).toBe(false);
    expect(getSettings().memoriesEnabled).toBe(false);
    expect(listProviderProfiles()[0].reasoningSummaryEnabled).toBe(false);
  });

  it("stores general settings per user while keeping provider settings global", async () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });
    const beta = buildProfile({
      id: "profile_beta",
      name: "Beta",
      apiKey: "sk-beta"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      providerProfiles: [alpha, beta]
    });

    const userA = await createLocalUser({
      username: "user-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "user-b",
      password: "Password123!",
      role: "user"
    });

    updateGeneralSettingsForUser(userA.id, {
      conversationRetention: "30d",
      autoCompaction: false,
      memoriesEnabled: false,
      memoriesMaxCount: 42,
      mcpTimeout: 45_000
    });
    updateGeneralSettingsForUser(userB.id, {
      conversationRetention: "7d",
      autoCompaction: true,
      memoriesEnabled: true,
      memoriesMaxCount: 7,
      mcpTimeout: 90_000
    });

    expect(getSettingsForUser(userA.id)).toMatchObject({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      conversationRetention: "30d",
      autoCompaction: false,
      memoriesEnabled: false,
      memoriesMaxCount: 42,
      mcpTimeout: 45_000
    });
    expect(getSettingsForUser(userB.id)).toMatchObject({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      conversationRetention: "7d",
      autoCompaction: true,
      memoriesEnabled: true,
      memoriesMaxCount: 7,
      mcpTimeout: 90_000
    });
    expect(getSanitizedSettings(userA.id).providerProfiles.map((profile) => profile.id)).toEqual([
      alpha.id,
      beta.id
    ]);
    expect(getSanitizedSettings(userB.id).providerProfiles.map((profile) => profile.id)).toEqual([
      alpha.id,
      beta.id
    ]);
  });

  it("returns the default MCP timeout from persisted settings", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: true,
      providerProfiles: [alpha]
    });

    expect(getSettings().mcpTimeout).toBe(120_000);
  });

  it("returns a saved non-default MCP timeout", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: true,
      mcpTimeout: 45_000,
      providerProfiles: [alpha]
    });

    expect(getSettings().mcpTimeout).toBe(45_000);
  });

  it("rejects duplicate profile ids and invalid defaults", () => {
    const alpha = buildProfile({
      id: "profile_alpha"
    });

    expect(() =>
      updateSettings({
        defaultProviderProfileId: "missing",
        skillsEnabled: true,
        providerProfiles: [alpha, { ...alpha }]
      })
    ).toThrow();
  });

  it("stores github copilot profiles without requiring an api key", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    };

    updateSettings({
      defaultProviderProfileId: copilot.id,
      skillsEnabled: true,
      providerProfiles: [copilot]
    });

    const stored = getProviderProfile(copilot.id);

    expect(stored?.providerKind).toBe("github_copilot");
    expect(stored?.apiKeyEncrypted).toBe("");
  });

  it("keeps duplicated copilot profiles disconnected", () => {
    const connected = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
      githubAccountLogin: "octocat",
      githubAccountName: "The Octocat"
    };

    const duplicate = {
      ...connected,
      id: "profile_copilot_copy",
      name: "Copilot Copy",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: null,
      githubAccountLogin: null,
      githubAccountName: null
    };

    updateSettings({
      defaultProviderProfileId: connected.id,
      skillsEnabled: true,
      providerProfiles: [connected, duplicate]
    });

    expect(getProviderProfile("profile_copilot_copy")).toMatchObject({
      providerKind: "github_copilot",
      githubUserAccessTokenEncrypted: "",
      githubRefreshTokenEncrypted: "",
      githubAccountLogin: null
    });
  });

  it("does not expose github oauth credentials in sanitized settings", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
      githubAccountLogin: "octocat",
      githubAccountName: "The Octocat"
    };

    updateSettings({
      defaultProviderProfileId: copilot.id,
      skillsEnabled: true,
      providerProfiles: [copilot]
    });

    const settings = getSanitizedSettings();
    const profile = settings.providerProfiles.find((entry) => entry.id === copilot.id);

    expect(profile).toMatchObject({
      id: "profile_copilot",
      providerKind: "github_copilot",
      githubAccountLogin: "octocat",
      githubConnectionStatus: "connected"
    });
    expect("githubUserAccessTokenEncrypted" in (profile ?? {})).toBe(false);
    expect("githubRefreshTokenEncrypted" in (profile ?? {})).toBe(false);
  });

  it("preserves github oauth credentials when saving without sending them back", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot",
        name: "Copilot"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: "2026-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2026-10-08T16:00:00.000Z",
      githubAccountLogin: "octocat",
      githubAccountName: "The Octocat"
    };

    updateSettings({
      defaultProviderProfileId: copilot.id,
      skillsEnabled: true,
      providerProfiles: [copilot]
    });

    updateSettings({
      defaultProviderProfileId: copilot.id,
      skillsEnabled: true,
      providerProfiles: [{
        ...buildProfile({ id: copilot.id, name: "Copilot" }),
        providerKind: "github_copilot" as const,
        apiBaseUrl: "",
        apiKey: "",
        githubUserAccessTokenEncrypted: "",
        githubRefreshTokenEncrypted: "",
        githubTokenExpiresAt: null,
        githubRefreshTokenExpiresAt: null,
        githubAccountLogin: null,
        githubAccountName: null
      }]
    });

    const stored = getProviderProfile(copilot.id);

    expect(stored?.githubUserAccessTokenEncrypted).toBe("ciphertext-access");
    expect(stored?.githubRefreshTokenEncrypted).toBe("ciphertext-refresh");
    expect(stored?.githubTokenExpiresAt).toBe("2026-04-08T16:00:00.000Z");
    expect(stored?.githubRefreshTokenExpiresAt).toBe("2026-10-08T16:00:00.000Z");
    expect(stored?.githubAccountLogin).toBe("octocat");
    expect(stored?.githubAccountName).toBe("The Octocat");
  });
});
