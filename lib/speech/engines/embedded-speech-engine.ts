import type {
  SpeechAudioRecorder,
  SpeechEngine,
  SpeechEngineStartInput,
  SpeechSessionResult,
  SttLanguage
} from "@/lib/speech/types";

function getEmbeddedAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null;
}

function readEmbeddedSpeechError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim()
  ) {
    return payload.error;
  }

  return fallback;
}

async function readErrorResponse(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null);
  return new Error(readEmbeddedSpeechError(payload, fallback));
}

function resolveCanaryLanguage(language: SttLanguage) {
  if (language === "auto") {
    throw new Error("Choose English, French, or Spanish for Canary transcription.");
  }

  return language;
}

export class EmbeddedSpeechEngine implements SpeechEngine {
  private audioRecorder: SpeechAudioRecorder | null = null;
  private abortController: AbortController | null = null;
  private language: Exclude<SttLanguage, "auto"> = "en";
  private preparation: Promise<Error | null> | null = null;

  isSupported() {
    const AudioContextCtor = getEmbeddedAudioContextConstructor();
    return Boolean(
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      AudioContextCtor?.prototype.createScriptProcessor
    );
  }

  async start(input: SpeechEngineStartInput) {
    if (!input.audioRecorder) {
      throw new Error("Embedded audio capture is unavailable in this browser.");
    }

    this.language = resolveCanaryLanguage(input.language);
    this.audioRecorder = input.audioRecorder;
    this.abortController = new AbortController();
    this.audioRecorder.start();
    this.preparation = this.prepareModel(this.abortController.signal).then(
      () => null,
      (error) => error instanceof Error ? error : new Error("Unable to prepare Canary 180M Flash.")
    );
  }

  async stop(): Promise<SpeechSessionResult> {
    if (!this.audioRecorder) {
      return { transcript: "" };
    }

    const recording = await this.audioRecorder.stop();
    if (recording.samples.length === 0) {
      throw new Error("No microphone audio was captured.");
    }

    const preparationError = await this.preparation;
    if (preparationError) {
      throw preparationError;
    }

    const audioBytes = new ArrayBuffer(recording.samples.byteLength);
    new Uint8Array(audioBytes).set(new Uint8Array(
      recording.samples.buffer,
      recording.samples.byteOffset,
      recording.samples.byteLength
    ));
    const response = await fetch("/api/speech/canary/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Audio-Sample-Rate": String(recording.sampleRate),
        "X-Speech-Language": this.language
      },
      body: audioBytes,
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      throw await readErrorResponse(response, "Canary transcription failed.");
    }

    const payload = await response.json() as { transcript?: unknown };
    if (typeof payload.transcript !== "string") {
      throw new Error("Canary returned an invalid transcription response.");
    }

    return { transcript: payload.transcript.trim() };
  }

  dispose() {
    this.abortController?.abort();
    this.audioRecorder?.dispose();
    this.audioRecorder = null;
    this.abortController = null;
    this.preparation = null;
  }

  private async prepareModel(signal: AbortSignal) {
    const response = await fetch("/api/speech/canary/prepare", {
      method: "POST",
      signal
    });

    if (!response.ok) {
      throw await readErrorResponse(response, "Unable to prepare Canary 180M Flash.");
    }
  }
}
