import { beforeEach, describe, expect, it } from "vitest";

import {
  CanaryTranscriptionBusyError,
  resetCanaryTranscriptionLimiterForTests,
  runCanaryTranscription
} from "@/lib/speech/canary-transcription-limiter";

describe("Canary transcription limiter", () => {
  beforeEach(() => {
    resetCanaryTranscriptionLimiterForTests();
  });

  it("serializes inference and rejects duplicate work for one user", async () => {
    let release!: () => void;
    const first = runCanaryTranscription({
      userId: "user-1",
      execute: () => new Promise<string>((resolve) => {
        release = () => resolve("first");
      })
    });
    await Promise.resolve();

    await expect(runCanaryTranscription({
      userId: "user-1",
      execute: async () => "duplicate"
    })).rejects.toBeInstanceOf(CanaryTranscriptionBusyError);

    const second = runCanaryTranscription({
      userId: "user-2",
      execute: async () => "second"
    });
    release();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("releases the queue after an inference failure", async () => {
    await expect(runCanaryTranscription({
      userId: "user-1",
      execute: async () => {
        throw new Error("decode failed");
      }
    })).rejects.toThrow("decode failed");

    await expect(runCanaryTranscription({
      userId: "user-1",
      execute: async () => "recovered"
    })).resolves.toBe("recovered");
  });
});
