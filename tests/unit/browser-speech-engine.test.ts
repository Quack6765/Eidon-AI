import { describe, expect, it } from "vitest";

import { BrowserSpeechEngine } from "@/lib/speech/engines/browser-speech-engine";
import { resolveSpeechLocale } from "@/lib/speech/locales";

describe("browser speech engine", () => {
  it("maps app languages to browser recognition locales", () => {
    expect(resolveSpeechLocale("en")).toBe("en-US");
    expect(resolveSpeechLocale("fr")).toBe("fr-FR");
    expect(resolveSpeechLocale("es")).toBe("es-ES");
  });

  it("starts browser recognition with the resolved locale and returns the final transcript on stop", async () => {
    const originalWindow = globalThis.window;
    let recognition: FakeSpeechRecognition | null = null;

    class FakeSpeechRecognition {
      lang = "";
      interimResults = true;
      continuous = false;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;

      constructor() {
        recognition = this;
      }

      start() {}

      stop() {
        this.onresult?.({
          results: [[{ transcript: "bonjour tout le monde" }]]
        });
        this.onend?.();
      }
    }

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        webkitSpeechRecognition: FakeSpeechRecognition
      }
    });

    try {
      const engine = new BrowserSpeechEngine();

      expect(engine.isSupported()).toBe(true);

      await engine.start({ language: "fr" });

      expect(recognition?.lang).toBe("fr-FR");
      expect(recognition?.interimResults).toBe(false);
      expect(recognition?.continuous).toBe(true);

      await expect(engine.stop()).resolves.toEqual({
        transcript: "bonjour tout le monde"
      });
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  });
});
