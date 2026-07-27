import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const audioMonitor = {
  readLevel: vi.fn(() => 0.5),
  dispose: vi.fn()
};

vi.mock("@/lib/speech/audio-level-monitor", () => ({
  createAudioLevelMonitor: vi.fn(() => audioMonitor)
}));

describe("createSpeechAudioSession", () => {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    audioMonitor.readLevel.mockClear();
    audioMonitor.dispose.mockClear();
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }

    if (originalNavigator === undefined) {
      // @ts-expect-error test cleanup
      delete globalThis.navigator;
    } else {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator
      });
    }
  });

  it("throws when microphone access is unavailable", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {}
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {}
    });

    const { createSpeechAudioSession } = await import("@/lib/speech/audio-session");

    await expect(createSpeechAudioSession()).rejects.toThrow("Microphone access is unavailable.");
  });

  it("stops captured tracks when audio context support is unavailable", async () => {
    const stop = vi.fn();

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {}
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({
            getTracks: () => [{ stop }]
          }))
        }
      }
    });

    const { createSpeechAudioSession } = await import("@/lib/speech/audio-session");

    await expect(createSpeechAudioSession()).rejects.toThrow("Audio level monitoring is unavailable.");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("creates and disposes the audio session cleanly", async () => {
    const stop = vi.fn();
    const connect = vi.fn();
    const disconnect = vi.fn();
    const close = vi.fn(async () => {});
    const resume = vi.fn(async () => {});

    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect, disconnect };
      }

      createAnalyser() {
        return { fftSize: 0 };
      }

      resume = resume;
      close = close;
    }

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        AudioContext: FakeAudioContext
      }
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({
            getTracks: () => [{ stop }]
          }))
        }
      }
    });

    const { createSpeechAudioSession } = await import("@/lib/speech/audio-session");
    const session = await createSpeechAudioSession();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);

    session.dispose();

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(audioMonitor.dispose).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("captures and resamples microphone audio for embedded transcription", async () => {
    const stop = vi.fn();
    const sourceConnect = vi.fn();
    const sourceDisconnect = vi.fn();
    const processorConnect = vi.fn();
    const processorDisconnect = vi.fn();
    const processor = {
      onaudioprocess: null as ((event: {
        inputBuffer: { getChannelData: () => Float32Array };
        outputBuffer: { getChannelData: () => Float32Array };
      }) => void) | null,
      connect: processorConnect,
      disconnect: processorDisconnect
    };

    class FakeAudioContext {
      sampleRate = 48_000;
      destination = {};
      createMediaStreamSource() {
        return { connect: sourceConnect, disconnect: sourceDisconnect };
      }
      createAnalyser() {
        return { fftSize: 0 };
      }
      createScriptProcessor() {
        return processor;
      }
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    }

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { AudioContext: FakeAudioContext }
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] }))
        }
      }
    });

    const { createSpeechAudioSession } = await import("@/lib/speech/audio-session");
    const session = await createSpeechAudioSession({ captureAudio: true });
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(4_800).fill(1) },
      outputBuffer: { getChannelData: () => new Float32Array(4_800) }
    });
    session.audioRecorder!.start();
    processor.onaudioprocess?.({
      inputBuffer: { getChannelData: () => new Float32Array(4_800).fill(0.5) },
      outputBuffer: { getChannelData: () => new Float32Array(4_800) }
    });
    const recording = await session.audioRecorder!.stop();

    expect(recording.sampleRate).toBe(16_000);
    expect(recording.samples).toHaveLength(1_600);
    expect(recording.samples[800]).toBeCloseTo(0.5);

    session.dispose();
    expect(processorDisconnect).toHaveBeenCalledTimes(1);
  });

  it("resamples empty and upsampled audio safely", async () => {
    const { resampleSpeechAudio } = await import("@/lib/speech/audio-session");
    expect(resampleSpeechAudio(new Float32Array(), 48_000)).toHaveLength(0);
    expect(Array.from(resampleSpeechAudio(new Float32Array([0.25, -0.25]), 16_000)))
      .toEqual([0.25, -0.25]);
    expect(Array.from(resampleSpeechAudio(new Float32Array([0, 1]), 8_000, 16_000)))
      .toEqual([0, 0.5, 1, 1]);
    expect(() => resampleSpeechAudio(new Float32Array([0]), 0)).toThrow(
      "Invalid microphone sample rate"
    );
  });
});
