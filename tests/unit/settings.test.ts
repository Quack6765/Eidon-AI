import { decryptValue } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { createConversation, getConversation, updateConversationProviderProfile } from "@/lib/conversations";
import {
  clearProviderConnection,
  updateProviderConnection
} from "@/lib/provider-profiles";
import {
  duplicateProviderProfile,
  getDefaultRuntimeProviderProfile,
  getRuntimeProviderProfile,
  getSanitizedSettings,
  getSettings,
  getSettingsForUser,
  listProviderProfiles,
  updateGeneralSettingsBundleForUser,
  updateProviderCatalog
} from "@/lib/settings";
import { createLocalUser } from "@/lib/users";
import {
  createProviderCatalogInput,
  createProviderProfileInput
} from "@/tests/provider-fixtures";

function apiKeyProfile(
  overrides: Parameters<typeof createProviderProfileInput>[0] = {}
) {
  return createProviderProfileInput({
    id: "profile_primary",
    name: "Primary",
    model: "gpt-test",
    credentials: { apiKey: "sk-primary" },
    ...overrides
  });
}

function saveProfiles(
  profiles = [apiKeyProfile()],
  overrides: Parameters<typeof createProviderCatalogInput>[1] = {}
) {
  return updateProviderCatalog(createProviderCatalogInput(profiles, overrides));
}

