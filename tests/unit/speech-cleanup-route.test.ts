import { beforeEach, describe, expect, it, vi } from "vitest";

const { cleanSpeechTranscriptMock, requireUserMock } = vi.hoisted(() => ({
  cleanSpeechTranscriptMock: vi.fn(),
  requireUserMock: vi.fn()
}));

class MockSpeechCleanupUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechCleanupUnavailableError";
  }
}

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/speech/cleanup", () => ({
  cleanSpeechTranscript: cleanSpeechTranscriptMock,
  isSpeechCleanupUnavailableError: (error: unknown) =>
    error instanceof MockSpeechCleanupUnavailableError
}));

function makeCleanupRequest(body: unknown) {
  return new Request("http://localhost/api/speech/transcription/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("speech cleanup route", () => {
  beforeEach(() => {
    cleanSpeechTranscriptMock.mockReset();
    requireUserMock.mockReset();
    requireUserMock.mockResolvedValue({ id: "user_cleanup" });
    cleanSpeechTranscriptMock.mockResolvedValue({
      text: "Buy water.",
      model: "claude-sonnet-4-5",
      provider: "Cleanup profile"
    });
  });

  it("requires authentication", async () => {
    const { POST } = await import("@/app/api/speech/transcription/cleanup/route");

    requireUserMock.mockResolvedValueOnce(null);
    const response = await POST(makeCleanupRequest({ transcript: "buy milk" }));
    expect(response.status).toBe(401);
    expect(cleanSpeechTranscriptMock).not.toHaveBeenCalled();
  });

  it("rejects invalid transcript payloads", async () => {
    const { POST } = await import("@/app/api/speech/transcription/cleanup/route");

    expect((await POST(makeCleanupRequest({ transcript: "" }))).status).toBe(400);
    expect((await POST(makeCleanupRequest({}))).status).toBe(400);
    expect((await POST(makeCleanupRequest("not-json"))).status).toBe(400);
    expect((await POST(makeCleanupRequest({ transcript: "x".repeat(150_001) }))).status).toBe(400);
    expect(cleanSpeechTranscriptMock).not.toHaveBeenCalled();
  });

  it("maps unavailable cleanup errors to 409", async () => {
    const { POST } = await import("@/app/api/speech/transcription/cleanup/route");

    cleanSpeechTranscriptMock.mockRejectedValueOnce(
      new MockSpeechCleanupUnavailableError("AI post-cleanup is disabled.")
    );
    const response = await POST(makeCleanupRequest({ transcript: "buy milk" }));
    expect(response.status).toBe(409);
    const payload = await response.json() as { error?: string };
    expect(payload.error).toBe("AI post-cleanup is disabled.");
  });

  it("returns the cleaned text on success", async () => {
    const { POST } = await import("@/app/api/speech/transcription/cleanup/route");

    const response = await POST(makeCleanupRequest({ transcript: "um buy milk" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "Buy water.",
      model: "claude-sonnet-4-5",
      provider: "Cleanup profile"
    });
    expect(cleanSpeechTranscriptMock).toHaveBeenCalledWith({
      transcript: "um buy milk",
      signal: expect.any(AbortSignal)
    });
  });

  it("hides provider failures behind a generic 500", async () => {
    const { POST } = await import("@/app/api/speech/transcription/cleanup/route");

    cleanSpeechTranscriptMock.mockRejectedValueOnce(new Error("provider blew up"));
    const response = await POST(makeCleanupRequest({ transcript: "buy milk" }));
    expect(response.status).toBe(500);
    const payload = await response.json() as { error?: string };
    expect(payload.error).toBe("AI post-cleanup failed.");
  });
});
