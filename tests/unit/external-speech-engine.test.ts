// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalSpeechEngine } from "@/lib/speech/engines/external-speech-engine";
import type { SpeechAudioRecorder } from "@/lib/speech/types";

function createRecorder(samples = new Float32Array([0.25, -0.25])): SpeechAudioRecorder {
  return {
    start: vi.fn(),
    stop: vi.fn(async () => ({ sampleRate: 16_000, samples })),
    dispose: vi.fn()
  };
}

describe("external speech engine", () => {
  const originalAudioContext = window.AudioContext;
  const originalFetch = global.fetch;

  beforeEach(() => {
    class FakeAudioContext {
      createScriptProcessor() {}
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext
    });
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: originalAudioContext
    });
    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined
    });
    global.fetch = originalFetch;
  });

  it("records audio and sends it to the external transcription endpoint", async () => {
    const recorder = createRecorder();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ transcript: "  hello from Scribe  " }), { status: 200 })
    );
    const engine = new ExternalSpeechEngine();

    expect(engine.isSupported()).toBe(true);
    await engine.start({ language: "auto", audioRecorder: recorder });
    await expect(engine.stop()).resolves.toEqual({ transcript: "hello from Scribe" });

    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/speech/external/transcribe",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Audio-Sample-Rate": "16000"
        }),
        body: expect.any(ArrayBuffer)
      })
    );
  });

  it("surfaces endpoint failures and invalid responses", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Add an ElevenLabs API key." }), { status: 409 })
    );
    const missingKey = new ExternalSpeechEngine();
    await missingKey.start({ language: "en", audioRecorder: createRecorder() });
    await expect(missingKey.stop()).rejects.toThrow("Add an ElevenLabs API key.");

    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ transcript: 42 }), { status: 200 })
    );
    const invalidResponse = new ExternalSpeechEngine();
    await invalidResponse.start({ language: "fr", audioRecorder: createRecorder() });
    await expect(invalidResponse.stop()).rejects.toThrow("invalid transcription response");
  });

  it("requires captured audio and disposes active resources", async () => {
    const recorder = createRecorder(new Float32Array());
    const engine = new ExternalSpeechEngine();
    await engine.start({ language: "es", audioRecorder: recorder });
    await expect(engine.stop()).rejects.toThrow("No microphone audio was captured.");

    engine.dispose();
    expect(recorder.dispose).toHaveBeenCalledTimes(1);
    await expect(new ExternalSpeechEngine().start({ language: "auto" }))
      .rejects.toThrow("External audio capture is unavailable");
  });
});
