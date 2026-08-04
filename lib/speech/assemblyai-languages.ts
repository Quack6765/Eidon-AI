export const ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES = [
  { value: "auto", label: "Automatic" },
  { value: "ar", label: "Arabic" },
  { value: "zh", label: "Chinese" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "no", label: "Norwegian" },
  { value: "pt", label: "Portuguese" },
  { value: "es", label: "Spanish" },
  { value: "sv", label: "Swedish" },
  { value: "tr", label: "Turkish" },
  { value: "vi", label: "Vietnamese" }
] as const;

export const ASSEMBLYAI_UNIVERSAL_2_LANGUAGES = [
  { value: "auto", label: "Automatic" },
  { value: "af", label: "Afrikaans" },
  { value: "sq", label: "Albanian" },
  { value: "am", label: "Amharic" },
  { value: "ar", label: "Arabic" },
  { value: "hy", label: "Armenian" },
  { value: "as", label: "Assamese" },
  { value: "az", label: "Azerbaijani" },
  { value: "ba", label: "Bashkir" },
  { value: "eu", label: "Basque" },
  { value: "be", label: "Belarusian" },
  { value: "bn", label: "Bengali" },
  { value: "bs", label: "Bosnian" },
  { value: "br", label: "Breton" },
  { value: "bg", label: "Bulgarian" },
  { value: "my", label: "Burmese" },
  { value: "ca", label: "Catalan" },
  { value: "zh", label: "Chinese" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "en_au", label: "English (Australia)" },
  { value: "en_uk", label: "English (United Kingdom)" },
  { value: "en_us", label: "English (United States)" },
  { value: "et", label: "Estonian" },
  { value: "fo", label: "Faroese" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "gl", label: "Galician" },
  { value: "ka", label: "Georgian" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "gu", label: "Gujarati" },
  { value: "ht", label: "Haitian Creole" },
  { value: "ha", label: "Hausa" },
  { value: "haw", label: "Hawaiian" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "is", label: "Icelandic" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "jw", label: "Javanese" },
  { value: "kn", label: "Kannada" },
  { value: "kk", label: "Kazakh" },
  { value: "km", label: "Khmer" },
  { value: "ko", label: "Korean" },
  { value: "lo", label: "Lao" },
  { value: "la", label: "Latin" },
  { value: "lv", label: "Latvian" },
  { value: "ln", label: "Lingala" },
  { value: "lt", label: "Lithuanian" },
  { value: "lb", label: "Luxembourgish" },
  { value: "mk", label: "Macedonian" },
  { value: "mg", label: "Malagasy" },
  { value: "ms", label: "Malay" },
  { value: "ml", label: "Malayalam" },
  { value: "mt", label: "Maltese" },
  { value: "mi", label: "Māori" },
  { value: "mr", label: "Marathi" },
  { value: "mn", label: "Mongolian" },
  { value: "ne", label: "Nepali" },
  { value: "no", label: "Norwegian" },
  { value: "nn", label: "Norwegian Nynorsk" },
  { value: "oc", label: "Occitan" },
  { value: "pa", label: "Panjabi" },
  { value: "ps", label: "Pashto" },
  { value: "fa", label: "Persian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sa", label: "Sanskrit" },
  { value: "sr", label: "Serbian" },
  { value: "sn", label: "Shona" },
  { value: "sd", label: "Sindhi" },
  { value: "si", label: "Sinhala" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "so", label: "Somali" },
  { value: "es", label: "Spanish" },
  { value: "su", label: "Sundanese" },
  { value: "sw", label: "Swahili" },
  { value: "sv", label: "Swedish" },
  { value: "tl", label: "Tagalog" },
  { value: "tg", label: "Tajik" },
  { value: "ta", label: "Tamil" },
  { value: "tt", label: "Tatar" },
  { value: "te", label: "Telugu" },
  { value: "th", label: "Thai" },
  { value: "bo", label: "Tibetan" },
  { value: "tr", label: "Turkish" },
  { value: "tk", label: "Turkmen" },
  { value: "uk", label: "Ukrainian" },
  { value: "ur", label: "Urdu" },
  { value: "uz", label: "Uzbek" },
  { value: "vi", label: "Vietnamese" },
  { value: "cy", label: "Welsh" },
  { value: "yi", label: "Yiddish" },
  { value: "yo", label: "Yoruba" }
] as const;

export type AssemblyAiUniversal35Language =
  typeof ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES[number]["value"];
export type AssemblyAiUniversal2Language =
  typeof ASSEMBLYAI_UNIVERSAL_2_LANGUAGES[number]["value"];
export type AssemblyAiLanguage = AssemblyAiUniversal35Language | AssemblyAiUniversal2Language;

export const ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGE_CODES =
  ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES.map(({ value }) => value) as [
    AssemblyAiUniversal35Language,
    ...AssemblyAiUniversal35Language[]
  ];
export const ASSEMBLYAI_UNIVERSAL_2_LANGUAGE_CODES =
  ASSEMBLYAI_UNIVERSAL_2_LANGUAGES.map(({ value }) => value) as [
    AssemblyAiUniversal2Language,
    ...AssemblyAiUniversal2Language[]
  ];

export const ASSEMBLYAI_MODEL_OPTIONS = [
  {
    value: "universal-3-5-pro",
    label: "Universal 3.5 Pro",
    languages: ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES
  },
  {
    value: "universal-2",
    label: "Universal 2",
    languages: ASSEMBLYAI_UNIVERSAL_2_LANGUAGES
  }
] as const;

export type AssemblyAiModelId = typeof ASSEMBLYAI_MODEL_OPTIONS[number]["value"];

export const ASSEMBLYAI_MODEL_IDS = ASSEMBLYAI_MODEL_OPTIONS.map(
  ({ value }) => value
) as [AssemblyAiModelId, ...AssemblyAiModelId[]];
export const DEFAULT_ASSEMBLYAI_MODEL: AssemblyAiModelId = "universal-3-5-pro";

export function isAssemblyAiModelId(value: unknown): value is AssemblyAiModelId {
  return typeof value === "string" && ASSEMBLYAI_MODEL_IDS.includes(value as AssemblyAiModelId);
}

export function getAssemblyAiLanguages(model: AssemblyAiModelId) {
  return ASSEMBLYAI_MODEL_OPTIONS.find((option) => option.value === model)?.languages ??
    ASSEMBLYAI_UNIVERSAL_3_5_PRO_LANGUAGES;
}
