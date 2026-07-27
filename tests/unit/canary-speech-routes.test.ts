import { beforeEach, describe, expect, it, vi } from "vitest";

import { CanaryTranscriptionBusyError } from "@/lib/speech/canary-transcription-limiter";

const {
  ensureCanaryModelReadyMock,
  getSettingsForUserMock,
  requireUserMock,
  transcribeWithCanaryMock
} = vi.hoisted(() => ({
  ensureCanaryModelReadyMock: vi.fn(),
  getSettingsForUserMock: vi.fn(),
  requireUserMock: vi.fn(),
  transcribeWithCanaryMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/settings", () => ({
  getSettingsForUser: getSettingsForUserMock
}));

vi.mock("@/lib/speech/canary-model", () => ({
  CANARY_MODEL_NAME: "Canary 180M Flash",
  CANARY_SAMPLE_RATE: 16_000,
  MAX_CANARY_AUDIO_BYTES: 19_200_000,
  ensureCanaryModelReady: ensureCanaryModelReadyMock,
  transcribeWithCanary: transcribeWithCanaryMock
}));

function audioBody(values: number[]) {
  const buffer = new ArrayBuffer(values.length * Float32Array.BYTES_PER_ELEMENT);
  new Float32Array(buffer).set(values);
  return buffer;
}

function transcriptionRequest(input: {
  body?: ArrayBuffer;
  contentType?: string;
  language?: string;
  sampleRate?: string;
} = {}) {
  return new Request("http://localhost/api/speech/canary/transcribe", {
    method: "POST",
    headers: {
      "content-type": input.contentType ?? "application/octet-stream",
      "x-audio-sample-rate": input.sampleRate ?? "16000",
      "x-speech-language": input.language ?? "en"
    },
    body: input.body ?? audioBody([0, 0.25, -0.25])
  });
}

describe("Canary speech routes", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    getSettingsForUserMock.mockReset();
    ensureCanaryModelReadyMock.mockReset();
    transcribeWithCanaryMock.mockReset();
  });

  it("prepares the model only for authenticated users in embedded mode", async () => {
    const { POST } = await import("@/app/api/speech/canary/prepare/route");

    requireUserMock.mockResolvedValueOnce(null);
    expect((await POST()).status).toBe(401);

    requireUserMock.mockResolvedValueOnce({ id: "user-1" });
    getSettingsForUserMock.mockReturnValueOnce({ sttEngine: "browser" });
    expect((await POST()).status).toBe(409);

    requireUserMock.mockResolvedValueOnce({ id: "user-1" });
    getSettingsForUserMock.mockReturnValueOnce({ sttEngine: "embedded" });
    ensureCanaryModelReadyMock.mockResolvedValueOnce({});
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      model: "Canary 180M Flash",
      ready: true
    });
    expect(ensureCanaryModelReadyMock).toHaveBeenCalledTimes(1);
  });

  it("returns a service error when model preparation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getSettingsForUserMock.mockReturnValue({ sttEngine: "embedded" });
    ensureCanaryModelReadyMock.mockRejectedValue(new Error("offline"));
    const { POST } = await import("@/app/api/speech/canary/prepare/route");

    const response = await POST();
    expect(response.status).toBe(503);
    errorSpy.mockRestore();
  });

  it("transcribes bounded Float32 audio with the selected language", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getSettingsForUserMock.mockReturnValue({ sttEngine: "embedded" });
    transcribeWithCanaryMock.mockResolvedValue("bonjour");
    const { POST } = await import("@/app/api/speech/canary/transcribe/route");

    const response = await POST(transcriptionRequest({ language: "fr" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      model: "Canary 180M Flash",
      transcript: "bonjour"
    });
    expect(transcribeWithCanaryMock).toHaveBeenCalledWith(
      expect.any(Float32Array),
      "fr"
    );
  });

  it("rejects unauthenticated, browser-mode, malformed, and invalid audio requests", async () => {
    const { POST } = await import("@/app/api/speech/canary/transcribe/route");

    requireUserMock.mockResolvedValueOnce(null);
    expect((await POST(transcriptionRequest())).status).toBe(401);

    requireUserMock.mockResolvedValueOnce({ id: "user-1" });
    getSettingsForUserMock.mockReturnValueOnce({ sttEngine: "browser" });
    expect((await POST(transcriptionRequest())).status).toBe(409);

    requireUserMock.mockResolvedValue({ id: "user-1" });
    getSettingsForUserMock.mockReturnValue({ sttEngine: "embedded" });
    expect((await POST(transcriptionRequest({ contentType: "audio/webm" }))).status).toBe(400);
    expect((await POST(transcriptionRequest({ sampleRate: "48000" }))).status).toBe(400);
    expect((await POST(transcriptionRequest({ language: "de" }))).status).toBe(400);
    expect((await POST(transcriptionRequest({ body: new ArrayBuffer(3) }))).status).toBe(400);
    expect((await POST(transcriptionRequest({ body: audioBody([Number.NaN]) }))).status).toBe(400);
  });

  it("maps busy and inference failures to safe responses", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1" });
    getSettingsForUserMock.mockReturnValue({ sttEngine: "embedded" });
    const { POST } = await import("@/app/api/speech/canary/transcribe/route");

    transcribeWithCanaryMock.mockRejectedValueOnce(new CanaryTranscriptionBusyError());
    expect((await POST(transcriptionRequest())).status).toBe(429);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    transcribeWithCanaryMock.mockRejectedValueOnce(new Error("native failure details"));
    const response = await POST(transcriptionRequest());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Canary 180M Flash transcription failed."
    });
    errorSpy.mockRestore();
  });
});
