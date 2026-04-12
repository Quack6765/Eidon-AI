import { describe, expect, it } from "vitest";

import { BrowserSpeechEngine } from "@/lib/speech/engines/browser-speech-engine";
import { resolveSpeechLocale } from "@/lib/speech/locales";

describe("browser speech engine", () => {
  it("maps app languages to browser recognition locales", () => {
    expect(resolveSpeechLocale("auto")).toBeNull();
    expect(resolveSpeechLocale("en")).toBe("en-US");
    expect(resolveSpeechLocale("fr")).toBe("fr-FR");
    expect(resolveSpeechLocale("es")).toBe("es-ES");
  });

  it("starts browser recognition with the resolved locale and returns the final transcript on stop", async () => {
    const originalWindow = globalThis.window;
    type FakeRecognitionInstance = {
      lang: string;
      interimResults: boolean;
      continuous: boolean;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onend: (() => void) | null;
    };
    let recognition: FakeRecognitionInstance | null = null;

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
      expect(recognition).not.toBeNull();
      const activeRecognition = recognition!;

      expect(activeRecognition.lang).toBe("fr-FR");
      expect(activeRecognition.interimResults).toBe(false);
      expect(activeRecognition.continuous).toBe(true);

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

  it("leaves the browser recognition locale unset when auto-detect is selected", async () => {
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
      await engine.start({ language: "auto" });
      expect(recognition).not.toBeNull();
      const activeRecognition = recognition!;
      expect(activeRecognition.lang).toBe("");
      await engine.stop();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  });

  it("stops an active recognition session and detaches handlers when disposed", async () => {
    const originalWindow = globalThis.window;
    type FakeRecognitionInstance = {
      stopCalls: number;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: ((event: { error: string }) => void) | null;
      onend: (() => void) | null;
    };
    let recognition: FakeRecognitionInstance | null = null;

    class FakeSpeechRecognition {
      lang = "";
      interimResults = true;
      continuous = false;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null = () => {};
      onerror: ((event: { error: string }) => void) | null = () => {};
      onend: (() => void) | null = () => {};
      stopCalls = 0;

      constructor() {
        recognition = this;
      }

      start() {}

      stop() {
        this.stopCalls += 1;
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
      await engine.start({ language: "en" });
      expect(recognition).not.toBeNull();
      const activeRecognition = recognition!;

      engine.dispose();

      expect(activeRecognition.stopCalls).toBe(1);
      expect(activeRecognition.onresult).toBeNull();
      expect(activeRecognition.onerror).toBeNull();
      expect(activeRecognition.onend).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow
      });
    }
  });
});
