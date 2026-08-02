import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import {
  getExternalSttProviderConfig,
  isSttProvider
} from "@/lib/speech/external-providers";
import {
  isExternalSttProviderError,
  transcribeWithExternalSttProvider
} from "@/lib/speech/external-transcription";
import {
  isRecordedSpeechAudioError,
  readBoundedFloat32Audio
} from "@/lib/speech/raw-audio";
import {
  MAX_RECORDED_SPEECH_AUDIO_BYTES,
  RECORDED_SPEECH_SAMPLE_RATE
} from "@/lib/speech/recording-constants";
import { getSettingsForUser } from "@/lib/settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser(false);
  if (!user) {
    return badRequest("Authentication required", 401);
  }

  const settings = getSettingsForUser(user.id);
  if (settings.sttEngine !== "external") {
    return badRequest("Select External before using provider speech recognition.", 409);
  }
  if (!isSttProvider(settings.sttProvider)) {
    return badRequest("Selected speech-to-text provider is unavailable.", 409);
  }
  const provider = getExternalSttProviderConfig(settings.sttProvider);
  if (!settings.externalSttApiKey) {
    return badRequest(`Add your ${provider.label} API key in Speech-to-Text settings.`, 409);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/octet-stream") {
    return badRequest("External transcription requires raw Float32 audio.");
  }
  if (request.headers.get("x-audio-sample-rate") !== String(RECORDED_SPEECH_SAMPLE_RATE)) {
    return badRequest(`External transcription requires ${RECORDED_SPEECH_SAMPLE_RATE} Hz audio.`);
  }

  try {
    const samples = await readBoundedFloat32Audio(request, MAX_RECORDED_SPEECH_AUDIO_BYTES);
    const result = await transcribeWithExternalSttProvider({
      provider: settings.sttProvider,
      apiKey: settings.externalSttApiKey,
      samples,
      language: settings.externalSttLanguage
    });
    return ok({
      model: result.model,
      provider: settings.sttProvider,
      transcript: result.transcript
    });
  } catch (error) {
    if (isRecordedSpeechAudioError(error) || isExternalSttProviderError(error)) {
      return badRequest(error.message, isExternalSttProviderError(error) ? error.status : 400);
    }

    console.error(`[speech] ${settings.sttProvider} transcription failed:`, error);
    return badRequest("External transcription failed.", 500);
  }
}
