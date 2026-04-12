import type { SttLanguage } from "@/lib/speech/types";

const LOCALE_BY_LANGUAGE: Record<Exclude<SttLanguage, "auto">, string> = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES"
};

export function resolveSpeechLocale(language: SttLanguage) {
  if (language === "auto") {
    return null;
  }

  return LOCALE_BY_LANGUAGE[language];
}
