// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddedSpeechEngine } from "@/lib/speech/engines/embedded-speech-engine";
import type { SpeechAudioRecorder } from "@/lib/speech/types";

function createRecorder(samples = new Float32Array([0.25, -0.25])): SpeechAudioRecorder {
  return {
    start: vi.fn(),
    stop: vi.fn(async () => ({ sampleRate: 16_000, samples })),
    dispose: vi.fn()
  };
}

describe("embedded speech engine", () => {
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

  it("reports support only when embedded audio capture is available", () => {
    const engine = new EmbeddedSpeechEngine();
    expect(engine.isSupported()).toBe(true);

    Object.defineProperty(global.navigator, "mediaDevices", {
      configurable: true,
      value: undefined
    });
    expect(engine.isSupported()).toBe(false);
  });

  it("prepares Canary while recording and submits Float32 audio on stop", async () => {
    const recorder = createRecorder();
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ready: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: "  bonjour  " }), { status: 200 }));
    const engine = new EmbeddedSpeechEngine();

    await engine.start({ language: "fr", audioRecorder: recorder });
    await expect(engine.stop()).resolves.toEqual({ transcript: "bonjour" });

    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "/api/speech/canary/prepare",
      expect.objectContaining({ method: "POST" })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "/api/speech/canary/transcribe",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Audio-Sample-Rate": "16000",
          "X-Speech-Language": "fr"
        }),
        body: expect.any(ArrayBuffer)
      })
    );
  });

  it("rejects auto-detect and unavailable audio recorders", async () => {
    const engine = new EmbeddedSpeechEngine();
    await expect(engine.start({ language: "auto", audioRecorder: createRecorder() }))
      .rejects.toThrow("Choose English, French, or Spanish");
    await expect(engine.start({ language: "en" }))
      .rejects.toThrow("Embedded audio capture is unavailable");
  });

  it("surfaces model preparation and invalid response failures", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Model download failed." }), { status: 503 })
    );
    const prepareFailure = new EmbeddedSpeechEngine();
    await prepareFailure.start({ language: "en", audioRecorder: createRecorder() });
    await expect(prepareFailure.stop()).rejects.toThrow("Model download failed.");

    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ready: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ transcript: 42 }), { status: 200 }));
    const invalidResponse = new EmbeddedSpeechEngine();
    await invalidResponse.start({ language: "es", audioRecorder: createRecorder() });
    await expect(invalidResponse.stop()).rejects.toThrow("invalid transcription response");
  });

  it("rejects empty captures and disposes active resources", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ready: true }), { status: 200 })
    );
    const recorder = createRecorder(new Float32Array());
    const engine = new EmbeddedSpeechEngine();
    await engine.start({ language: "en", audioRecorder: recorder });

    await expect(engine.stop()).rejects.toThrow("No microphone audio was captured.");
    engine.dispose();
    expect(recorder.dispose).toHaveBeenCalledTimes(1);
  });

  it("stops safely before recording starts", async () => {
    const engine = new EmbeddedSpeechEngine();
    await expect(engine.stop()).resolves.toEqual({ transcript: "" });
  });
});
