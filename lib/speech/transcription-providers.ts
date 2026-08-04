import {
  CANARY_MODEL_NAME,
  CANARY_SAMPLE_RATE,
  MAX_CANARY_AUDIO_BYTES,
  ensureCanaryModelReady,
  transcribeWithCanary
} from "@/lib/speech/canary-model";
import {
  runCanaryTranscription
} from "@/lib/speech/canary-transcription-limiter";
import type {
  AssemblyAiLanguage,
  AssemblyAiModelId
} from "@/lib/speech/assemblyai-languages";
import {
  transcribeWithExternalSttProvider
} from "@/lib/speech/external-transcription";
import type { ExternalSttLanguageForProvider } from "@/lib/speech/external-providers";
import {
  MAX_RECORDED_SPEECH_AUDIO_BYTES,
  RECORDED_SPEECH_SAMPLE_RATE
} from "@/lib/speech/recording-constants";
import type { RuntimeAppSettings } from "@/lib/types";
import {
  getTranscriptionReadinessError,
  type TranscriptionProviderId
} from "@/lib/speech/transcription-catalog";

export interface TranscriptionProvider {
  sampleRate: number;
  maxAudioBytes: number;
  getReadinessError(settings: RuntimeAppSettings): string | null;
  prepare?(): Promise<void>;
  transcribe(input: {
    samples: Float32Array;
    settings: RuntimeAppSettings;
    userId: string;
    signal?: AbortSignal;
  }): Promise<{ model: string; provider: string; transcript: string }>;
}

const TRANSCRIPTION_PROVIDERS = {
  canary: {
    sampleRate: CANARY_SAMPLE_RATE,
    maxAudioBytes: MAX_CANARY_AUDIO_BYTES,
    getReadinessError(settings) {
      return getTranscriptionReadinessError(settings.speechTranscription);
    },
    async prepare() {
      await ensureCanaryModelReady();
    },
    async transcribe({ samples, settings, userId }) {
      const language = settings.speechTranscription.configuration.language;
      if (language === "auto") {
        throw new Error("Canary transcription requires English, French, or Spanish.");
      }
      const transcript = await runCanaryTranscription({
        userId,
        execute: () => transcribeWithCanary(samples, language as "en" | "fr" | "es")
      });
      return { model: CANARY_MODEL_NAME, provider: "canary", transcript };
    }
  },
  elevenlabs: {
    sampleRate: RECORDED_SPEECH_SAMPLE_RATE,
    maxAudioBytes: MAX_RECORDED_SPEECH_AUDIO_BYTES,
    getReadinessError(settings) {
      return getTranscriptionReadinessError(settings.speechTranscription);
    },
    async transcribe({ samples, settings, signal }) {
      const result = await transcribeWithExternalSttProvider({
        provider: "elevenlabs",
        apiKey: settings.speechTranscription.credentials.apiKey ?? "",
        samples,
        language: settings.speechTranscription.configuration.language as
          ExternalSttLanguageForProvider<"elevenlabs">,
        signal
      });
      return { model: result.model, provider: "elevenlabs", transcript: result.transcript };
    }
  },
  assemblyai: {
    sampleRate: RECORDED_SPEECH_SAMPLE_RATE,
    maxAudioBytes: MAX_RECORDED_SPEECH_AUDIO_BYTES,
    getReadinessError(settings) {
      return getTranscriptionReadinessError(settings.speechTranscription);
    },
    async transcribe({ samples, settings, signal }) {
      const result = await transcribeWithExternalSttProvider({
        provider: "assemblyai",
        apiKey: settings.speechTranscription.credentials.apiKey ?? "",
        samples,
        language: settings.speechTranscription.configuration.language as AssemblyAiLanguage,
        model: settings.speechTranscription.configuration.model as AssemblyAiModelId,
        signal
      });
      return { model: result.model, provider: "assemblyai", transcript: result.transcript };
    }
  }
} satisfies Record<Exclude<TranscriptionProviderId, "browser">, TranscriptionProvider>;

export function getServerTranscriptionProvider(
  settings: RuntimeAppSettings
): TranscriptionProvider | null {
  const providerId = settings.speechTranscription.providerId;
  return providerId === "browser" ? null : TRANSCRIPTION_PROVIDERS[providerId];
}
