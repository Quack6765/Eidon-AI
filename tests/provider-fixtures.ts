import { createProviderProfileDraft } from "@/lib/provider-catalog";
import type {
  ProviderConnectionMetadata,
  ProviderCredentials,
  RuntimeProviderProfile
} from "@/lib/provider-profile";
import type { ProviderProfileInput, SecretAction } from "@/lib/provider-profiles";
import type { RuntimeAppSettings } from "@/lib/types";

export type RuntimeProviderOverrides = Partial<Omit<RuntimeProviderProfile, "providerKind" | "providerConfig">> & {
  providerKind?: RuntimeProviderProfile["providerKind"];
  providerConfig?: Record<string, unknown>;
  credentials?: ProviderCredentials;
  connectionMetadata?: ProviderConnectionMetadata;
};

type ProviderProfileInputOverrides = RuntimeProviderOverrides & {
  credential?: string;
  credentialAction?: SecretAction;
};

export function createRuntimeProviderProfile(
  overrides: RuntimeProviderOverrides = {}
): RuntimeProviderProfile {
  const providerKind = overrides.providerKind ?? "openai_compatible";
  const draft = createProviderProfileDraft({ providerKind });
  const providerConfig = providerKind === "github_copilot"
    ? {}
    : providerKind === "anthropic"
      ? {
          apiBaseUrl: String(overrides.providerConfig?.apiBaseUrl ?? "https://api.anthropic.com")
        }
      : {
          apiBaseUrl: String(overrides.providerConfig?.apiBaseUrl ?? "https://api.example.com/v1"),
          apiMode: overrides.providerConfig?.apiMode === "chat_completions"
            ? "chat_completions" as const
            : "responses" as const,
          processingMode: overrides.providerConfig?.processingMode === "fast"
            ? "fast" as const
            : "standard" as const,
          reasoningParameterMode: overrides.providerConfig?.reasoningParameterMode === "mirrored"
            ? "mirrored" as const
            : "standard" as const
        };
  return {
    ...draft,
    ...overrides,
    providerKind,
    providerConfig,
    credentials: overrides.credentials ?? (
      providerKind === "github_copilot"
        ? { accessToken: "github-test-token", refreshToken: "github-test-refresh" }
        : { apiKey: "sk-test" }
    ),
    connectionMetadata: overrides.connectionMetadata ?? {},
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z"
  } as RuntimeProviderProfile;
}

export function createProviderProfileInput(
  overrides: ProviderProfileInputOverrides = {}
): ProviderProfileInput {
  const { credential, credentialAction, ...runtimeOverrides } = overrides;
  const profile = createRuntimeProviderProfile(runtimeOverrides);
  const { credentials, connectionMetadata: _metadata, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = profile;
  return {
    ...input,
    credential: credential ?? credentials.apiKey,
    credentialAction: credentialAction ?? (credentials.apiKey ? "replace" : "preserve")
  } as ProviderProfileInput;
}

export function createProviderCatalogInput(
  profiles: ProviderProfileInput[] = [createProviderProfileInput()],
  overrides: Partial<{
    defaultProviderProfileId: string;
    skillsEnabled: boolean;
    conversationRetention: "forever" | "90d" | "30d" | "7d";
    memoriesEnabled: boolean;
    memoriesMaxCount: number;
    mcpTimeout: number;
  }> = {}
) {
  return {
    defaultProviderProfileId: overrides.defaultProviderProfileId ?? profiles[0].id,
    skillsEnabled: overrides.skillsEnabled ?? true,
    conversationRetention: overrides.conversationRetention ?? "forever",
    memoriesEnabled: overrides.memoriesEnabled ?? true,
    memoriesMaxCount: overrides.memoriesMaxCount ?? 100,
    mcpTimeout: overrides.mcpTimeout ?? 120000,
    providerProfiles: profiles
  };
}

type RuntimeIntegrationOverride<Key extends "webSearch" | "imageGeneration" | "speechTranscription"> =
  Partial<RuntimeAppSettings[Key]> & {
    configuration?: Partial<RuntimeAppSettings[Key]["configuration"]>;
    credentials?: Partial<RuntimeAppSettings[Key]["credentials"]>;
  };

export type RuntimeAppSettingsOverrides = Partial<
  Omit<RuntimeAppSettings, "webSearch" | "imageGeneration" | "speechTranscription">
> & {
  webSearch?: RuntimeIntegrationOverride<"webSearch">;
  imageGeneration?: RuntimeIntegrationOverride<"imageGeneration">;
  speechTranscription?: RuntimeIntegrationOverride<"speechTranscription">;
};

export function createRuntimeAppSettings(
  overrides: RuntimeAppSettingsOverrides = {}
): RuntimeAppSettings {
  const defaults: RuntimeAppSettings = {
    defaultProviderProfileId: "profile_test",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 100,
    memoriesRigor: "balanced",
    mcpTimeout: 120000,
    maxAssistantToolSteps: 25,
    confirmExternalLinks: true,
    titleGenerationMode: "same",
    titleGenerationProfileId: null,
    webSearch: {
      providerId: "disabled",
      configuration: {},
      configured: true,
      credentialStored: false,
      scope: "global",
      credentials: {}
    },
    imageGeneration: {
      providerId: "disabled",
      configuration: {},
      configured: true,
      credentialStored: false,
      scope: "global",
      credentials: {}
    },
    speechTranscription: {
      providerId: "browser",
      configuration: { language: "auto" },
      configured: true,
      credentialStored: false,
      scope: "global",
      credentials: {}
    },
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
  return {
    ...defaults,
    ...overrides,
    webSearch: {
      ...defaults.webSearch,
      ...overrides.webSearch,
      configuration: {
        ...defaults.webSearch.configuration,
        ...overrides.webSearch?.configuration
      },
      credentials: {
        ...defaults.webSearch.credentials,
        ...overrides.webSearch?.credentials
      }
    },
    imageGeneration: {
      ...defaults.imageGeneration,
      ...overrides.imageGeneration,
      configuration: {
        ...defaults.imageGeneration.configuration,
        ...overrides.imageGeneration?.configuration
      },
      credentials: {
        ...defaults.imageGeneration.credentials,
        ...overrides.imageGeneration?.credentials
      }
    },
    speechTranscription: {
      ...defaults.speechTranscription,
      ...overrides.speechTranscription,
      configuration: {
        ...defaults.speechTranscription.configuration,
        ...overrides.speechTranscription?.configuration
      },
      credentials: {
        ...defaults.speechTranscription.credentials,
        ...overrides.speechTranscription?.credentials
      }
    }
  };
}
