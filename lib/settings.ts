import { getDb } from "@/lib/db";
import { getGlobalPreferences, updateGlobalPreferences } from "@/lib/global-preferences";
import {
  getIntegrationSetting,
  getRuntimeIntegrationSetting,
  updateIntegrationSetting,
  type IntegrationCapability,
  type CredentialAction
} from "@/lib/integration-settings";
import {
  duplicateProviderProfileRecord,
  getDefaultRuntimeProviderProfile as getStoredDefaultRuntimeProviderProfile,
  getProviderProfile as getStoredProviderProfile,
  getRuntimeProviderProfile as getStoredRuntimeProviderProfile,
  getSelectableProviderProfile as getStoredSelectableProviderProfile,
  listProviderProfiles as listStoredProviderProfiles,
  listRuntimeProviderProfiles as listStoredRuntimeProviderProfiles,
  saveProviderCatalog
} from "@/lib/provider-profiles";
import { canUseProviderProfile, toProviderProfileSummary } from "@/lib/provider-profile";
import { getUserPreferences, updateUserPreferences, type UserPreferences } from "@/lib/user-preferences";
import { getUserById } from "@/lib/users";
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
  preferences: Partial<
    Pick<
      UserPreferences,
      | "conversationRetention"
      | "mcpTimeout"
      | "maxAssistantToolSteps"
      | "confirmExternalLinks"
      | "toolCallDisplay"
      | "defaultView"
      | "followUpBehavior"
      | "memoriesEnabled"
      | "memoriesMaxCount"
      | "memoriesRigor"
    >
  >;
  webSearch?: IntegrationUpdate<WebSearchProviderId>;
  speechTranscription?: IntegrationUpdate<TranscriptionProviderId>;
  imageGeneration?: IntegrationUpdate<ImageGenerationProviderId>;
  titleGeneration?: {
    titleGenerationMode: TitleGenerationMode;
    titleGenerationProfileId: string | null;
  };
  speechCleanup?: {
    enabled: boolean;
    profileId: string | null;
    prompt: string;
  };
  botPrompt?: {
    prompt: string;
  };
  semanticRecall?: {
    enabled: boolean;
  };
};

