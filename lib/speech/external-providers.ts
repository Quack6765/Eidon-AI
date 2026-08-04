import {
  ASSEMBLYAI_MODEL_OPTIONS,
  ASSEMBLYAI_UNIVERSAL_2_LANGUAGES,
  DEFAULT_ASSEMBLYAI_MODEL,
  type AssemblyAiModelId
} from "@/lib/speech/assemblyai-languages";
import { ELEVENLABS_SCRIBE_LANGUAGES } from "@/lib/speech/elevenlabs-languages";

export type ExternalSttLanguageOption = {
  value: string;
  label: string;
};

export type ExternalSttProviderDefinition = {
  label: string;
  modelLabel: string;
  languages: readonly ExternalSttLanguageOption[];
  modelOptions?: readonly {
    value: string;
    label: string;
    languages: readonly ExternalSttLanguageOption[];
  }[];
  defaultModel?: string;
  automaticLanguageHint?: string;
};

export const EXTERNAL_STT_PROVIDERS = {
  elevenlabs: {
    label: "ElevenLabs",
    modelLabel: "Scribe v2",
    languages: ELEVENLABS_SCRIBE_LANGUAGES
  },
  assemblyai: {
    label: "AssemblyAI",
    modelLabel: "Universal 3.5 Pro",
    languages: ASSEMBLYAI_UNIVERSAL_2_LANGUAGES,
    modelOptions: ASSEMBLYAI_MODEL_OPTIONS,
    defaultModel: DEFAULT_ASSEMBLYAI_MODEL,
    automaticLanguageHint: "Automatic language detection is most reliable with at least 15 seconds of speech."
  }
} as const satisfies Record<string, ExternalSttProviderDefinition>;

export type SttProvider = keyof typeof EXTERNAL_STT_PROVIDERS;

export const DEFAULT_EXTERNAL_STT_PROVIDER: SttProvider = "elevenlabs";
export const DEFAULT_EXTERNAL_STT_LANGUAGE =
  EXTERNAL_STT_PROVIDERS[DEFAULT_EXTERNAL_STT_PROVIDER].languages[0].value;

export const EXTERNAL_STT_PROVIDER_IDS = Object.keys(
  EXTERNAL_STT_PROVIDERS
) as [SttProvider, ...SttProvider[]];

type ExternalSttProviderConfig =
  typeof EXTERNAL_STT_PROVIDERS[SttProvider];

export type ExternalSttLanguageForProvider<Provider extends SttProvider> =
  typeof EXTERNAL_STT_PROVIDERS[Provider]["languages"][number]["value"];

export type ExternalSttLanguage = ExternalSttLanguageForProvider<SttProvider>;
export type ExternalSttModel = AssemblyAiModelId;

export const EXTERNAL_STT_PROVIDER_OPTIONS = Object.entries(
  EXTERNAL_STT_PROVIDERS
).map(([value, config]) => ({
  value: value as SttProvider,
  ...config
}));

export const EXTERNAL_STT_LANGUAGE_CODES = EXTERNAL_STT_PROVIDER_OPTIONS.flatMap(
  ({ languages }: ExternalSttProviderDefinition) => languages.map(({ value }) => value)
) as [ExternalSttLanguage, ...ExternalSttLanguage[]];

export function isSttProvider(provider: string): provider is SttProvider {
  return provider in EXTERNAL_STT_PROVIDERS;
}

export function getExternalSttProviderConfig(provider: SttProvider) {
  return EXTERNAL_STT_PROVIDERS[provider];
}

export function getExternalSttLanguageOptions(
  provider: SttProvider,
  model?: string
): readonly ExternalSttLanguageOption[] {
  const config: ExternalSttProviderDefinition = EXTERNAL_STT_PROVIDERS[provider];
  if (!config.modelOptions) return config.languages;
  return config.modelOptions.find((option) => option.value === model)?.languages ??
    config.modelOptions.find((option) => option.value === config.defaultModel)?.languages ??
    config.modelOptions[0].languages;
}

export function isExternalSttLanguageForProvider(
  provider: SttProvider,
  language: ExternalSttLanguage,
  model?: string
) {
  const languages = getExternalSttLanguageOptions(provider, model);
  return languages.some(
    (option) => option.value === language
  );
}
