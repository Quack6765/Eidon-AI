import { resolveSpeechLocale } from "@/lib/speech/locales";
import type {
  SpeechEngine,
  SpeechEngineStartInput,
  SpeechSessionResult
} from "@/lib/speech/types";

type BrowserSpeechRecognitionEvent = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type BrowserSpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionInstance;

type SpeechRecognitionWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

function getRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export class BrowserSpeechEngine implements SpeechEngine {
  private recognition: BrowserSpeechRecognitionInstance | null = null;
  private transcript = "";
  private stopPromise: Promise<SpeechSessionResult> | null = null;
  private resolveStop: ((result: SpeechSessionResult) => void) | null = null;
  private rejectStop: ((error: Error) => void) | null = null;

  isSupported() {
    return Boolean(getRecognitionConstructor());
  }

  async start(input: SpeechEngineStartInput) {
    const RecognitionCtor = getRecognitionConstructor();
    if (!RecognitionCtor) {
      throw new Error("Browser speech recognition is unavailable.");
    }

    this.transcript = "";
    this.recognition = new RecognitionCtor();
    const locale = resolveSpeechLocale(input.language);
    if (locale) {
      this.recognition.lang = locale;
    }
    this.recognition.interimResults = false;
    this.recognition.continuous = true;
    this.stopPromise = new Promise<SpeechSessionResult>((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });

    this.recognition.onresult = (event) => {
      this.transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
    };
    this.recognition.onerror = (event) => {
      this.rejectStop?.(new Error(event.error || "Speech recognition failed."));
    };
    this.recognition.onend = () => {
      this.resolveStop?.({ transcript: this.transcript });
    };
    this.recognition.start();
  }

  async stop() {
    if (!this.recognition || !this.stopPromise) {
      return { transcript: "" };
    }

    const recognition = this.recognition;
    recognition.stop();
    return this.stopPromise.finally(() => {
      this.detachRecognition(recognition);
      this.resetState();
    });
  }

  dispose() {
    if (this.recognition) {
      this.detachRecognition(this.recognition);
      this.recognition.stop();
    }

    this.resetState();
  }

  private detachRecognition(recognition: BrowserSpeechRecognitionInstance) {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  }

  private resetState() {
    this.transcript = "";
    this.recognition = null;
    this.stopPromise = null;
    this.resolveStop = null;
    this.rejectStop = null;
  }
}
