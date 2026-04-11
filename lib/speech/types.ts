export type SttEngine = "browser" | "embedded";

export type SttLanguage = "en" | "fr" | "es";

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

export type SpeechEngineStartInput = {
  language: SttLanguage;
};

export interface SpeechEngine {
  isSupported(): boolean;
  start(input: SpeechEngineStartInput): Promise<void>;
  stop(): Promise<SpeechSessionResult>;
  dispose(): void;
}
