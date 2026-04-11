import { describe, expect, it, vi } from "vitest";

import { createSpeechController } from "@/lib/speech/speech-controller";
import type { SpeechEngine } from "@/lib/speech/types";

function createMockSpeechEngine(input: { finalTranscript: string }): SpeechEngine {
  return {
    isSupported: () => true,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({
      transcript: input.finalTranscript
    })),
    dispose: vi.fn()
  };
}

function createMockAudioMonitor() {
  return {
    readLevel: vi.fn(() => 0.5),
    dispose: vi.fn()
  };
}

describe("speech controller", () => {
  it("transitions from listening to transcribing and resolves appended transcript text", async () => {
    const engine = createMockSpeechEngine({
      finalTranscript: "bonjour tout le monde"
    });
    const controller = createSpeechController({
      engine,
      audioMonitor: createMockAudioMonitor()
    });

    await controller.start({ engine: "browser", language: "fr" });
    expect(controller.getSnapshot().phase).toBe("listening");

    const result = await controller.stop();

    expect(result.transcript).toBe("bonjour tout le monde");
    expect(controller.getSnapshot().phase).toBe("idle");
  });
});
