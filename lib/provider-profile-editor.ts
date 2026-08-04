import {
  createProviderProfileDraft,
  getMatchingProviderPresetId,
  getProviderPreset,
  PROVIDER_CATALOG,
  type ProviderKind,
  type ProviderPresetId,
  type ProviderPresetValues
} from "@/lib/provider-catalog";
import type {
  ProviderProfileSummary
} from "@/lib/provider-profile";
import type { CredentialAction } from "@/lib/integration-types";

export type ProviderProfileEditorDraft = ProviderProfileSummary & {
  credential: string;
  credentialAction: CredentialAction;
};

export function toProviderProfileEditorDraft(
  profile: ProviderProfileSummary
): ProviderProfileEditorDraft {
  return { ...profile, credential: "", credentialAction: "preserve" };
}

export function toProviderProfileEditorDrafts(profiles: ProviderProfileSummary[]) {
  return profiles.map(toProviderProfileEditorDraft);
}

export function createProviderProfileEditorDraft(input?: {
  id?: string;
  providerKind?: ProviderKind;
  name?: string;
}): ProviderProfileEditorDraft {
  const flat = createProviderProfileDraft(input);
  const {
    apiBaseUrl,
    apiMode,
    reasoningParameterMode,
    ...core
  } = flat;
  const timestamp = new Date().toISOString();
  const providerConfig = flat.providerKind === "github_copilot"
    ? {}
    : flat.providerKind === "anthropic"
      ? { apiBaseUrl }
      : { apiBaseUrl, apiMode, reasoningParameterMode };
  return {
    ...core,
    providerConfig,
    connection: {
      mode: PROVIDER_CATALOG[flat.providerKind].connectionMode,
      status: "disconnected",
      accountLabel: null,
      expiresAt: null
    },
    credential: "",
    credentialAction: "clear",
    createdAt: timestamp,
    updatedAt: timestamp
  } as ProviderProfileEditorDraft;
}

export function switchProviderProfileKind(
  profile: ProviderProfileEditorDraft,
  providerKind: ProviderKind
): ProviderProfileEditorDraft {
  if (profile.providerKind === providerKind) return profile;
  const next = createProviderProfileEditorDraft({
    id: profile.id,
    providerKind,
    name: profile.name
  });
  return {
    ...next,
    systemPrompt: profile.systemPrompt,
    compactionThreshold: profile.compactionThreshold,
    freshTailCount: profile.freshTailCount,
    visionMode: profile.visionMode,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

export function applyPresetToProviderProfile(
  profile: ProviderProfileEditorDraft,
  presetId: ProviderPresetId
): ProviderProfileEditorDraft {
  const preset = getProviderPreset(presetId);
  if (preset.providerKind !== profile.providerKind) return profile;
  const values: ProviderPresetValues = preset.values;
  const {
    name: _name,
    apiBaseUrl,
    apiMode,
    reasoningParameterMode,
    ...behavior
  } = values;
  const providerConfig = profile.providerKind === "openai_compatible"
    ? {
        apiBaseUrl,
        apiMode,
        reasoningParameterMode: reasoningParameterMode ?? "standard" as const
      }
    : profile.providerKind === "anthropic"
      ? { apiBaseUrl }
      : {};
  return {
    ...profile,
    ...behavior,
    providerConfig,
    providerPresetId: presetId,
    credential: "",
    credentialAction: "clear",
    connection: {
      ...profile.connection,
      status: "disconnected",
      accountLabel: null,
      expiresAt: null
    }
  } as ProviderProfileEditorDraft;
}

export function getMatchingEditorPresetId(profile: ProviderProfileEditorDraft) {
  if (profile.providerKind === "github_copilot") return null;
  return getMatchingProviderPresetId({
    ...profile,
    apiBaseUrl: profile.providerConfig.apiBaseUrl,
    apiMode: profile.providerKind === "openai_compatible"
      ? profile.providerConfig.apiMode
      : "chat_completions",
    reasoningParameterMode: profile.providerKind === "openai_compatible"
      ? profile.providerConfig.reasoningParameterMode
      : "standard"
  });
}

export function buildProviderProfileInput(profile: ProviderProfileEditorDraft) {
  const {
    connection: _connection,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = profile;
  return {
    ...input,
    compactionThreshold: Math.round(profile.compactionThreshold * 100) / 100
  };
}

export function setProviderApiMode(
  profile: ProviderProfileEditorDraft,
  apiMode: "responses" | "chat_completions"
): ProviderProfileEditorDraft {
  if (profile.providerKind !== "openai_compatible") return profile;
  return {
    ...profile,
    providerConfig: { ...profile.providerConfig, apiMode },
    providerPresetId: null
  };
}
