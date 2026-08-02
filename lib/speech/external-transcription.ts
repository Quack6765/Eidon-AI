import {
  ELEVENLABS_SCRIBE_MODEL,
  transcribeWithElevenLabs
} from "@/lib/speech/elevenlabs";
import type {
  ExternalSttLanguageForProvider,
  SttProvider
} from "@/lib/speech/external-providers";

type ExternalSttTranscriptionInput = {
  [Provider in SttProvider]: {
    provider: Provider;
    apiKey: string;
    samples: Float32Array;
    language: ExternalSttLanguageForProvider<Provider>;
  }
}[SttProvider];

function assertNever(value: never): never {
  throw new Error(`Unsupported external speech-to-text provider: ${String(value)}`);
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
          language: input.language
        })
      };
    default:
      return assertNever(input.provider);
  }
}

export function isExternalSttProviderError(
  error: unknown
): error is Error & { status: number } {
  return error instanceof Error &&
    "status" in error &&
    typeof error.status === "number";
}
