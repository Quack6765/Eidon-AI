import {
  isAssemblyAiModelId,
  type AssemblyAiLanguage,
  type AssemblyAiModelId
} from "@/lib/speech/assemblyai-languages";
import { RECORDED_SPEECH_SAMPLE_RATE } from "@/lib/speech/recording-constants";
import { encodeFloat32ToWav } from "@/lib/speech/raw-audio";

export const ASSEMBLYAI_API_BASE_URL = "https://api.assemblyai.com";
export const ASSEMBLYAI_POLL_INTERVAL_MS = 1_000;
export const ASSEMBLYAI_TRANSCRIPTION_TIMEOUT_MS = 120_000;

export class AssemblyAiTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AssemblyAiTranscriptionError";
  }
}

type AssemblyAiTranscriptionInput = {
  apiKey: string;
  samples: Float32Array;
  model: AssemblyAiModelId;
  language: AssemblyAiLanguage;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
};

function cancelledError() {
  return new AssemblyAiTranscriptionError("AssemblyAI transcription was cancelled.", 499);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function wait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(cancelledError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestError(status: number, phase: "upload" | "submit" | "poll") {
  if (status === 401 || status === 403) {
    return new AssemblyAiTranscriptionError(
      "AssemblyAI rejected the API key. Check it in Speech-to-Text settings.",
      502
    );
  }
  if (status === 429) {
    return new AssemblyAiTranscriptionError(
      "AssemblyAI transcription is temporarily rate limited. Try again in a moment.",
      429
    );
  }
  if (phase === "submit" && (status === 400 || status === 422)) {
    return new AssemblyAiTranscriptionError(
      "AssemblyAI rejected the transcription request. Check the selected model, language, and account balance.",
      502
    );
  }
  return new AssemblyAiTranscriptionError("AssemblyAI transcription failed.", 502);
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  phase: "upload" | "submit" | "poll",
  signal?: AbortSignal
) {
  if (signal?.aborted) throw cancelledError();
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      throw cancelledError();
    }
    throw new AssemblyAiTranscriptionError("AssemblyAI is temporarily unavailable.", 502);
  }
  if (signal?.aborted) throw cancelledError();
  if (!response.ok) throw requestError(response.status, phase);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw cancelledError();
    payload = null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AssemblyAiTranscriptionError(
      "AssemblyAI returned an invalid transcription response.",
      502
    );
  }
  return payload as Record<string, unknown>;
}

export async function transcribeWithAssemblyAi(input: AssemblyAiTranscriptionInput) {
  const fetcher = input.fetcher ?? fetch;
  const upload = await fetchJson(fetcher, `${ASSEMBLYAI_API_BASE_URL}/v2/upload`, {
    method: "POST",
    headers: {
      Authorization: input.apiKey,
      "Content-Type": "application/octet-stream"
    },
    body: encodeFloat32ToWav(input.samples, RECORDED_SPEECH_SAMPLE_RATE)
  }, "upload", input.signal);
  if (typeof upload.upload_url !== "string" || !upload.upload_url) {
    throw new AssemblyAiTranscriptionError(
      "AssemblyAI returned an invalid upload response.",
      502
    );
  }

  const transcriptRequest = await fetchJson(fetcher, `${ASSEMBLYAI_API_BASE_URL}/v2/transcript`, {
    method: "POST",
    headers: {
      Authorization: input.apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      audio_url: upload.upload_url,
      speech_models: [input.model],
      ...(input.language === "auto"
        ? { language_detection: true }
        : { language_code: input.language })
    })
  }, "submit", input.signal);
  if (typeof transcriptRequest.id !== "string" || !transcriptRequest.id) {
    throw new AssemblyAiTranscriptionError(
      "AssemblyAI returned an invalid transcription response.",
      502
    );
  }

  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? wait;
  const pollIntervalMs = input.pollIntervalMs ?? ASSEMBLYAI_POLL_INTERVAL_MS;
  const deadline = now() + (input.timeoutMs ?? ASSEMBLYAI_TRANSCRIPTION_TIMEOUT_MS);
  const transcriptUrl = `${ASSEMBLYAI_API_BASE_URL}/v2/transcript/${encodeURIComponent(transcriptRequest.id)}`;

  while (now() < deadline) {
    const transcript = await fetchJson(fetcher, transcriptUrl, {
      headers: { Authorization: input.apiKey }
    }, "poll", input.signal);
    if (transcript.status === "completed") {
      if (
        typeof transcript.text !== "string" ||
        !isAssemblyAiModelId(transcript.speech_model_used)
      ) {
        throw new AssemblyAiTranscriptionError(
          "AssemblyAI returned an invalid transcription response.",
          502
        );
      }
      return {
        model: transcript.speech_model_used as AssemblyAiModelId,
        transcript: transcript.text.trim()
      };
    }
    if (transcript.status === "error") {
      throw new AssemblyAiTranscriptionError(
        "AssemblyAI could not transcribe this recording.",
        502
      );
    }
    if (transcript.status !== "queued" && transcript.status !== "processing") {
      throw new AssemblyAiTranscriptionError(
        "AssemblyAI returned an invalid transcription response.",
        502
      );
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())), input.signal);
  }

  throw new AssemblyAiTranscriptionError(
    "AssemblyAI transcription timed out. Try a shorter recording or try again.",
    504
  );
}
