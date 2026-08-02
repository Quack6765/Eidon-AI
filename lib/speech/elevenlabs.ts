import type { ElevenLabsScribeLanguage } from "@/lib/speech/elevenlabs-languages";

export const ELEVENLABS_SCRIBE_MODEL = "scribe_v2";
export const ELEVENLABS_SPEECH_TO_TEXT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export class ElevenLabsTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ElevenLabsTranscriptionError";
  }
}

export function convertFloat32ToPcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(buffer);

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * 32768 : clamped * 32767;
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, Math.round(value), true);
  });

  return buffer;
}

export async function transcribeWithElevenLabs(input: {
  apiKey: string;
  samples: Float32Array;
  language: ElevenLabsScribeLanguage;
  fetcher?: typeof fetch;
}) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([convertFloat32ToPcm16(input.samples)], { type: "application/octet-stream" }),
    "recording.pcm"
  );
  form.append("model_id", ELEVENLABS_SCRIBE_MODEL);
  form.append("file_format", "pcm_s16le_16");
  form.append("tag_audio_events", "false");
  form.append("timestamps_granularity", "none");
  if (input.language !== "auto") {
    form.append("language_code", input.language);
  }

  const response = await (input.fetcher ?? fetch)(ELEVENLABS_SPEECH_TO_TEXT_URL, {
    method: "POST",
    headers: { "xi-api-key": input.apiKey },
    body: form
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ElevenLabsTranscriptionError(
        "ElevenLabs rejected the API key. Check it in Speech-to-Text settings.",
        502
      );
    }
    if (response.status === 429) {
      throw new ElevenLabsTranscriptionError(
        "ElevenLabs transcription is temporarily rate limited. Try again in a moment.",
        429
      );
    }
    throw new ElevenLabsTranscriptionError("ElevenLabs transcription failed.", 502);
  }

  const payload = await response.json().catch(() => null) as { text?: unknown } | null;
  if (typeof payload?.text !== "string") {
    throw new ElevenLabsTranscriptionError(
      "ElevenLabs returned an invalid transcription response.",
      502
    );
  }

  return payload.text.trim();
}
