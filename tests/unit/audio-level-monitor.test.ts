import { describe, expect, it } from "vitest";

import { createAudioLevelMonitor } from "@/lib/speech/audio-level-monitor";

function createAnalyserStub(values: number[]): AnalyserNode {
  return {
    fftSize: values.length,
    getByteTimeDomainData(buffer: Uint8Array) {
      buffer.set(values);
    }
  } as AnalyserNode;
}

describe("audio level monitor", () => {
  it("normalizes analyser data into a 0-1 audio level", () => {
    const analyser = createAnalyserStub([0, 64, 128, 255]);
    const monitor = createAudioLevelMonitor({ analyser });

    expect(monitor.readLevel()).toBeGreaterThan(0);
    expect(monitor.readLevel()).toBeLessThanOrEqual(1);
  });
});
