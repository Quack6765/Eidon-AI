import { transcribeWithAssemblyAi } from "@/lib/speech/assemblyai";
import {
  ELEVENLABS_SCRIBE_MODEL,
  transcribeWithElevenLabs
} from "@/lib/speech/elevenlabs";
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
