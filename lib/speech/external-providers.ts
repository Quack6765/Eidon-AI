import {
  ASSEMBLYAI_MODEL_OPTIONS,
  DEFAULT_ASSEMBLYAI_MODEL
} from "@/lib/speech/assemblyai-languages";
import { ELEVENLABS_SCRIBE_LANGUAGES } from "@/lib/speech/elevenlabs-languages";

export type ExternalSttLanguageOption = {
  value: string;
  label: string;
};

type ExternalSttModelOption = {
  value: string;
  label: string;
  languages: readonly [ExternalSttLanguageOption, ...ExternalSttLanguageOption[]];
};

type ExternalSttProviderDetails = {
  label: string;
  modelLabel: string;
  automaticLanguageHint?: string;
};

export type ExternalSttProviderDefinition = ExternalSttProviderDetails & (
  | {
      languages: readonly [ExternalSttLanguageOption, ...ExternalSttLanguageOption[]];
      modelOptions?: never;
      defaultModel?: never;
    }
  | {
      languages?: never;
      modelOptions: readonly [ExternalSttModelOption, ...ExternalSttModelOption[]];
      defaultModel: string;
    }
);

export const EXTERNAL_STT_PROVIDERS = {
  elevenlabs: {
    label: "ElevenLabs",
    modelLabel: "Scribe v2",
    languages: ELEVENLABS_SCRIBE_LANGUAGES
  },
  assemblyai: {
    label: "AssemblyAI",
    modelLabel: "Universal 3.5 Pro",
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

type OptionValue<Options> = Options extends readonly {
  value: infer Value extends string;
}[] ? Value : never;

type ModelLanguageValue<Options> = Options extends readonly {
  languages: infer Languages;
}[] ? OptionValue<Languages> : never;

type LanguageValue<Definition> = Definition extends {
  modelOptions: infer Options;
}
  ? ModelLanguageValue<Options>
  : Definition extends {
      languages: infer Options;
    }
    ? OptionValue<Options>
    : never;

export type ExternalSttLanguageForProvider<Provider extends SttProvider> =
  Provider extends SttProvider
    ? LanguageValue<typeof EXTERNAL_STT_PROVIDERS[Provider]>
    : never;

export type ExternalSttLanguage = {
  [Provider in SttProvider]: ExternalSttLanguageForProvider<Provider>;
}[SttProvider];
export type ExternalSttModelForProvider<Provider extends SttProvider> =
  Provider extends SttProvider
    ? typeof EXTERNAL_STT_PROVIDERS[Provider] extends {
        modelOptions: infer Options;
      }
      ? OptionValue<Options>
      : never
    : never;
export type ExternalSttModel = {
  [Provider in SttProvider]: ExternalSttModelForProvider<Provider>;
}[SttProvider];

export const EXTERNAL_STT_PROVIDER_OPTIONS = Object.entries(
  EXTERNAL_STT_PROVIDERS
).map(([value, config]) => ({
  value: value as SttProvider,
  ...config
}));

export function isSttProvider(provider: string): provider is SttProvider {
  return provider in EXTERNAL_STT_PROVIDERS;
}

export function getExternalSttProviderConfig<Provider extends SttProvider>(provider: Provider) {
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

export function getExternalSttLanguageCodes<Provider extends SttProvider>(
  provider: Provider,
  model?: string
) {
  return getExternalSttLanguageOptions(provider, model).map(
    ({ value }) => value
  ) as [
    ExternalSttLanguageForProvider<Provider>,
    ...ExternalSttLanguageForProvider<Provider>[]
  ];
}

export function getExternalSttDefaultModel(provider: SttProvider) {
  const config: ExternalSttProviderDefinition = EXTERNAL_STT_PROVIDERS[provider];
  return config.defaultModel as ExternalSttModel | undefined;
}

export function isExternalSttModelForProvider<Provider extends SttProvider>(
  provider: Provider,
  model: unknown
): model is ExternalSttModelForProvider<Provider> {
  if (typeof model !== "string") return false;
  const config: ExternalSttProviderDefinition = EXTERNAL_STT_PROVIDERS[provider];
  return config.modelOptions?.some((option) => option.value === model) ?? false;
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
