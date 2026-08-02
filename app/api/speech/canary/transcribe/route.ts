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
import {
  isRecordedSpeechAudioError,
  readBoundedFloat32Audio
} from "@/lib/speech/raw-audio";
import { getSettingsForUser } from "@/lib/settings";

export const runtime = "nodejs";

const languageSchema = z.enum(["en", "fr", "es"]);

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
    const samples = await readBoundedFloat32Audio(request, MAX_CANARY_AUDIO_BYTES);
    const transcript = await runCanaryTranscription({
      userId: user.id,
      execute: () => transcribeWithCanary(samples, language.data)
    });
    return ok({ model: CANARY_MODEL_NAME, transcript });
  } catch (error) {
    if (error instanceof CanaryTranscriptionBusyError) {
      return badRequest(error.message, 429);
    }
    if (isRecordedSpeechAudioError(error)) {
      return badRequest(error.message);
    }

    console.error(`[speech] ${CANARY_MODEL_NAME} transcription failed:`, error);
    return badRequest(`${CANARY_MODEL_NAME} transcription failed.`, 500);
  }
}
