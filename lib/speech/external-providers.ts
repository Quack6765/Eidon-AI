import { ELEVENLABS_SCRIBE_LANGUAGES } from "@/lib/speech/elevenlabs-languages";

type ExternalSttLanguageOption = {
  value: string;
  label: string;
};

type ExternalSttProviderDefinition = {
  label: string;
  modelLabel: string;
  languages: readonly ExternalSttLanguageOption[];
};

export const EXTERNAL_STT_PROVIDERS = {
  elevenlabs: {
    label: "ElevenLabs",
    modelLabel: "Scribe v2",
    languages: ELEVENLABS_SCRIBE_LANGUAGES
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

export function isExternalSttLanguageForProvider(
  provider: SttProvider,
  language: ExternalSttLanguage
) {
  const languages: readonly ExternalSttLanguageOption[] =
    EXTERNAL_STT_PROVIDERS[provider].languages;
  return languages.some(
    (option) => option.value === language
  );
}
