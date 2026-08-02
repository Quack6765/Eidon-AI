import { BrowserSpeechEngine } from "@/lib/speech/engines/browser-speech-engine";
import { EmbeddedSpeechEngine } from "@/lib/speech/engines/embedded-speech-engine";
import { ExternalSpeechEngine } from "@/lib/speech/engines/external-speech-engine";
import type { SpeechEngine, SttEngine } from "@/lib/speech/types";

export function createSpeechEngine(engine: SttEngine): SpeechEngine {
  if (engine === "embedded") {
    return new EmbeddedSpeechEngine();
  }
  if (engine === "external") {
    return new ExternalSpeechEngine();
  }
  return new BrowserSpeechEngine();
}
