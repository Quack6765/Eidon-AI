import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  CANARY_MODEL_NAME,
  CANARY_SAMPLE_RATE,
  MAX_CANARY_AUDIO_BYTES,
  transcribeWithCanary
} from "@/lib/speech/canary-model";
import {
  CanaryTranscriptionBusyError,
  runCanaryTranscription
} from "@/lib/speech/canary-transcription-limiter";
import { getSettingsForUser } from "@/lib/settings";

export const runtime = "nodejs";

const languageSchema = z.enum(["en", "fr", "es"]);

async function readBoundedAudio(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CANARY_AUDIO_BYTES) {
    throw new Error("Audio recording is too long.");
  }
  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_CANARY_AUDIO_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("Audio recording is too long.");
    }
    chunks.push(value);
  }

  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

function parseAudioSamples(audio: Uint8Array) {
  if (audio.byteLength === 0 || audio.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Invalid audio recording.");
  }

  const samples = new Float32Array(
    audio.buffer,
    audio.byteOffset,
    audio.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  for (const sample of samples) {
    if (!Number.isFinite(sample) || sample < -1 || sample > 1) {
      throw new Error("Invalid audio samples.");
    }
  }
  return samples;
}

export async function POST(request: Request) {
  const user = await requireUser(false);
  if (!user) {
    return badRequest("Authentication required", 401);
  }

  if (getSettingsForUser(user.id).sttEngine !== "embedded") {
    return badRequest("Select Embedded model before using Canary speech recognition.", 409);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/octet-stream") {
    return badRequest("Canary transcription requires raw Float32 audio.");
  }

  if (request.headers.get("x-audio-sample-rate") !== String(CANARY_SAMPLE_RATE)) {
    return badRequest(`Canary transcription requires ${CANARY_SAMPLE_RATE} Hz audio.`);
  }

  const language = languageSchema.safeParse(request.headers.get("x-speech-language"));
  if (!language.success) {
    return badRequest("Canary transcription requires English, French, or Spanish.");
  }

  try {
    const audio = await readBoundedAudio(request);
    const samples = parseAudioSamples(audio);
    const transcript = await runCanaryTranscription({
      userId: user.id,
      execute: () => transcribeWithCanary(samples, language.data)
    });
    return ok({ model: CANARY_MODEL_NAME, transcript });
  } catch (error) {
    if (error instanceof CanaryTranscriptionBusyError) {
      return badRequest(error.message, 429);
    }
    if (error instanceof Error && [
      "Audio recording is too long.",
      "Invalid audio recording.",
      "Invalid audio samples."
    ].includes(error.message)) {
      return badRequest(error.message);
    }

    console.error(`[speech] ${CANARY_MODEL_NAME} transcription failed:`, error);
    return badRequest(`${CANARY_MODEL_NAME} transcription failed.`, 500);
  }
}
