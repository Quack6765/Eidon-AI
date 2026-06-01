import { DEFAULT_PROVIDER_SETTINGS } from "@/lib/constants";
import type { ApiMode, ProviderKind, ProviderPresetId, ReasoningEffort } from "@/lib/types";

export type { ProviderPresetId } from "@/lib/types";

type ProviderPresetValues = {
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: ApiMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  temperature?: number;
  maxOutputTokens?: number;
};

type ProviderPresetDefinition = {
  id: ProviderPresetId;
  label: string;
  providerKind: ProviderKind;
  values: ProviderPresetValues;
};

type PresetCompatibleProfile = {
  providerKind?: string;
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: ApiMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  temperature?: number;
  maxOutputTokens?: number;
};

export const PROVIDER_PRESETS: ProviderPresetDefinition[] = [
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    providerKind: "openai_compatible",
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
    providerKind: "openai_compatible",
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
    id: "openrouter",
    label: "OpenRouter",
    providerKind: "openai_compatible",
    values: {
      name: "OpenRouter",
      apiBaseUrl: "https://openrouter.ai/api/v1",
      model: "",
      apiMode: DEFAULT_PROVIDER_SETTINGS.apiMode,
      reasoningEffort: DEFAULT_PROVIDER_SETTINGS.reasoningEffort,
      reasoningSummaryEnabled: DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled,
      modelContextLimit: 200000
    }
  },
  {
    id: "opencode_go",
    label: "OpenCode Go",
    providerKind: "openai_compatible",
    values: {
      name: "OpenCode Go",
      apiBaseUrl: "https://opencode.ai/zen/go/v1",
      model: "kimi-k2.6",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 200000
    }
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    providerKind: "openai_compatible",
    values: {
      name: "DeepSeek",
      apiBaseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 1_000_000,
      temperature: 1.3,
      maxOutputTokens: 8192
    }
  },
  {
    id: "custom_openai_compatible",
    label: "Custom OpenAI compatible",
    providerKind: "openai_compatible",
    values: {
      name: "Custom OpenAI compatible",
      apiBaseUrl: DEFAULT_PROVIDER_SETTINGS.apiBaseUrl,
      model: DEFAULT_PROVIDER_SETTINGS.model,
      apiMode: DEFAULT_PROVIDER_SETTINGS.apiMode,
      reasoningEffort: DEFAULT_PROVIDER_SETTINGS.reasoningEffort,
      reasoningSummaryEnabled: DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled,
      modelContextLimit: DEFAULT_PROVIDER_SETTINGS.modelContextLimit
    }
  },
  {
    id: "anthropic_official",
    label: "Anthropic",
    providerKind: "anthropic",
    values: {
      name: "Anthropic",
      apiBaseUrl: "https://api.anthropic.com",
      model: "claude-opus-4-8",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 200000
    }
  },
  {
    id: "opencode_go_anthropic",
    label: "OpenCode Go",
    providerKind: "anthropic",
    values: {
      name: "OpenCode Go",
      apiBaseUrl: "https://opencode.ai/zen/go",
      model: "qwen3.7-max",
      apiMode: "chat_completions",
      reasoningEffort: "none",
      reasoningSummaryEnabled: false,
      modelContextLimit: 200000
    }
  }
];

function profileKind(profile: PresetCompatibleProfile): ProviderKind {
  return (profile.providerKind as ProviderKind | undefined) ?? "openai_compatible";
}

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
  const preset = getProviderPreset(presetId);

  if (preset.providerKind !== profileKind(profile)) {
    return profile;
  }

  const { name: _presetName, ...presetValues } = preset.values;

  return {
    ...profile,
    ...presetValues
  };
}

export function getMatchingProviderPresetId(
  profile: PresetCompatibleProfile
): ProviderPresetId | null {
  const kind = profileKind(profile);

  const preset = PROVIDER_PRESETS.find((entry) => {
    if (entry.providerKind !== kind) {
      return false;
    }

    const { values } = entry;
    const required: Array<keyof typeof values> = [
      "apiBaseUrl",
      "model",
      "apiMode",
      "reasoningEffort",
      "reasoningSummaryEnabled",
      "modelContextLimit"
    ];

    for (const key of required) {
      if (values[key] !== profile[key]) {
        return false;
      }
    }

    if (values.temperature !== undefined && values.temperature !== profile.temperature) {
      return false;
    }

    if (
      values.maxOutputTokens !== undefined &&
      values.maxOutputTokens !== profile.maxOutputTokens
    ) {
      return false;
    }

    return true;
  });

  return preset?.id ?? null;
}
