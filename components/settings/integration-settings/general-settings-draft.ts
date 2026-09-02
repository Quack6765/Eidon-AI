import type { CredentialAction } from "@/lib/integration-types";
import { DEFAULT_SPEECH_CLEANUP_PROMPT } from "@/lib/speech/cleanup-prompt";
import type { AppSettings, ConversationRetention } from "@/lib/types";

export type IntegrationDraft<Selection extends {
  providerId: string;
  configuration: Record<string, unknown>;
}> = {
  providerId: Selection["providerId"];
  configuration: Selection["configuration"];
  credential: string;
  credentialAction: CredentialAction;
  credentialStored: boolean;
};

export type GeneralSettingsDraft = {
  preferences: {
    conversationRetention: ConversationRetention;
    mcpTimeout: number;
    maxAssistantToolSteps: number;
    confirmExternalLinks: boolean;
    toolCallDisplay: AppSettings["toolCallDisplay"];
  };
  webSearch: IntegrationDraft<AppSettings["webSearch"]>;
  imageGeneration: IntegrationDraft<AppSettings["imageGeneration"]>;
  speechTranscription: IntegrationDraft<AppSettings["speechTranscription"]>;
  titleGeneration: {
    titleGenerationMode: AppSettings["titleGenerationMode"];
    titleGenerationProfileId: string | null;
  };
  speechCleanup: {
    enabled: boolean;
    profileId: string | null;
    prompt: string;
  };
  botPrompt: {
    prompt: string;
  };
};

function createIntegrationDraft<Selection extends {
  providerId: string;
  configuration: Record<string, unknown>;
  credentialStored: boolean;
}>(selection: Selection): IntegrationDraft<Selection> {
  return {
    providerId: selection.providerId,
    configuration: { ...selection.configuration },
    credential: "",
    credentialAction: "preserve",
    credentialStored: selection.credentialStored
  };
}

export function createGeneralSettingsDraft(settings: AppSettings): GeneralSettingsDraft {
  return {
    preferences: {
      conversationRetention: settings.conversationRetention,
      mcpTimeout: settings.mcpTimeout,
      maxAssistantToolSteps: settings.maxAssistantToolSteps,
      confirmExternalLinks: settings.confirmExternalLinks,
      toolCallDisplay: settings.toolCallDisplay
    },
    webSearch: createIntegrationDraft(settings.webSearch),
    imageGeneration: createIntegrationDraft(settings.imageGeneration),
    speechTranscription: createIntegrationDraft(settings.speechTranscription),
    titleGeneration: {
      titleGenerationMode: settings.titleGenerationMode,
      titleGenerationProfileId: settings.titleGenerationProfileId
    },
    speechCleanup: {
      enabled: settings.speechCleanupEnabled,
      profileId: settings.speechCleanupProfileId,
      prompt: settings.speechCleanupPrompt || DEFAULT_SPEECH_CLEANUP_PROMPT
    },
    botPrompt: {
      prompt: settings.botSystemPrompt
    }
  };
}

export function selectIntegrationProvider<Selection extends {
  providerId: string;
  configuration: Record<string, unknown>;
}>(
  current: IntegrationDraft<Selection>,
  persisted: IntegrationDraft<Selection>,
  providerId: Selection["providerId"],
  configuration: Selection["configuration"]
): IntegrationDraft<Selection> {
  const usesPersistedCredential = providerId === persisted.providerId;
  return {
    ...current,
    providerId,
    configuration,
    credential: "",
    credentialAction: usesPersistedCredential ? "preserve" : "clear",
    credentialStored: usesPersistedCredential && persisted.credentialStored
  };
}

export function buildIntegrationUpdate<Selection extends {
  providerId: string;
  configuration: Record<string, unknown>;
}>(draft: IntegrationDraft<Selection>) {
  return {
    providerId: draft.providerId,
    configuration: draft.configuration,
    credential: draft.credential.trim() || undefined,
    credentialAction: draft.credentialAction
  };
}

export function draftCredentials(draft: {
  credential: string;
  credentialAction: CredentialAction;
  credentialStored: boolean;
}) {
  if (draft.credentialAction === "replace" && draft.credential.trim()) {
    return { apiKey: draft.credential.trim() };
  }
  if (draft.credentialAction === "preserve" && draft.credentialStored) {
    return { apiKey: "stored" };
  }
  return {};
}
