import {
  TRANSCRIPTION_PROVIDER_CATALOG,
  isTranscriptionProviderId,
  type SttEngine
} from "@/lib/speech/transcription-catalog";

export type { SttEngine } from "@/lib/speech/transcription-catalog";

export type SttLanguage = "auto" | "en" | "fr" | "es";

export function getSpeechInputSettings(input: {
  providerId: string;
  configuration: { language?: string };
}) {
  const providerId = isTranscriptionProviderId(input.providerId)
    ? input.providerId
    : "browser";
  const engine: SttEngine = TRANSCRIPTION_PROVIDER_CATALOG[providerId].engine;
  const value = input.configuration.language;
  const language: SttLanguage = value === "en" || value === "fr" || value === "es"
    ? value
    : "auto";
  return { engine, language };
}

export type SpeechPhase =
  | "idle"
  | "requesting-permission"
  | "listening"
  | "transcribing"
  | "error"
  | "unsupported";

export type SpeechSessionSnapshot = {
  phase: SpeechPhase;
  engine: SttEngine;
  language: SttLanguage;
  level: number;
  error: string | null;
};

export type SpeechSessionResult = {
  transcript: string;
};

export type SpeechAudioRecording = {
  sampleRate: number;
  samples: Float32Array;
};

export type SpeechAudioRecorder = {
  start(): void;
  stop(): Promise<SpeechAudioRecording>;
  dispose(): void;
};

export type SpeechEngineStartInput = {
  language: SttLanguage;
  audioRecorder?: SpeechAudioRecorder | null;
};

export interface SpeechEngine {
  isSupported(): boolean;
  start(input: SpeechEngineStartInput): Promise<void>;
  stop(): Promise<SpeechSessionResult>;
  dispose(): void;
}
