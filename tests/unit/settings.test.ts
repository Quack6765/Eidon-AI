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

const requireUserMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

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
  beforeEach(() => {
    requireUserMock.mockReset();
  });

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

  it("returns the default compaction threshold as eighty percent", () => {
    const defaults = getSettingsDefaults();

    expect(defaults.compactionThreshold).toBe(0.8);
  });

  it("normalizes legacy default compaction thresholds without changing custom values", () => {
    const legacy = buildProfile({
      id: "profile_legacy",
      name: "Legacy",
      compactionThreshold: 0.78
    });
    const custom = buildProfile({
      id: "profile_custom",
      name: "Custom",
      compactionThreshold: 0.5
    });

    updateSettings({
      defaultProviderProfileId: legacy.id,
      skillsEnabled: true,
      providerProfiles: [legacy, custom]
    });

    const providerProfiles = listProviderProfiles();

    expect(providerProfiles.find((profile) => profile.id === legacy.id)?.compactionThreshold).toBe(0.8);
    expect(providerProfiles.find((profile) => profile.id === custom.id)?.compactionThreshold).toBe(0.5);
    expect(getDefaultProviderProfile()?.compactionThreshold).toBe(0.8);
  });

  it("stores profiles with reasoning disabled and memories off", () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha",
      reasoningSummaryEnabled: false
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      memoriesEnabled: false,
      providerProfiles: [alpha]
    });

    expect(getSettings().skillsEnabled).toBe(false);
    expect(getSettings().memoriesEnabled).toBe(false);
    expect(listProviderProfiles()[0].reasoningSummaryEnabled).toBe(false);
  });

  it("does not expose auto-compaction in sanitized settings", () => {
    const sanitized = getSanitizedSettings();

    expect("autoCompaction" in sanitized).toBe(false);
  });

  it("leaves the auto_compaction column unchanged when saving settings", () => {
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

    const initialAutoCompaction = getDb()
      .prepare("SELECT auto_compaction FROM app_settings WHERE id = ?")
      .get(1) as { auto_compaction: number };

    getDb()
      .prepare("UPDATE app_settings SET auto_compaction = ? WHERE id = ?")
      .run(0, 1);

    const beforeUpdate = getDb()
      .prepare("SELECT auto_compaction FROM app_settings WHERE id = ?")
      .get(1) as { auto_compaction: number };

    expect(beforeUpdate.auto_compaction).toBe(0);

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      memoriesEnabled: false,
      mcpTimeout: 45_000,
      providerProfiles: [alpha]
    });

    const afterUpdate = getDb()
      .prepare("SELECT auto_compaction FROM app_settings WHERE id = ?")
      .get(1) as { auto_compaction: number };

    expect(afterUpdate.auto_compaction).toBe(beforeUpdate.auto_compaction);
    expect(afterUpdate.auto_compaction).toBe(0);
    expect(initialAutoCompaction.auto_compaction).toBeGreaterThanOrEqual(0);
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
      memoriesEnabled: false,
      memoriesMaxCount: 42,
      mcpTimeout: 45_000
    });
    updateGeneralSettingsForUser(userB.id, {
      conversationRetention: "7d",
      memoriesEnabled: true,
      memoriesMaxCount: 7,
      mcpTimeout: 90_000
    });

    expect(getSettingsForUser(userA.id)).toMatchObject({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      conversationRetention: "30d",
      memoriesEnabled: false,
      memoriesMaxCount: 42,
      mcpTimeout: 45_000
    });
    expect(getSettingsForUser(userB.id)).toMatchObject({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      conversationRetention: "7d",
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

  it("stores speech-to-text preferences per user", async () => {
    const alpha = buildProfile({
      id: "profile_alpha",
      name: "Alpha",
      apiKey: "sk-alpha"
    });

    updateSettings({
      defaultProviderProfileId: alpha.id,
      skillsEnabled: false,
      providerProfiles: [alpha]
    });

    const userA = await createLocalUser({
      username: "voice-a",
      password: "changeme123",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "voice-b",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(userA.id, {
      sttEngine: "embedded",
      sttLanguage: "fr"
    });
    updateGeneralSettingsForUser(userB.id, {
      sttEngine: "browser",
      sttLanguage: "auto"
    });

    expect(getSettingsForUser(userA.id)).toMatchObject({
      sttEngine: "embedded",
      sttLanguage: "fr"
    });
    expect(getSettingsForUser(userB.id)).toMatchObject({
      sttEngine: "browser",
      sttLanguage: "auto"
    });
  });

  it("defaults fresh user settings to Exa without any API keys", async () => {
    const user = await createLocalUser({
      username: "search-defaults",
      password: "changeme123",
      role: "user"
    });

    expect(getSettingsForUser(user.id)).toMatchObject({
      webSearchEngine: "exa",
      exaApiKey: "",
      tavilyApiKey: "",
      searxngBaseUrl: "",
      sttEngine: "browser",
      sttLanguage: "auto"
    });

    const stored = getDb()
      .prepare("SELECT stt_engine, stt_language FROM user_settings WHERE user_id = ?")
      .get(user.id) as { stt_engine: string; stt_language: string };

    expect(stored).toMatchObject({
      stt_engine: "browser",
      stt_language: "auto"
    });
  });

  it("stores web search settings per user", async () => {
    const userA = await createLocalUser({
      username: "search-a",
      password: "changeme123",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "search-b",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(userA.id, {
      webSearchEngine: "tavily",
      tavilyApiKey: "tvly-user-a"
    });
    updateGeneralSettingsForUser(userB.id, {
      webSearchEngine: "searxng",
      searxngBaseUrl: "https://search.example.com/"
    });

    expect(getSettingsForUser(userA.id)).toMatchObject({
      webSearchEngine: "tavily",
      tavilyApiKey: "tvly-user-a"
    });
    expect(getSettingsForUser(userB.id)).toMatchObject({
      webSearchEngine: "searxng",
      searxngBaseUrl: "https://search.example.com"
    });
  });

  it("does not expose search secrets through sanitized user settings", async () => {
    const user = await createLocalUser({
      username: "search-sanitized",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "searxng",
      exaApiKey: "exa-secret",
      tavilyApiKey: "tvly-secret",
      searxngBaseUrl: "https://search.example.com/"
    });

    const sanitized = getSanitizedSettings(user.id);

    expect(sanitized).toMatchObject({
      webSearchEngine: "searxng",
      exaApiKey: "",
      tavilyApiKey: "",
      searxngBaseUrl: "https://search.example.com"
    });
  });

  it("allows selecting Tavily when the user already has a saved Tavily API key", async () => {
    vi.resetModules();
    const { createLocalUser } = await import("@/lib/users");
    const { updateGeneralSettingsForUser } = await import("@/lib/settings");
    const { PUT } = await import("@/app/api/settings/general/route");

    const user = await createLocalUser({
      username: "search-route-tavily",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "disabled",
      tavilyApiKey: "tvly-existing"
    });

    requireUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          webSearchEngine: "tavily"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          webSearchEngine: "tavily",
          tavilyApiKey: "",
          hasTavilyApiKey: true
        })
      })
    );
  });

  it("allows selecting SearXNG when the user already has a saved SearXNG URL", async () => {
    vi.resetModules();
    const { createLocalUser } = await import("@/lib/users");
    const { updateGeneralSettingsForUser } = await import("@/lib/settings");
    const { PUT } = await import("@/app/api/settings/general/route");

    const user = await createLocalUser({
      username: "search-route-searxng",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "disabled",
      searxngBaseUrl: "https://search.example.com/"
    });

    requireUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          webSearchEngine: "searxng"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          webSearchEngine: "searxng",
          searxngBaseUrl: "https://search.example.com"
        })
      })
    );
  });

  it("falls back to empty search keys when stored ciphertext is unreadable", async () => {
    const user = await createLocalUser({
      username: "search-corrupt-ciphertext",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "exa",
      exaApiKey: "exa-secret",
      tavilyApiKey: "tvly-secret"
    });

    getDb()
      .prepare(
        "UPDATE user_settings SET exa_api_key_encrypted = ?, tavily_api_key_encrypted = ? WHERE user_id = ?"
      )
      .run("broken-exa", "broken-tavily", user.id);

    expect(getSettingsForUser(user.id)).toMatchObject({
      exaApiKey: "",
      tavilyApiKey: ""
    });
    const sanitized = getSanitizedSettings(user.id);

    expect(sanitized).toMatchObject({
      webSearchEngine: "exa",
      exaApiKey: "",
      tavilyApiKey: "",
      searxngBaseUrl: ""
    });
  });

  it("preserves unreadable encrypted search keys on unrelated general settings updates", async () => {
    const user = await createLocalUser({
      username: "search-preserve-corrupt-ciphertext",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "exa",
      exaApiKey: "exa-secret",
      tavilyApiKey: "tvly-secret"
    });

    getDb()
      .prepare(
        "UPDATE user_settings SET exa_api_key_encrypted = ?, tavily_api_key_encrypted = ? WHERE user_id = ?"
      )
      .run("broken-exa", "broken-tavily", user.id);

    updateGeneralSettingsForUser(user.id, {
      mcpTimeout: 45_000
    });

    const stored = getDb()
      .prepare(
        "SELECT exa_api_key_encrypted, tavily_api_key_encrypted, mcp_timeout FROM user_settings WHERE user_id = ?"
      )
      .get(user.id) as {
      exa_api_key_encrypted: string;
      tavily_api_key_encrypted: string;
      mcp_timeout: number;
    };

    expect(stored).toMatchObject({
      exa_api_key_encrypted: "broken-exa",
      tavily_api_key_encrypted: "broken-tavily",
      mcp_timeout: 45_000
    });
  });

  it("preserves saved search secrets when sanitized settings round-trip with blank secret fields", async () => {
    const user = await createLocalUser({
      username: "search-sanitized-roundtrip",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "tavily",
      exaApiKey: "exa-secret",
      tavilyApiKey: "tvly-secret"
    });

    const sanitized = getSanitizedSettings(user.id);

    expect(sanitized).toMatchObject({
      webSearchEngine: "tavily",
      exaApiKey: "",
      tavilyApiKey: ""
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: sanitized.webSearchEngine,
      exaApiKey: sanitized.exaApiKey,
      tavilyApiKey: sanitized.tavilyApiKey,
      searxngBaseUrl: sanitized.searxngBaseUrl,
      mcpTimeout: 45_000
    });

    expect(getSettingsForUser(user.id)).toMatchObject({
      webSearchEngine: "tavily",
      exaApiKey: "exa-secret",
      tavilyApiKey: "tvly-secret",
      mcpTimeout: 45_000
    });
  });

  it("clears saved search secrets explicitly through the general settings route", async () => {
    vi.resetModules();
    const { createLocalUser } = await import("@/lib/users");
    const { updateGeneralSettingsForUser, getSettingsForUser } = await import("@/lib/settings");
    const { PUT } = await import("@/app/api/settings/general/route");

    const user = await createLocalUser({
      username: "search-route-clear",
      password: "changeme123",
      role: "user"
    });

    updateGeneralSettingsForUser(user.id, {
      webSearchEngine: "disabled",
      exaApiKey: "exa-secret",
      tavilyApiKey: "tvly-secret"
    });

    requireUserMock.mockResolvedValue(user);

    const response = await PUT(
      new Request("http://localhost/api/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exaApiKey: "",
          tavilyApiKey: "",
          clearExaApiKey: true,
          clearTavilyApiKey: true,
          mcpTimeout: 45_000
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({
          exaApiKey: "",
          tavilyApiKey: "",
          hasExaApiKey: false,
          hasTavilyApiKey: false,
          mcpTimeout: 45_000
        })
      })
    );
    expect(getSettingsForUser(user.id)).toMatchObject({
      exaApiKey: "",
      tavilyApiKey: "",
      mcpTimeout: 45_000
    });
  });

  it("rejects invalid merged Tavily settings when updated directly", async () => {
    const user = await createLocalUser({
      username: "search-direct-invalid-tavily",
      password: "changeme123",
      role: "user"
    });

    expect(() =>
      updateGeneralSettingsForUser(user.id, {
        webSearchEngine: "tavily"
      })
    ).toThrow("Tavily API key is required");

    expect(getSettingsForUser(user.id)).toMatchObject({
      webSearchEngine: "exa",
      tavilyApiKey: ""
    });
  });

  it("rejects invalid merged SearXNG settings when updated directly", async () => {
    const user = await createLocalUser({
      username: "search-direct-invalid-searxng",
      password: "changeme123",
      role: "user"
    });

    expect(() =>
      updateGeneralSettingsForUser(user.id, {
        webSearchEngine: "searxng"
      })
    ).toThrow("SearXNG URL is required");

    expect(getSettingsForUser(user.id)).toMatchObject({
      webSearchEngine: "exa",
      searxngBaseUrl: ""
    });
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
      githubTokenExpiresAt: "2027-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2027-10-08T16:00:00.000Z",
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
      githubTokenExpiresAt: "2027-04-08T16:00:00.000Z",
      githubRefreshTokenExpiresAt: "2027-10-08T16:00:00.000Z",
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

  it("marks expired github copilot connections as expired in sanitized settings", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot_expired",
        name: "Copilot Expired"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: "2020-01-01T00:00:00.000Z",
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
      id: "profile_copilot_expired",
      providerKind: "github_copilot",
      githubConnectionStatus: "expired"
    });
  });

  it("treats github copilot profiles without an access-token expiry as disconnected in sanitized settings", () => {
    const copilot = {
      ...buildProfile({
        id: "profile_copilot_missing_expiry",
        name: "Copilot Missing Expiry"
      }),
      providerKind: "github_copilot" as const,
      apiKey: "",
      apiBaseUrl: "",
      githubUserAccessTokenEncrypted: "ciphertext-access",
      githubRefreshTokenEncrypted: "ciphertext-refresh",
      githubTokenExpiresAt: null,
      githubRefreshTokenExpiresAt: "2027-10-08T16:00:00.000Z",
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
      id: "profile_copilot_missing_expiry",
      providerKind: "github_copilot",
      githubConnectionStatus: "disconnected"
    });
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
