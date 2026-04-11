import type { SttLanguage } from "@/lib/speech/types";

const LOCALE_BY_LANGUAGE: Record<SttLanguage, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES"
};

export function resolveSpeechLocale(language: SttLanguage) {
  return LOCALE_BY_LANGUAGE[language];
}
