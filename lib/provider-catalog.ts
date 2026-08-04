export type ProviderConnectionMode = "api_key" | "oauth";
export type ApiMode = "responses" | "chat_completions";
export type ReasoningParameterMode = "standard" | "mirrored";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";
export type VisionMode = "none" | "native" | "mcp";

export const DEFAULT_PROFILE_BEHAVIOR = {
  systemPrompt:
    "You are an helpful AI assistant with advanced reasoning capabilities. You excel at complex problem-solving, analysis, coding, mathematics, and tasks requiring careful, step-by-step thinking.\nWhen responding:\n1. **Think step by step** - Break down complex problems into logical steps. Show your reasoning process clearly before arriving at conclusions.\n2. **Be thorough but concise** - Explore ideas deeply, but avoid unnecessary verbosity. Focus on substantive reasoning over filler text.\n3. **Verify your logic** - Double-check your reasoning for consistency, accuracy, and completeness before finalizing your answer.\n4. **Acknowledge uncertainty** - When appropriate, indicate confidence levels or alternative interpretations of the problem.\n5. **Use structured formats** - For complex answers, use numbered steps, bullet points, or sections to organize your thinking.\n6. **Adapt depth to the task** - Match the depth of your reasoning to the complexity of the question. Simple questions don't need elaborate analysis.\n7. **Use emojis sparingly** - You may use an occasional emoji when it genuinely improves tone or clarity, but keep usage infrequent and minimal. Do not use emojis in every response, avoid repeated or decorative emoji use, and never let them clutter the message.\nAlways aim to be helpful, accurate, and honest in your responses.",
  temperature: 0.7,
  maxOutputTokens: 1200,
  reasoningEffort: "medium" as ReasoningEffort,
  reasoningSummaryEnabled: true,
  modelContextLimit: 200000,
  compactionThreshold: 0.8,
  freshTailCount: 28,
  tokenizerModel: "gpt-tokenizer" as const,
  safetyMarginTokens: 1200,
  leafSourceTokenLimit: 12000,
  leafMinMessageCount: 6,
  mergedMinNodeCount: 4,
  mergedTargetTokens: 1600,
  visionMode: "native" as VisionMode
} as const;

export const PROVIDER_CATALOG = {
  openai_compatible: {
    label: "OpenAI compatible",
    connectionMode: "api_key",
    apiModes: ["responses", "chat_completions"],
    defaultPresetId: "custom_openai_compatible",
    supportedConfiguration: ["apiBaseUrl", "apiMode", "reasoningParameterMode"],
    editor: {
      sampling: true,
      apiMode: true,
      tokenization: true,
      modelInput: "manual"
    }
  },
  github_copilot: {
    label: "GitHub Copilot",
    connectionMode: "oauth",
    apiModes: ["chat_completions"],
    defaultPresetId: null,
    supportedConfiguration: [],
    editor: {
      sampling: false,
      apiMode: false,
      tokenization: false,
      modelInput: "discovered"
    }
  },
  anthropic: {
    label: "Anthropic compatible",
    connectionMode: "api_key",
    apiModes: ["chat_completions"],
    defaultPresetId: "anthropic_official",
    supportedConfiguration: ["apiBaseUrl"],
    editor: {
      sampling: true,
      apiMode: false,
      tokenization: true,
      modelInput: "manual"
    }
  }
} as const satisfies Record<
  string,
  {
    label: string;
    connectionMode: ProviderConnectionMode;
    apiModes: readonly ApiMode[];
    defaultPresetId: string | null;
    supportedConfiguration: readonly (
      | "apiBaseUrl"
      | "apiMode"
      | "reasoningParameterMode"
    )[];
    editor: {
      sampling: boolean;
      apiMode: boolean;
      tokenization: boolean;
      modelInput: "manual" | "discovered";
    };
  }
>;

export type ProviderKind = keyof typeof PROVIDER_CATALOG;

export type ProviderPresetValues = {
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: ApiMode;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  temperature?: number;
  maxOutputTokens?: number;
  visionMode?: VisionMode;
  reasoningParameterMode?: ReasoningParameterMode;
};

