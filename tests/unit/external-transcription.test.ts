import { describe, expect, it, vi } from "vitest";

const transcribeWithElevenLabsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/speech/elevenlabs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/speech/elevenlabs")>(
    "@/lib/speech/elevenlabs"
  );
  return {
    ...actual,
    transcribeWithElevenLabs: transcribeWithElevenLabsMock
  };
});

import { transcribeWithExternalSttProvider } from "@/lib/speech/external-transcription";

describe("external speech-to-text transcription", () => {
  it("dispatches the shared request to the selected provider adapter", async () => {
    transcribeWithElevenLabsMock.mockResolvedValue("hello");
    const samples = new Float32Array([0.25, -0.25]);

    await expect(
      transcribeWithExternalSttProvider({
        provider: "elevenlabs",
        apiKey: "xi-secret",
        samples,
        language: "fra"
      })
    ).resolves.toEqual({
      model: "scribe_v2",
      transcript: "hello"
    });
    expect(transcribeWithElevenLabsMock).toHaveBeenCalledWith({
      apiKey: "xi-secret",
      samples,
      language: "fra"
    });
  });
});
