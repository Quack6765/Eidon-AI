import type { Dispatch, SetStateAction } from "react";

import { appendTranscriptToDraft } from "@/lib/speech/append-transcript-to-draft";
import { getSpeechInputSettings } from "@/lib/speech/types";
import { useSpeechInput } from "@/lib/speech/use-speech-input";
import type { AppSettings } from "@/lib/types";

export function useComposerSpeech(input: {
  selection: AppSettings["speechTranscription"];
  setDraft: Dispatch<SetStateAction<string>>;
  clearError: () => void;
  resetKey?: string;
}) {
  const settings = getSpeechInputSettings(input.selection);
  const { speechSnapshot, startSpeech, stopSpeech } = useSpeechInput({
    engine: settings.engine,
    initialLanguage: settings.language,
    resetKey: input.resetKey
  });
  return {
    speechSnapshot,
    onStartSpeech() {
      input.clearError();
      void startSpeech();
    },
    onStopSpeech() {
      void stopSpeech().then((transcript) => {
        if (transcript) {
          input.setDraft((current) => appendTranscriptToDraft(current, transcript));
        }
      });
    }
  };
}
