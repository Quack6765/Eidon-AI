import WebSocket from "ws";
import { convertFloat32ToPcm16 } from "@/lib/speech/raw-audio";
import type { SonioxLanguage } from "@/lib/speech/soniox-languages";

export const SONIOX_REALTIME_MODEL = "stt-rt-v5";
export const SONIOX_REALTIME_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

const SONIOX_AUDIO_FRAME_BYTES = 3840;

export class SonioxTranscriptionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "SonioxTranscriptionError";
  }
}

type SonioxResultToken = { text?: string; is_final?: boolean };
type SonioxResultMessage = {
  tokens?: SonioxResultToken[];
  error_code?: string | null;
  error_message?: string | null;
  finished?: boolean;
};

export async function transcribeWithSoniox(input: {
  apiKey: string;
  samples: Float32Array;
  language: readonly SonioxLanguage[];
  signal?: AbortSignal;
}): Promise<string> {
  if (!input.apiKey) {
    throw new SonioxTranscriptionError(
      "Soniox rejected the API key. Check it in Speech-to-Text settings.",
      502
    );
  }

  const config: Record<string, unknown> = {
    api_key: input.apiKey,
    model: SONIOX_REALTIME_MODEL,
    audio_format: "pcm_s16le",
    sample_rate: 16000,
    num_channels: 1,
    enable_endpoint_detection: true
  };
  if (input.language.length > 0) {
    config.language_hints = [...input.language];
  }

  const pcm = Buffer.from(convertFloat32ToPcm16(input.samples));

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let finished = false;
    const finalText: string[] = [];

    const ws = new WebSocket(SONIOX_REALTIME_URL);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new SonioxTranscriptionError("Soniox transcription was cancelled.", 499));
    };

    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener("abort", onAbort, { once: true });
    }

    function cleanup() {
      input.signal?.removeEventListener("abort", onAbort);
      ws.removeAllListeners();
      ws.on("error", () => {});
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000);
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      console.error("[soniox] transcription failed:", error.message);
      reject(error);
    }

    function succeed(transcript: string) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(transcript);
    }

    ws.on("open", () => {
      ws.send(JSON.stringify(config));
      for (let offset = 0; offset < pcm.length; offset += SONIOX_AUDIO_FRAME_BYTES) {
        ws.send(pcm.subarray(offset, offset + SONIOX_AUDIO_FRAME_BYTES));
      }
      ws.send("");
    });

    ws.on("message", (data: Buffer) => {
      let message: SonioxResultMessage;
      try {
        message = JSON.parse(data.toString()) as SonioxResultMessage;
      } catch {
        return;
      }

      if (message.error_code) {
        const detail = message.error_message
          ? `${message.error_code}: ${message.error_message}`
          : message.error_code;
        const isAuthError = /api[_ -]?key|unauthor|forbidden/i.test(detail) ||
          /^(401|403)$/.test(message.error_code ?? "");
        fail(
          new SonioxTranscriptionError(
            isAuthError
              ? `Soniox rejected the API key (${detail}). Check it in Speech-to-Text settings.`
              : `Soniox transcription failed (${detail}).`,
            502
          )
        );
        return;
      }

      for (const token of message.tokens ?? []) {
        if (token.is_final && token.text && !/^<[^>]+>$/.test(token.text)) {
          finalText.push(token.text);
        }
      }

      if (message.finished) {
        finished = true;
        succeed(finalText.join("").trim());
      }
    });

    ws.on("error", (error: Error) => {
      fail(new SonioxTranscriptionError(
        `Soniox connection error: ${error.message || "unknown error"}`,
        502
      ));
    });

    ws.on("close", (code, reason) => {
      if (!finished) {
        const reasonText = reason && reason.length > 0 ? ` (${reason.toString()})` : "";
        fail(new SonioxTranscriptionError(
          `Soniox connection closed before transcription finished (code ${code})${reasonText}`,
          502
        ));
      }
    });
  });
}
