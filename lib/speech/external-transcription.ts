import { transcribeWithAssemblyAi } from "@/lib/speech/assemblyai";
import {
  ELEVENLABS_SCRIBE_MODEL,
  transcribeWithElevenLabs
} from "@/lib/speech/elevenlabs";
import {
  SONIOX_REALTIME_MODEL,
  transcribeWithSoniox
} from "@/lib/speech/soniox";
import type {
  ExternalSttLanguageForProvider,
  ExternalSttModelForProvider
} from "@/lib/speech/external-providers";

type ExternalSttTranscriptionInput =
  | {
      provider: "elevenlabs";
      apiKey: string;
      samples: Float32Array;
      language: ExternalSttLanguageForProvider<"elevenlabs">;
      signal?: AbortSignal;
    }
  | {
      provider: "assemblyai";
      apiKey: string;
      samples: Float32Array;
      language: ExternalSttLanguageForProvider<"assemblyai">;
      model: ExternalSttModelForProvider<"assemblyai">;
      signal?: AbortSignal;
    }
  | {
      provider: "soniox";
      apiKey: string;
      samples: Float32Array;
      language: ExternalSttLanguageForProvider<"soniox">;
      signal?: AbortSignal;
    };

function assertNever(_value: never): never {
  throw new Error("Unsupported external speech-to-text provider.");
}

export async function transcribeWithExternalSttProvider(
  input: ExternalSttTranscriptionInput
) {
  switch (input.provider) {
    case "elevenlabs":
      return {
        model: ELEVENLABS_SCRIBE_MODEL,
        transcript: await transcribeWithElevenLabs({
          apiKey: input.apiKey,
          samples: input.samples,
          language: input.language,
          signal: input.signal
        })
      };
    case "assemblyai":
      return transcribeWithAssemblyAi({
        apiKey: input.apiKey,
        samples: input.samples,
        language: input.language,
        model: input.model,
        signal: input.signal
      });
    case "soniox":
      return {
        model: SONIOX_REALTIME_MODEL,
        transcript: await transcribeWithSoniox({
          apiKey: input.apiKey,
          samples: input.samples,
          language: input.language,
          signal: input.signal
        })
      };
    default:
      return assertNever(input);
  }
}

export function isExternalSttProviderError(
  error: unknown
): error is Error & { status: number } {
  return error instanceof Error &&
    "status" in error &&
    typeof error.status === "number";
}