export const PROVIDER_PRESETS = [
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
      modelContextLimit: 64000,
      reasoningParameterMode: "mirrored"
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
      apiMode: "responses",
      reasoningEffort: DEFAULT_PROFILE_BEHAVIOR.reasoningEffort,
      reasoningSummaryEnabled: DEFAULT_PROFILE_BEHAVIOR.reasoningSummaryEnabled,
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
      modelContextLimit: 1000000,
      temperature: 1.3,
      maxOutputTokens: 8192
    }
  },
  {
    id: "xiaomi_mimo",
    label: "Xiaomi Mimo",
    providerKind: "openai_compatible",
    values: {
      name: "Xiaomi Mimo",
      apiBaseUrl: "https://api.xiaomimimo.com/v1",
      model: "mimo-v2.5",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 1048576,
      temperature: 1,
      maxOutputTokens: 131072,
      visionMode: "native"
    }
  },
  {
    id: "custom_openai_compatible",
    label: "Custom OpenAI compatible",
    providerKind: "openai_compatible",
    values: {
      name: "Custom OpenAI compatible",
      apiBaseUrl: "https://api.openai.com/v1",
      model: "gpt-5-mini",
      apiMode: "responses",
      reasoningEffort: DEFAULT_PROFILE_BEHAVIOR.reasoningEffort,
      reasoningSummaryEnabled: DEFAULT_PROFILE_BEHAVIOR.reasoningSummaryEnabled,
      modelContextLimit: DEFAULT_PROFILE_BEHAVIOR.modelContextLimit
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
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  providerKind: ProviderKind;
  values: ProviderPresetValues;
}>;

export type ProviderPresetId = (typeof PROVIDER_PRESETS)[number]["id"];

type PresetCompatibleProfile = ProviderPresetValues & {
  providerKind?: string;
  temperature?: number;
  maxOutputTokens?: number;
  visionMode?: VisionMode;
};

export function getProviderPreset(id: ProviderPresetId) {
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);
  if (!preset) throw new Error(`Unknown provider preset: ${id}`);
  return preset;
}

export function applyProviderPreset<T extends PresetCompatibleProfile>(
  profile: T,
  presetId: ProviderPresetId
) {
  const preset = getProviderPreset(presetId);
  if (preset.providerKind !== (profile.providerKind ?? "openai_compatible")) return profile;
  const { name: _presetName, ...presetValues } = preset.values;
  return { ...profile, ...presetValues };
}

export function getMatchingProviderPresetId(
  profile: PresetCompatibleProfile
): ProviderPresetId | null {
  const preset = PROVIDER_PRESETS.find((entry) => {
    if (entry.providerKind !== (profile.providerKind ?? "openai_compatible")) return false;
    const required = [
      "apiBaseUrl",
      "model",
      "apiMode",
      "reasoningEffort",
      "reasoningSummaryEnabled",
      "modelContextLimit"
    ] as const;
    if (required.some((key) => entry.values[key] !== profile[key])) return false;
    const values = entry.values as ProviderPresetValues;
    if (values.temperature !== undefined && values.temperature !== profile.temperature) return false;
    if (values.maxOutputTokens !== undefined && values.maxOutputTokens !== profile.maxOutputTokens) return false;
    if (values.visionMode !== undefined && values.visionMode !== profile.visionMode) return false;
    if ((values.reasoningParameterMode ?? "standard") !==
      (profile.reasoningParameterMode ?? "standard")) return false;
    return true;
  });
  return preset?.id ?? null;
}

export function createProviderProfileDraft(input?: {
  id?: string;
  providerKind?: ProviderKind;
  name?: string;
}) {
  const providerKind = input?.providerKind ?? "openai_compatible";
  const presetId = PROVIDER_CATALOG[providerKind].defaultPresetId as ProviderPresetId | null;
  const preset = presetId ? getProviderPreset(presetId) : null;
  const providerValues = preset?.values ?? {
    name: PROVIDER_CATALOG[providerKind].label,
    apiBaseUrl: "",
    model: "",
    apiMode: PROVIDER_CATALOG[providerKind].apiModes[0],
    reasoningEffort: DEFAULT_PROFILE_BEHAVIOR.reasoningEffort,
    reasoningSummaryEnabled: DEFAULT_PROFILE_BEHAVIOR.reasoningSummaryEnabled,
    modelContextLimit: DEFAULT_PROFILE_BEHAVIOR.modelContextLimit
  };

  return {
    id: input?.id ?? `profile_${crypto.randomUUID()}`,
    providerKind,
    ...DEFAULT_PROFILE_BEHAVIOR,
    ...providerValues,
    reasoningParameterMode: "reasoningParameterMode" in providerValues
      ? providerValues.reasoningParameterMode
      : "standard",
    name: input?.name ?? providerValues.name,
    providerPresetId: presetId
  };
}
