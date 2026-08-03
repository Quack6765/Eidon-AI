import { createProviderProfileDraft } from "@/lib/provider-catalog";
import { getDb } from "@/lib/db";
import { getGlobalPreferences, updateGlobalPreferences } from "@/lib/global-preferences";
import {
  getIntegrationSetting,
  getRuntimeIntegrationSetting,
  updateIntegrationSetting,
  type CredentialAction
} from "@/lib/integration-settings";
import {
  duplicateProviderProfileRecord,
  getDefaultProviderProfile as getStoredDefaultProviderProfile,
  getDefaultRuntimeProviderProfile,
  getProviderProfile as getStoredProviderProfile,
  getRuntimeProviderProfile,
  listProviderProfiles as listStoredProviderProfiles,
  listProviderProfileSummaries,
  listRuntimeProviderProfiles,
  saveProviderCatalog
} from "@/lib/provider-profiles";
import { getUserPreferences, updateUserPreferences, type UserPreferences } from "@/lib/user-preferences";
import type {
  AppSettings as PublicAppSettings,
  RuntimeAppSettings,
  ProviderProfileSummary,
  TitleGenerationMode,
  WebSearchProviderId,
  ImageGenerationProviderId,
  TranscriptionProviderId
} from "@/lib/types";

type IntegrationUpdate<ProviderId extends string> = {
  providerId: ProviderId;
  configuration: Record<string, unknown>;
  credential?: string;
  credentialAction: CredentialAction;
};

export type GeneralSettingsBundle = {
  preferences: Pick<
    UserPreferences,
    "conversationRetention" | "mcpTimeout" | "maxAssistantToolSteps"
  >;
  webSearch: IntegrationUpdate<WebSearchProviderId>;
  speechTranscription: IntegrationUpdate<TranscriptionProviderId>;
  imageGeneration?: IntegrationUpdate<ImageGenerationProviderId>;
  titleGeneration?: {
    titleGenerationMode: TitleGenerationMode;
    titleGenerationProfileId: string | null;
  };
};

function runtimeSettings(userId?: string): RuntimeAppSettings {
  const global = getGlobalPreferences();
  const user = userId ? getUserPreferences(userId, global) : global;
  const webSearch = getRuntimeIntegrationSetting("web_search", userId);
  const imageGeneration = getRuntimeIntegrationSetting("image_generation");
  const speechTranscription = getRuntimeIntegrationSetting("speech_transcription", userId);

  return {
    defaultProviderProfileId: global.defaultProviderProfileId,
    skillsEnabled: global.skillsEnabled,
    conversationRetention: user.conversationRetention,
    memoriesEnabled: user.memoriesEnabled,
    memoriesMaxCount: user.memoriesMaxCount,
    mcpTimeout: user.mcpTimeout,
    maxAssistantToolSteps: user.maxAssistantToolSteps,
    titleGenerationMode: global.titleGenerationMode,
    titleGenerationProfileId: global.titleGenerationProfileId,
    webSearch: webSearch
      ? {
          ...webSearch,
          providerId: webSearch.providerId as WebSearchProviderId,
          configuration: webSearch.configuration
        }
      : {
          providerId: "disabled",
          configuration: {},
          configured: true,
          scope: "global",
          credentials: {}
        },
    imageGeneration: imageGeneration
      ? {
          ...imageGeneration,
          providerId: imageGeneration.providerId as ImageGenerationProviderId,
          configuration: imageGeneration.configuration
        }
      : {
          providerId: "disabled",
          configuration: {},
          configured: true,
          scope: "global",
          credentials: {}
        },
    speechTranscription: speechTranscription
      ? {
          ...speechTranscription,
          providerId: speechTranscription.providerId as TranscriptionProviderId,
          configuration: {
            language: String(speechTranscription.configuration.language ?? "auto") as
              RuntimeAppSettings["speechTranscription"]["configuration"]["language"]
          }
        }
      : {
          providerId: "browser",
          configuration: { language: "auto" },
          configured: true,
          scope: "global",
          credentials: {}
        },
    updatedAt: user.updatedAt
  };
}

export function getSettings() {
  return runtimeSettings();
}

export function getSettingsForUser(userId: string) {
  return runtimeSettings(userId);
}

export function listProviderProfiles() {
  return listStoredProviderProfiles();
}

export function listProviderProfilesWithApiKeys() {
  return listRuntimeProviderProfiles();
}

