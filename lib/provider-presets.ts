import { DEFAULT_PROVIDER_SETTINGS } from "@/lib/constants";
import type { ApiMode, ReasoningEffort } from "@/lib/types";

export type ProviderPresetId =
  | "ollama_cloud"
  | "glm_coding_plan"
  | "custom_openai_compatible";

type ProviderPresetValues = {
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: ApiMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
};

type ProviderPresetDefinition = {
  id: ProviderPresetId;
  label: string;
  values: ProviderPresetValues;
};

type PresetCompatibleProfile = {
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: ApiMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
};

export const PROVIDER_PRESETS: ProviderPresetDefinition[] = [
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    values: {
      name: "Ollama Cloud",
      apiBaseUrl: "https://ollama.com/v1",
      model: "glm-4.7:cloud",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 64000
    }
  },
  {
    id: "glm_coding_plan",
    label: "GLM Coding Plan",
    values: {
      name: "GLM Coding Plan",
      apiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
      model: "glm-5.1",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 200000
    }
  },
  {
    id: "custom_openai_compatible",
    label: "Custom OpenAI compatible",
    values: {
      name: "Custom OpenAI compatible",
      apiBaseUrl: DEFAULT_PROVIDER_SETTINGS.apiBaseUrl,
      model: DEFAULT_PROVIDER_SETTINGS.model,
      apiMode: DEFAULT_PROVIDER_SETTINGS.apiMode,
      reasoningEffort: DEFAULT_PROVIDER_SETTINGS.reasoningEffort,
      reasoningSummaryEnabled: DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled,
      modelContextLimit: DEFAULT_PROVIDER_SETTINGS.modelContextLimit
    }
  }
];

export function getProviderPreset(id: ProviderPresetId) {
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);

  if (!preset) {
    throw new Error(`Unknown provider preset: ${id}`);
  }

  return preset;
}

export function applyProviderPreset<T extends PresetCompatibleProfile>(
  profile: T,
  presetId: ProviderPresetId
) {
  return {
    ...profile,
    ...getProviderPreset(presetId).values
  };
}

export function getMatchingProviderPresetId(
  profile: PresetCompatibleProfile
): ProviderPresetId | null {
  const preset = PROVIDER_PRESETS.find((entry) => {
    const { values } = entry;

    return (
      values.name === profile.name &&
      values.apiBaseUrl === profile.apiBaseUrl &&
      values.model === profile.model &&
      values.apiMode === profile.apiMode &&
      values.reasoningEffort === profile.reasoningEffort &&
      values.reasoningSummaryEnabled === profile.reasoningSummaryEnabled &&
      values.modelContextLimit === profile.modelContextLimit
    );
  });

  return preset?.id ?? null;
}
