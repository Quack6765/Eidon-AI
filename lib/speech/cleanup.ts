import { callProviderText } from "@/lib/provider";
import { getRuntimeProviderProfile } from "@/lib/provider-profiles";
import { getSettings } from "@/lib/settings";
import { DEFAULT_SPEECH_CLEANUP_PROMPT } from "@/lib/speech/cleanup-prompt";

export class SpeechCleanupUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechCleanupUnavailableError";
  }
}

export function isSpeechCleanupUnavailableError(error: unknown): error is SpeechCleanupUnavailableError {
  return error instanceof SpeechCleanupUnavailableError;
}

export function buildSpeechCleanupPrompt(systemPrompt: string, transcript: string) {
  return `${systemPrompt}\n\nRaw transcript to clean:\n${transcript}`;
}

export async function cleanSpeechTranscript(input: {
  transcript: string;
  signal?: AbortSignal;
}) {
  const settings = getSettings();
  if (!settings.speechCleanupEnabled) {
    throw new SpeechCleanupUnavailableError("AI post-cleanup is disabled.");
  }
  const profile = settings.speechCleanupProfileId
    ? getRuntimeProviderProfile(settings.speechCleanupProfileId)
    : null;
  if (!profile) {
    throw new SpeechCleanupUnavailableError(
      "AI post-cleanup provider profile is unavailable. Select a provider profile in settings."
    );
  }
  const systemPrompt = settings.speechCleanupPrompt.trim() || DEFAULT_SPEECH_CLEANUP_PROMPT;
  const text = await callProviderText({
    settings: profile,
    prompt: buildSpeechCleanupPrompt(systemPrompt, input.transcript),
    purpose: "speech_cleanup",
    abortSignal: input.signal
  });
  return { text: text.trim(), model: profile.model, provider: profile.name };
}
