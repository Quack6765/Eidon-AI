import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getSettingsForUser } from "@/lib/settings";
import { CanaryTranscriptionBusyError } from "@/lib/speech/canary-transcription-limiter";
import { isExternalSttProviderError } from "@/lib/speech/external-transcription";
import { isRecordedSpeechAudioError, readBoundedFloat32Audio } from "@/lib/speech/raw-audio";
import { getServerTranscriptionProvider } from "@/lib/speech/transcription-providers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser(false);
  if (!user) return badRequest("Authentication required", 401);
  const settings = getSettingsForUser(user.id);
  const provider = getServerTranscriptionProvider(settings);
  if (!provider) return badRequest("Select a server transcription provider first.", 409);
  const readinessError = provider.readinessError(settings);
  if (readinessError) return badRequest(readinessError, 409);
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/octet-stream") {
    return badRequest("Transcription requires raw Float32 audio.");
  }
  if (request.headers.get("x-audio-sample-rate") !== String(provider.sampleRate)) {
    return badRequest(`Transcription requires ${provider.sampleRate} Hz audio.`);
  }
  try {
    const samples = await readBoundedFloat32Audio(request, provider.maxAudioBytes);
    return ok(await provider.transcribe({ samples, settings, userId: user.id }));
  } catch (error) {
    if (error instanceof CanaryTranscriptionBusyError) return badRequest(error.message, 429);
    if (isExternalSttProviderError(error)) return badRequest(error.message, error.status);
    if (isRecordedSpeechAudioError(error)) return badRequest(error.message, 400);
    console.error("[speech] Provider transcription failed:", error);
    return badRequest("Speech transcription failed.", 500);
  }
}
