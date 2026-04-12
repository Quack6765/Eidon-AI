import type {
  SpeechEngine,
  SpeechEngineStartInput,
  SpeechSessionResult
} from "@/lib/speech/types";

export class EmbeddedSpeechEngine implements SpeechEngine {
  isSupported() {
    return false;
  }

  async start(_input: SpeechEngineStartInput) {
    throw new Error("Embedded speech recognition is not available on this device.");
  }

  async stop(): Promise<SpeechSessionResult> {
    return { transcript: "" };
  }

  dispose() {}
}