export function duplicateProviderProfile(sourceProfileId: string) {
  duplicateProviderProfileRecord(sourceProfileId);
  return getSanitizedSettings();
}

export function getProviderProfile(profileId: string) {
  return getStoredProviderProfile(profileId);
}

export function getProviderProfileWithApiKey(profileId: string) {
  return getRuntimeProviderProfile(profileId);
}

export function getDefaultProviderProfile() {
  return getStoredDefaultProviderProfile();
}

export function getDefaultProviderProfileWithApiKey() {
  return getDefaultRuntimeProviderProfile();
}

function publicIntegrationSettings(userId?: string) {
  const webSearch = getIntegrationSetting("web_search", userId);
  const imageGeneration = getIntegrationSetting("image_generation");
  const speechTranscription = getIntegrationSetting("speech_transcription", userId);
  if (!webSearch || !imageGeneration || !speechTranscription) {
    throw new Error("Integration settings are not initialized");
  }
  return { webSearch, imageGeneration, speechTranscription };
}

export function getSanitizedSettings(userId?: string): PublicAppSettings & {
  providerProfiles: ProviderProfileSummary[];
} {
  const settings = runtimeSettings(userId);
  const integrations = publicIntegrationSettings(userId);
  return {
    defaultProviderProfileId: settings.defaultProviderProfileId,
    skillsEnabled: settings.skillsEnabled,
    conversationRetention: settings.conversationRetention,
    memoriesEnabled: settings.memoriesEnabled,
    memoriesMaxCount: settings.memoriesMaxCount,
    mcpTimeout: settings.mcpTimeout,
    maxAssistantToolSteps: settings.maxAssistantToolSteps,
    titleGenerationMode: settings.titleGenerationMode,
    titleGenerationProfileId: settings.titleGenerationProfileId,
    updatedAt: settings.updatedAt,
    webSearch: integrations.webSearch as PublicAppSettings["webSearch"],
    imageGeneration: integrations.imageGeneration as PublicAppSettings["imageGeneration"],
    speechTranscription: integrations.speechTranscription as PublicAppSettings["speechTranscription"],
    providerProfiles: listProviderProfileSummaries()
  };
}

export function updateGeneralSettingsForUser(
  userId: string,
  input: Partial<UserPreferences>
) {
  const global = getGlobalPreferences();
  updateUserPreferences(userId, global, input);
  return getSettingsForUser(userId);
}

export function updateTitleGenerationSettings(input: {
  titleGenerationMode: TitleGenerationMode;
  titleGenerationProfileId?: string | null;
}) {
  const current = getGlobalPreferences();
  return updateGlobalPreferences({
    titleGenerationMode: input.titleGenerationMode,
    titleGenerationProfileId: input.titleGenerationMode === "specific"
      ? input.titleGenerationProfileId ?? current.titleGenerationProfileId
      : null
  });
}

export function updateGeneralSettingsBundleForUser(
  userId: string,
  input: GeneralSettingsBundle,
  canManageGlobalIntegrations: boolean
) {
  if (!canManageGlobalIntegrations && (input.imageGeneration || input.titleGeneration)) {
    throw new Error("Only admins can update global settings");
  }
  const transaction = getDb().transaction(() => {
    updateGeneralSettingsForUser(userId, input.preferences);
    updateIntegrationSetting({ capability: "web_search", ...input.webSearch }, userId);
    updateIntegrationSetting(
      { capability: "speech_transcription", ...input.speechTranscription },
      userId
    );
    if (input.imageGeneration) {
      updateIntegrationSetting({ capability: "image_generation", ...input.imageGeneration });
    }
    if (input.titleGeneration) updateTitleGenerationSettings(input.titleGeneration);
  });
  transaction();
  return getSanitizedSettings(userId);
}

export function updateSettings(input: unknown) {
  const current = getGlobalPreferences();
  saveProviderCatalog({
    defaultProviderProfileId: current.defaultProviderProfileId,
    skillsEnabled: current.skillsEnabled,
    conversationRetention: current.conversationRetention,
    memoriesEnabled: current.memoriesEnabled,
    memoriesMaxCount: current.memoriesMaxCount,
    mcpTimeout: current.mcpTimeout,
    ...(input && typeof input === "object" ? input : {})
  });
  return getSanitizedSettings();
}

export function updateProviderCatalog(input: unknown) {
  return updateSettings(input);
}

export function getSettingsDefaults() {
  return createProviderProfileDraft({ name: "Default profile" });
}