function runtimeSettings(userId?: string): RuntimeAppSettings {
  const global = getGlobalPreferences();
  const user = userId ? getUserPreferences(userId, global) : global;
  const webSearch = getRuntimeIntegrationSetting("web_search");
  const imageGeneration = getRuntimeIntegrationSetting("image_generation");
  const speechTranscription = getRuntimeIntegrationSetting("speech_transcription");

  return {
    defaultProviderProfileId: global.defaultProviderProfileId,
    skillsEnabled: global.skillsEnabled,
    conversationRetention: user.conversationRetention,
    memoriesEnabled: user.memoriesEnabled,
    memoriesMaxCount: user.memoriesMaxCount,
    memoriesRigor: user.memoriesRigor,
    semanticRecallEnabled: global.semanticRecallEnabled,
    mcpTimeout: user.mcpTimeout,
    maxAssistantToolSteps: user.maxAssistantToolSteps,
    confirmExternalLinks: user.confirmExternalLinks,
    toolCallDisplay: user.toolCallDisplay,
    defaultView: user.defaultView,
    followUpBehavior: user.followUpBehavior,
    hasCompletedOnboarding: "hasCompletedOnboarding" in user ? user.hasCompletedOnboarding : true,
    titleGenerationMode: global.titleGenerationMode,
    titleGenerationProfileId: global.titleGenerationProfileId,
    speechCleanupEnabled: global.speechCleanupEnabled,
    speechCleanupProfileId: global.speechCleanupProfileId,
    speechCleanupPrompt: global.speechCleanupPrompt,
    botSystemPrompt: global.botSystemPrompt,
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
          credentialStored: false,
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
          credentialStored: false,
          scope: "global",
          credentials: {}
        },
    speechTranscription: speechTranscription
      ? {
          ...speechTranscription,
          providerId: speechTranscription.providerId as TranscriptionProviderId,
          configuration: {
            language: (Array.isArray(speechTranscription.configuration.language)
              ? speechTranscription.configuration.language
              : String(speechTranscription.configuration.language ?? "auto")) as
              RuntimeAppSettings["speechTranscription"]["configuration"]["language"],
            ...(speechTranscription.configuration.model
              ? { model: speechTranscription.configuration.model as
                  RuntimeAppSettings["speechTranscription"]["configuration"]["model"] }
              : {})
          }
        }
      : {
          providerId: "browser",
          configuration: { language: "auto" },
          configured: true,
          credentialStored: false,
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

export function listRuntimeProviderProfiles() {
  return listStoredRuntimeProviderProfiles();
}

export function duplicateProviderProfile(sourceProfileId: string) {
  duplicateProviderProfileRecord(sourceProfileId);
  return getSanitizedSettings();
}

export function getProviderProfile(profileId: string) {
  return getStoredProviderProfile(profileId);
}

export function getRuntimeProviderProfile(profileId: string) {
  return getStoredRuntimeProviderProfile(profileId);
}

export function getSelectableProviderProfile(profileId: string, userId: string | null) {
  return getStoredSelectableProviderProfile(profileId, userId);
}

export function getDefaultRuntimeProviderProfile(userId: string | null) {
  return getStoredDefaultRuntimeProviderProfile(userId);
}

function getVisibleProviderProfiles(userId?: string) {
  const profiles = listStoredRuntimeProviderProfiles();
  const viewer = userId ? getUserById(userId) : null;
  if (!viewer || viewer.role === "admin") {
    return {
      profiles,
      defaultProviderProfileId: getGlobalPreferences().defaultProviderProfileId
    };
  }
  return {
    profiles: profiles.filter((profile) => canUseProviderProfile(profile, viewer.id)),
    defaultProviderProfileId: getStoredDefaultRuntimeProviderProfile(viewer.id)?.id ?? null
  };
}

function publicIntegrationSettings() {
  const webSearch = getIntegrationSetting("web_search");
  const imageGeneration = getIntegrationSetting("image_generation");
  const speechTranscription = getIntegrationSetting("speech_transcription");
  if (!webSearch || !imageGeneration || !speechTranscription) {
    throw new Error("Integration settings are not initialized");
  }
  return { webSearch, imageGeneration, speechTranscription };
}

export function getSanitizedSettings(userId?: string): PublicAppSettings & {
  providerProfiles: ProviderProfileSummary[];
} {
  const settings = runtimeSettings(userId);
  const integrations = publicIntegrationSettings();
  const providers = getVisibleProviderProfiles(userId);
  return {
    defaultProviderProfileId: providers.defaultProviderProfileId,
    skillsEnabled: settings.skillsEnabled,
    conversationRetention: settings.conversationRetention,
    memoriesEnabled: settings.memoriesEnabled,
    memoriesMaxCount: settings.memoriesMaxCount,
    memoriesRigor: settings.memoriesRigor,
    semanticRecallEnabled: settings.semanticRecallEnabled,
    mcpTimeout: settings.mcpTimeout,
    maxAssistantToolSteps: settings.maxAssistantToolSteps,
    confirmExternalLinks: settings.confirmExternalLinks,
    toolCallDisplay: settings.toolCallDisplay,
    defaultView: settings.defaultView,
    followUpBehavior: settings.followUpBehavior,
    hasCompletedOnboarding: settings.hasCompletedOnboarding,
    titleGenerationMode: settings.titleGenerationMode,
    titleGenerationProfileId: settings.titleGenerationProfileId,
    speechCleanupEnabled: settings.speechCleanupEnabled,
    speechCleanupProfileId: settings.speechCleanupProfileId,
    speechCleanupPrompt: settings.speechCleanupPrompt,
    botSystemPrompt: settings.botSystemPrompt,
    updatedAt: settings.updatedAt,
    webSearch: integrations.webSearch as PublicAppSettings["webSearch"],
    imageGeneration: integrations.imageGeneration as PublicAppSettings["imageGeneration"],
    speechTranscription: integrations.speechTranscription as PublicAppSettings["speechTranscription"],
    providerProfiles: providers.profiles.map(toProviderProfileSummary)
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

export function updateSpeechCleanupSettings(input: {
  enabled: boolean;
  profileId: string | null;
  prompt: string;
}) {
  const current = getGlobalPreferences();
  return updateGlobalPreferences({
    speechCleanupEnabled: input.enabled,
    speechCleanupProfileId: input.enabled
      ? input.profileId ?? current.speechCleanupProfileId
      : current.speechCleanupProfileId,
    speechCleanupPrompt: input.prompt
  });
}

export function updateBotPromptSettings(input: { prompt: string }) {
  return updateGlobalPreferences({
    botSystemPrompt: input.prompt
  });
}

export function updateGeneralSettingsBundleForUser(
  userId: string,
  input: GeneralSettingsBundle,
  canManageGlobalIntegrations: boolean
) {
  const integrationUpdates = ([
    ["web_search", input.webSearch],
    ["speech_transcription", input.speechTranscription],
    ["image_generation", input.imageGeneration]
  ] as Array<[IntegrationCapability, unknown]>).filter(([, update]) => update !== undefined);
  if (
    !canManageGlobalIntegrations &&
    (integrationUpdates.length > 0 || input.titleGeneration || input.speechCleanup || input.botPrompt || input.semanticRecall)
  ) {
    throw new Error("Only admins can update global settings");
  }
  const transaction = getDb().transaction(() => {
    updateGeneralSettingsForUser(userId, input.preferences);
    for (const [capability, update] of integrationUpdates) {
      updateIntegrationSetting({
        capability,
        ...(update as Record<string, unknown>)
      });
    }
    if (input.titleGeneration) updateTitleGenerationSettings(input.titleGeneration);
    if (input.speechCleanup) updateSpeechCleanupSettings(input.speechCleanup);
    if (input.botPrompt) updateBotPromptSettings(input.botPrompt);
    if (input.semanticRecall) updateGlobalPreferences({ semanticRecallEnabled: input.semanticRecall.enabled });
  });
  transaction();
  return getSanitizedSettings(userId);
}

export function updateProviderCatalog(input: unknown) {
  const current = getGlobalPreferences();
  saveProviderCatalog({
    defaultProviderProfileId: current.defaultProviderProfileId,
    skillsEnabled: current.skillsEnabled,
    conversationRetention: current.conversationRetention,
    memoriesEnabled: current.memoriesEnabled,
    memoriesMaxCount: current.memoriesMaxCount,
    memoriesRigor: current.memoriesRigor,
    mcpTimeout: current.mcpTimeout,
    ...(input && typeof input === "object" ? input : {})
  });
  return getSanitizedSettings();
}
