import type {
  SpeechAudioRecorder,
  SpeechEngine,
  SpeechEngineStartInput,
  SpeechSessionResult
} from "@/lib/speech/types";

function getAudioContextConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null;
}

async function readErrorResponse(response: Response) {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return new Error(
    typeof payload?.error === "string" && payload.error.trim()
      ? payload.error
      : "External transcription failed."
  );
}

export class ExternalSpeechEngine implements SpeechEngine {
  private audioRecorder: SpeechAudioRecorder | null = null;
  private abortController: AbortController | null = null;

  isSupported() {
    const AudioContextCtor = getAudioContextConstructor();
    return Boolean(
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      AudioContextCtor?.prototype.createScriptProcessor
    );
  }

  async start(input: SpeechEngineStartInput) {
    if (!input.audioRecorder) {
      throw new Error("External audio capture is unavailable in this browser.");
    }

    this.audioRecorder = input.audioRecorder;
    this.abortController = new AbortController();
    this.audioRecorder.start();
  }

  async stop(): Promise<SpeechSessionResult> {
    if (!this.audioRecorder) {
      return { transcript: "" };
    }

    const recording = await this.audioRecorder.stop();
    if (recording.samples.length === 0) {
      throw new Error("No microphone audio was captured.");
    }

    const audioBytes = new ArrayBuffer(recording.samples.byteLength);
    new Uint8Array(audioBytes).set(new Uint8Array(
      recording.samples.buffer,
      recording.samples.byteOffset,
      recording.samples.byteLength
    ));
    const response = await fetch("/api/speech/transcription/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Audio-Sample-Rate": String(recording.sampleRate)
      },
      body: audioBytes,
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      throw await readErrorResponse(response);
    }

    const payload = await response.json() as { transcript?: unknown };
    if (typeof payload.transcript !== "string") {
      throw new Error("External provider returned an invalid transcription response.");
    }

    return { transcript: payload.transcript.trim() };
  }

  dispose() {
    this.abortController?.abort();
    this.audioRecorder?.dispose();
    this.audioRecorder = null;
    this.abortController = null;
  }
}
