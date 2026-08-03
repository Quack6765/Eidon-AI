import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { getSettingsForUser } from "@/lib/settings";
import { getServerTranscriptionProvider } from "@/lib/speech/transcription-providers";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireUser(false);
  if (!user) return badRequest("Authentication required", 401);
  const settings = getSettingsForUser(user.id);
  const provider = getServerTranscriptionProvider(settings);
  if (!provider) return badRequest("Select a server transcription provider first.", 409);
  const readinessError = provider.readinessError(settings);
  if (readinessError) return badRequest(readinessError, 409);
  try {
    await provider.prepare?.();
    return ok({ ready: true });
  } catch (error) {
    console.error("[speech] Provider preparation failed:", error);
    return badRequest("Unable to prepare speech transcription.", 503);
  }
}
