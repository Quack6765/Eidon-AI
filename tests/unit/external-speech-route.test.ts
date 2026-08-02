import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSettingsForUserMock,
  requireUserMock,
  transcribeWithExternalSttProviderMock
} = vi.hoisted(() => ({
  getSettingsForUserMock: vi.fn(),
  requireUserMock: vi.fn(),
  transcribeWithExternalSttProviderMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/settings", () => ({
  getSettingsForUser: getSettingsForUserMock
}));

vi.mock("@/lib/speech/external-transcription", async () => {
  const actual = await vi.importActual<typeof import("@/lib/speech/external-transcription")>(
    "@/lib/speech/external-transcription"
  );
  return {
    ...actual,
    transcribeWithExternalSttProvider: transcribeWithExternalSttProviderMock
  };
});

function makeAudioRequest(input: {
  contentType?: string;
  sampleRate?: string;
} = {}) {
  return new Request("http://localhost/api/speech/external/transcribe", {
    method: "POST",
    headers: {
      "content-type": input.contentType ?? "application/octet-stream",
      "x-audio-sample-rate": input.sampleRate ?? "16000"
    },
    body: new Float32Array([0.25, -0.25]).buffer
  });
}

describe("external speech transcription route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getSettingsForUserMock.mockReset();
    transcribeWithExternalSttProviderMock.mockReset();
    requireUserMock.mockResolvedValue({ id: "user_speech" });
    getSettingsForUserMock.mockReturnValue({
      sttEngine: "external",
      sttProvider: "elevenlabs",
      externalSttLanguage: "auto",
      externalSttApiKey: "xi-secret"
    });
  });

  it("requires authentication, External mode, and a saved key", async () => {
    const { POST } = await import("@/app/api/speech/external/transcribe/route");

    requireUserMock.mockResolvedValueOnce(null);
    expect((await POST(makeAudioRequest())).status).toBe(401);

    getSettingsForUserMock.mockReturnValueOnce({
      sttEngine: "browser",
      sttProvider: "elevenlabs",
      externalSttLanguage: "auto",
      externalSttApiKey: "xi-secret"
    });
    expect((await POST(makeAudioRequest())).status).toBe(409);

    getSettingsForUserMock.mockReturnValueOnce({
      sttEngine: "external",
      sttProvider: "elevenlabs",
      externalSttLanguage: "auto",
      externalSttApiKey: ""
    });
    const missingKey = await POST(makeAudioRequest());
    expect(missingKey.status).toBe(409);
    await expect(missingKey.json()).resolves.toEqual({
      error: "Add your ElevenLabs API key in Speech-to-Text settings."
    });
  });

  it("validates recorded audio metadata before calling the provider", async () => {
    const { POST } = await import("@/app/api/speech/external/transcribe/route");

    expect((await POST(makeAudioRequest({ contentType: "audio/wav" }))).status).toBe(400);
    expect((await POST(makeAudioRequest({ sampleRate: "48000" }))).status).toBe(400);
    expect((await POST(new Request("http://localhost/api/speech/external/transcribe", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-audio-sample-rate": "16000"
      }
    }))).status).toBe(400);
    expect(transcribeWithExternalSttProviderMock).not.toHaveBeenCalled();
  });

  it("transcribes bounded audio with the selected provider", async () => {
    transcribeWithExternalSttProviderMock.mockResolvedValue({
      model: "scribe_v2",
      transcript: "hello from Scribe"
    });
    getSettingsForUserMock.mockReturnValue({
      sttEngine: "external",
      sttProvider: "elevenlabs",
      externalSttLanguage: "fra",
      externalSttApiKey: "xi-secret"
    });
    const { POST } = await import("@/app/api/speech/external/transcribe/route");

    const response = await POST(makeAudioRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      model: "scribe_v2",
      provider: "elevenlabs",
      transcript: "hello from Scribe"
    });
    expect(transcribeWithExternalSttProviderMock).toHaveBeenCalledWith({
      provider: "elevenlabs",
      apiKey: "xi-secret",
      samples: expect.any(Float32Array),
      language: "fra"
    });
  });
});
