import type { SttEngine } from "@/lib/types";
import { BrowserSpeechEngine } from "@/lib/speech/engines/browser-speech-engine";
import { EmbeddedSpeechEngine } from "@/lib/speech/engines/embedded-speech-engine";
import type { SpeechEngine } from "@/lib/speech/types";

export function createSpeechEngine(engine: SttEngine): SpeechEngine {
  return engine === "embedded" ? new EmbeddedSpeechEngine() : new BrowserSpeechEngine();
}