describe("settings domains", () => {
  it("stores provider profiles and credentials in their normalized tables", () => {
    const primary = apiKeyProfile();
    const secondary = apiKeyProfile({
      id: "profile_secondary",
      name: "Secondary",
      credentials: { apiKey: "sk-secondary" },
      providerConfig: {
        apiBaseUrl: "https://secondary.example.com/v1",
        apiMode: "chat_completions"
      }
    });

    saveProfiles([primary, secondary]);

    const profileColumns = getDb()
      .prepare("PRAGMA table_info(provider_profiles)")
      .all() as Array<{ name: string }>;
    const connection = getDb()
      .prepare("SELECT credentials_encrypted FROM provider_profile_connections WHERE profile_id = ?")
      .get(secondary.id) as { credentials_encrypted: string };

    expect(profileColumns.map((column) => column.name)).not.toContain("api_key_encrypted");
    expect(profileColumns.map((column) => column.name)).not.toContain("github_access_token_encrypted");
    expect(JSON.parse(decryptValue(connection.credentials_encrypted))).toEqual({
      apiKey: "sk-secondary"
    });
    expect(listProviderProfiles()).toHaveLength(2);
    expect(getDefaultRuntimeProviderProfile()?.credentials.apiKey).toBe("sk-primary");
  });

  it("preserves, replaces, and clears API-key credentials explicitly", () => {
    const profile = apiKeyProfile();
    saveProfiles([profile]);

    saveProfiles([{ ...profile, credential: "", credentialAction: "preserve" }]);
    expect(getRuntimeProviderProfile(profile.id)?.credentials.apiKey).toBe("sk-primary");

    saveProfiles([{ ...profile, credential: "sk-replaced", credentialAction: "replace" }]);
    expect(getRuntimeProviderProfile(profile.id)?.credentials.apiKey).toBe("sk-replaced");

    saveProfiles([{ ...profile, credential: "", credentialAction: "clear" }]);
    expect(getRuntimeProviderProfile(profile.id)?.credentials).toEqual({});
  });

  it("requires an explicit credential action when the connection identity changes", () => {
    const profile = apiKeyProfile();
    saveProfiles([profile]);

    expect(() => saveProfiles([apiKeyProfile({
      providerConfig: {
        apiBaseUrl: "https://changed.example.com/v1",
        apiMode: "responses"
      },
      credential: "",
      credentialAction: "preserve"
    })])).toThrow("changed connection identity");
  });

  it("exposes a generic connection summary without credentials", () => {
    const oauthProfile = apiKeyProfile({
      id: "profile_oauth",
      name: "Connected account",
      providerKind: "github_copilot",
      providerConfig: {},
      model: "gpt-4.1",
      credentials: {},
      credentialAction: "preserve"
    });
    saveProfiles([oauthProfile]);
    updateProviderConnection(oauthProfile.id, {
      credentials: { accessToken: "secret-access", refreshToken: "secret-refresh" },
      metadata: {
        accountLabel: "octocat",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    });

    const publicSettings = getSanitizedSettings();
    const summary = publicSettings.providerProfiles.find((profile) => profile.id === oauthProfile.id);
    const serialized = JSON.stringify(publicSettings);

    expect(summary?.connection).toEqual({
      mode: "oauth",
      status: "connected",
      accountLabel: "octocat",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    expect(serialized).not.toContain("secret-access");
    expect(serialized).not.toContain("secret-refresh");
    expect(serialized).not.toContain("githubAccessToken");
  });

  it("reports expired and disconnected connection states", () => {
    const profile = apiKeyProfile({
      id: "profile_oauth",
      providerKind: "github_copilot",
      providerConfig: {},
      credentials: {},
      credentialAction: "preserve"
    });
    saveProfiles([profile]);
    updateProviderConnection(profile.id, {
      credentials: { accessToken: "expired-token" },
      metadata: { expiresAt: "2000-01-01T00:00:00.000Z" }
    });
    expect(getSanitizedSettings().providerProfiles[0].connection.status).toBe("expired");

    clearProviderConnection(profile.id);
    expect(getSanitizedSettings().providerProfiles[0].connection.status).toBe("disconnected");
  });

  it("duplicates API-key profiles without copying OAuth connections", () => {
    const apiProfile = apiKeyProfile();
    saveProfiles([apiProfile]);
    duplicateProviderProfile(apiProfile.id);
    const apiCopy = getSanitizedSettings().providerProfiles.find((profile) => profile.id !== apiProfile.id)!;
    expect(getRuntimeProviderProfile(apiCopy.id)?.credentials.apiKey).toBe("sk-primary");

    const oauthProfile = apiKeyProfile({
      id: "profile_oauth",
      name: "OAuth",
      providerKind: "github_copilot",
      providerConfig: {},
      credentials: {},
      credentialAction: "preserve"
    });
    saveProfiles([oauthProfile]);
    updateProviderConnection(oauthProfile.id, {
      credentials: { accessToken: "access", refreshToken: "refresh" }
    });
    duplicateProviderProfile(oauthProfile.id);
    const oauthCopy = getSanitizedSettings().providerProfiles.find(
      (profile) => profile.id !== oauthProfile.id
    )!;
    expect(getRuntimeProviderProfile(oauthCopy.id)?.credentials).toEqual({});
  });

  it("reassigns dependent conversations before deleting a profile", () => {
    const primary = apiKeyProfile();
    const secondary = apiKeyProfile({ id: "profile_secondary", name: "Secondary" });
    saveProfiles([primary, secondary]);
    const conversation = createConversation();
    updateConversationProviderProfile(conversation.id, secondary.id);

    saveProfiles([primary]);

    expect(getConversation(conversation.id)?.providerProfileId).toBe(primary.id);
    expect(listProviderProfiles().map((profile) => profile.id)).toEqual([primary.id]);
  });

  it("rejects invalid catalogs and impossible context budgets", () => {
    const primary = apiKeyProfile();
    expect(() => saveProfiles([primary, { ...primary }])).toThrow("Provider profile ids must be unique");
    expect(() => saveProfiles([{ ...primary, maxOutputTokens: 8000, safetyMarginTokens: 400, modelContextLimit: 8192 }]))
      .toThrow("Output tokens plus the safety margin must be below the context limit");
  });

  it("keeps user preferences scoped while provider settings remain global", async () => {
    const profile = apiKeyProfile();
    saveProfiles([profile], { conversationRetention: "forever" });
    const first = await createLocalUser({ username: "first-user", password: "password-123", role: "user" });
    const second = await createLocalUser({ username: "second-user", password: "password-123", role: "user" });

    updateGeneralSettingsBundleForUser(first.id, {
      preferences: {
        conversationRetention: "7d",
        mcpTimeout: 45000,
        maxAssistantToolSteps: 12
      },
      webSearch: {
        providerId: "disabled",
        configuration: {},
        credentialAction: "clear"
      },
      speechTranscription: {
        providerId: "browser",
        configuration: { language: "en" },
        credentialAction: "clear"
      }
    }, false);

    expect(getSettingsForUser(first.id)).toMatchObject({
      conversationRetention: "7d",
      mcpTimeout: 45000,
      maxAssistantToolSteps: 12
    });
    expect(getSettingsForUser(second.id).conversationRetention).toBe("forever");
    expect(getSettings().defaultProviderProfileId).toBe(profile.id);
  });

  it("stores capability settings with user fallback and no public credentials", async () => {
    saveProfiles();
    const user = await createLocalUser({ username: "integration-user", password: "password-123", role: "user" });

    updateGeneralSettingsBundleForUser(user.id, {
      preferences: {
        conversationRetention: "30d",
        mcpTimeout: 60000,
        maxAssistantToolSteps: 20
      },
      webSearch: {
        providerId: "tavily",
        configuration: {},
        credential: "tvly-secret",
        credentialAction: "replace"
      },
      speechTranscription: {
        providerId: "elevenlabs",
        configuration: { language: "eng" },
        credential: "eleven-secret",
        credentialAction: "replace"
      }
    }, false);

    const publicSettings = getSanitizedSettings(user.id);
    const runtime = getSettingsForUser(user.id);
    const rows = getDb().prepare(`
      SELECT capability, credentials_encrypted
      FROM integration_settings WHERE user_id = ? ORDER BY capability
    `).all(user.id) as Array<{ capability: string; credentials_encrypted: string }>;

    expect(publicSettings.webSearch).toMatchObject({
      providerId: "tavily",
      configured: true,
      credentialStored: true,
      scope: "user"
    });
    expect(publicSettings.speechTranscription).toMatchObject({
      providerId: "elevenlabs",
      configured: true,
      credentialStored: true,
      scope: "user"
    });
    expect(JSON.stringify(publicSettings)).not.toContain("tvly-secret");
    expect(JSON.stringify(publicSettings)).not.toContain("eleven-secret");
    expect(runtime.webSearch.credentials.apiKey).toBe("tvly-secret");
    expect(runtime.speechTranscription.credentials.apiKey).toBe("eleven-secret");
    expect(rows.every((row) => !row.credentials_encrypted.includes("secret"))).toBe(true);
  });

  it("clears integration credentials when the selected provider changes", async () => {
    saveProfiles();
    const user = await createLocalUser({ username: "credential-user", password: "password-123", role: "user" });
    const preferences = {
      conversationRetention: "forever" as const,
      mcpTimeout: 120000,
      maxAssistantToolSteps: 25
    };

    updateGeneralSettingsBundleForUser(user.id, {
      preferences,
      webSearch: {
        providerId: "tavily",
        configuration: {},
        credential: "tvly-secret",
        credentialAction: "replace"
      },
      speechTranscription: {
        providerId: "browser",
        configuration: { language: "auto" },
        credentialAction: "clear"
      }
    }, false);
    updateGeneralSettingsBundleForUser(user.id, {
      preferences,
      webSearch: {
        providerId: "searxng",
        configuration: { baseUrl: "https://search.example.com" },
        credentialAction: "preserve"
      },
      speechTranscription: {
        providerId: "browser",
        configuration: { language: "auto" },
        credentialAction: "preserve"
      }
    }, false);

    expect(getSettingsForUser(user.id)).toMatchObject({
      webSearch: {
        providerId: "searxng",
        configuration: { baseUrl: "https://search.example.com" },
        credentials: {}
      }
    });
  });

  it("normalizes AssemblyAI configuration and isolates credentials when providers change", async () => {
    saveProfiles();
    const user = await createLocalUser({
      username: "assembly-credential-user",
      password: "password-123",
      role: "user"
    });
    const preferences = {
      conversationRetention: "forever" as const,
      mcpTimeout: 120000,
      maxAssistantToolSteps: 25
    };

    updateGeneralSettingsBundleForUser(user.id, {
      preferences,
      webSearch: {
        providerId: "disabled",
        configuration: {},
        credentialAction: "clear"
      },
      speechTranscription: {
        providerId: "assemblyai",
        configuration: { model: "universal-3-5-pro", language: "auto" },
        credential: "assembly-secret",
        credentialAction: "replace"
      }
    }, false);
    expect(getSettingsForUser(user.id).speechTranscription).toMatchObject({
      providerId: "assemblyai",
      configuration: { model: "universal-3-5-pro", language: "auto" },
      credentials: { apiKey: "assembly-secret" }
    });

    getDb().prepare(`
      UPDATE integration_settings SET configuration_json = ?
      WHERE capability = 'speech_transcription' AND user_id = ?
    `).run(JSON.stringify({ model: "unsupported", language: "sw" }), user.id);
    expect(getSettingsForUser(user.id).speechTranscription).toMatchObject({
      providerId: "assemblyai",
      configuration: { model: "universal-3-5-pro", language: "auto" },
      credentials: { apiKey: "assembly-secret" }
    });

    updateGeneralSettingsBundleForUser(user.id, {
      preferences,
      webSearch: {
        providerId: "disabled",
        configuration: {},
        credentialAction: "preserve"
      },
      speechTranscription: {
        providerId: "elevenlabs",
        configuration: { language: "eng" },
        credentialAction: "preserve"
      }
    }, false);
    expect(getSettingsForUser(user.id).speechTranscription).toMatchObject({
      providerId: "elevenlabs",
      credentials: {}
    });
  });

  it("protects global integrations and updates them atomically for admins", async () => {
    saveProfiles();
    const user = await createLocalUser({ username: "admin-user", password: "password-123", role: "admin" });
    const input = {
      preferences: {
        conversationRetention: "90d" as const,
        mcpTimeout: 90000,
        maxAssistantToolSteps: 30
      },
      webSearch: {
        providerId: "exa" as const,
        configuration: {},
        credentialAction: "clear" as const
      },
      speechTranscription: {
        providerId: "canary" as const,
        configuration: { language: "en" },
        credentialAction: "clear" as const
      },
      imageGeneration: {
        providerId: "google_nano_banana" as const,
        configuration: { model: "gemini-3.1-flash-image-preview" },
        credential: "google-secret",
        credentialAction: "replace" as const
      },
      titleGeneration: {
        titleGenerationMode: "same" as const,
        titleGenerationProfileId: null
      }
    };

    expect(() => updateGeneralSettingsBundleForUser(user.id, input, false))
      .toThrow("Only admins can update global settings");

    const updated = updateGeneralSettingsBundleForUser(user.id, input, true);
    expect(updated.imageGeneration).toMatchObject({
      providerId: "google_nano_banana",
      configured: true,
      credentialStored: true,
      scope: "global"
    });
    expect(JSON.stringify(updated)).not.toContain("google-secret");
    expect(getSettingsForUser(user.id).imageGeneration.credentials.apiKey).toBe("google-secret");
  });
});
