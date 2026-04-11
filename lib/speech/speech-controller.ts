import type { SttEngine, SttLanguage } from "@/lib/types";
import type {
  SpeechEngine,
  SpeechSessionResult,
  SpeechSessionSnapshot
} from "@/lib/speech/types";

export function createSpeechController(input: {
  engine: SpeechEngine;
  audioMonitor: { readLevel(): number; dispose(): void };
}) {
  let snapshot: SpeechSessionSnapshot = {
    phase: "idle",
    engine: "browser",
    language: "en",
    level: 0,
    error: null
  };

  return {
    getSnapshot() {
      return {
        ...snapshot,
        level: snapshot.phase === "listening" ? input.audioMonitor.readLevel() : 0
      };
    },
    async start(settings: { engine: SttEngine; language: SttLanguage }) {
      if (!input.engine.isSupported()) {
        snapshot = {
          ...snapshot,
          phase: "unsupported",
          engine: settings.engine,
          language: settings.language,
          error: "Selected speech engine is unavailable."
        };
        throw new Error("Selected speech engine is unavailable.");
      }

      snapshot = {
        ...snapshot,
        phase: "requesting-permission",
        engine: settings.engine,
        language: settings.language,
        error: null
      };
      await input.engine.start({ language: settings.language });
      snapshot = {
        ...snapshot,
        phase: "listening",
        engine: settings.engine,
        language: settings.language,
        error: null
      };
    },
    async stop(): Promise<SpeechSessionResult> {
      snapshot = { ...snapshot, phase: "transcribing" };

      try {
        const result = await input.engine.stop();
        snapshot = { ...snapshot, phase: "idle", level: 0, error: null };
        return result;
      } catch (error) {
        snapshot = {
          ...snapshot,
          phase: "error",
          level: 0,
          error: error instanceof Error ? error.message : "Speech transcription failed."
        };
        throw error;
      }
    },
    dispose() {
      input.engine.dispose();
      input.audioMonitor.dispose();
    }
  };
}
