import { useCallback, type Dispatch, SetStateAction } from "react";

import { appendTranscriptToDraft } from "@/lib/speech/append-transcript-to-draft";
import { getSpeechInputSettings } from "@/lib/speech/types";
import { useSpeechInput } from "@/lib/speech/use-speech-input";
import type { AppSettings } from "@/lib/types";

export function useComposerSpeech(input: {
  selection: AppSettings["speechTranscription"];
  cleanupEnabled: boolean;
  setDraft: Dispatch<SetStateAction<string>>;
  clearError: () => void;
  resetKey?: string;
}) {
  const settings = getSpeechInputSettings(input.selection);
  const cleanupTranscript = useCallback(async (transcript: string) => {
    const response = await fetch("/api/speech/transcription/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript })
    });
    if (!response.ok) {
      throw new Error("AI cleanup failed.");
    }
    const payload = await response.json() as { text?: unknown };
    if (typeof payload.text !== "string") {
      throw new Error("AI cleanup returned an invalid response.");
    }
    return payload.text;
  }, []);
  const { speechSnapshot, startSpeech, stopSpeech } = useSpeechInput({
    engine: settings.engine,
    initialLanguage: settings.language,
    resetKey: input.resetKey,
    cleanup: input.cleanupEnabled ? cleanupTranscript : undefined
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
