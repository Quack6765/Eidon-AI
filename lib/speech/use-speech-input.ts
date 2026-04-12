"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createSpeechEngine } from "@/lib/speech/create-speech-engine";
import { createSpeechController } from "@/lib/speech/speech-controller";
import { createSpeechAudioSession, type SpeechAudioSession } from "@/lib/speech/audio-session";
import type { SpeechSessionSnapshot, SttEngine, SttLanguage } from "@/lib/speech/types";

function normalizeSpeechError(error: unknown) {
  return error instanceof Error ? error.message : "Speech transcription failed.";
}

type UseSpeechInputOptions = {
  engine: SttEngine;
  initialLanguage: SttLanguage;
  resetKey?: string;
};

export function useSpeechInput({ engine, initialLanguage, resetKey }: UseSpeechInputOptions) {
  const [speechSnapshot, setSpeechSnapshot] = useState<SpeechSessionSnapshot>(() => ({
    phase: "idle",
    engine,
    language: initialLanguage,
    level: 0,
    error: null
  }));
  const speechControllerRef = useRef<ReturnType<typeof createSpeechController> | null>(null);
  const speechAudioSessionRef = useRef<SpeechAudioSession | null>(null);
  const speechPollingRef = useRef<number | null>(null);

  useEffect(() => {
    setSpeechSnapshot((current) =>
      current.phase === "idle"
        ? {
            phase: "idle",
            engine,
            language: initialLanguage,
            level: 0,
            error: null
          }
        : current
    );
  }, [engine, initialLanguage]);

  const stopSpeechPolling = useCallback(() => {
    if (speechPollingRef.current !== null) {
      window.clearInterval(speechPollingRef.current);
      speechPollingRef.current = null;
    }
  }, []);

  const disposeSpeechSession = useCallback(() => {
    stopSpeechPolling();
    speechControllerRef.current?.dispose();
    speechControllerRef.current = null;
    speechAudioSessionRef.current?.dispose();
    speechAudioSessionRef.current = null;
  }, [stopSpeechPolling]);

  useEffect(() => disposeSpeechSession, [disposeSpeechSession, resetKey]);

  const syncSpeechSnapshot = useCallback((controller: ReturnType<typeof createSpeechController>) => {
    setSpeechSnapshot(controller.getSnapshot());
  }, []);

  const startSpeechPolling = useCallback(
    (controller: ReturnType<typeof createSpeechController>) => {
      stopSpeechPolling();
      speechPollingRef.current = window.setInterval(() => {
        setSpeechSnapshot(controller.getSnapshot());
      }, 80);
    },
    [stopSpeechPolling]
  );

  const startSpeech = useCallback(async () => {
    if (
      speechControllerRef.current ||
      speechAudioSessionRef.current ||
      speechSnapshot.phase === "requesting-permission" ||
      speechSnapshot.phase === "listening" ||
      speechSnapshot.phase === "transcribing"
    ) {
      return;
    }

    setSpeechSnapshot((current) => ({
      ...current,
      engine,
      language: initialLanguage,
      error: null
    }));

    const speechEngine = createSpeechEngine(engine);

    if (!speechEngine.isSupported()) {
      setSpeechSnapshot({
        phase: "unsupported",
        engine,
        language: initialLanguage,
        level: 0,
        error: "Selected speech engine is unavailable."
      });
      speechEngine.dispose();
      return;
    }

    let controller: ReturnType<typeof createSpeechController> | null = null;
    let audioSession: SpeechAudioSession | null = null;

    try {
      audioSession = await createSpeechAudioSession();
      controller = createSpeechController({
        engine: speechEngine,
        audioMonitor: audioSession.audioMonitor
      });
      speechControllerRef.current = controller;
      speechAudioSessionRef.current = audioSession;
      audioSession = null;

      const startPromise = controller.start({
        engine,
        language: initialLanguage
      });

      syncSpeechSnapshot(controller);
      await startPromise;
      syncSpeechSnapshot(controller);
      startSpeechPolling(controller);
    } catch (caughtError) {
      if (controller) {
        syncSpeechSnapshot(controller);
      } else {
        setSpeechSnapshot({
          phase: "error",
          engine,
          language: initialLanguage,
          level: 0,
          error: normalizeSpeechError(caughtError)
        });
      }

      if (controller || speechControllerRef.current) {
        disposeSpeechSession();
      } else {
        audioSession?.dispose();
        speechEngine.dispose();
      }
    }
  }, [
    disposeSpeechSession,
    engine,
    initialLanguage,
    speechSnapshot.phase,
    startSpeechPolling,
    syncSpeechSnapshot
  ]);

  const stopSpeech = useCallback(async () => {
    const controller = speechControllerRef.current;

    if (!controller) {
      return "";
    }

    try {
      const result = await controller.stop();
      syncSpeechSnapshot(controller);
      return result.transcript;
    } catch (caughtError) {
      syncSpeechSnapshot(controller);
      setSpeechSnapshot((current) => ({
        ...current,
        error: normalizeSpeechError(caughtError)
      }));
      return "";
    } finally {
      disposeSpeechSession();
    }
  }, [disposeSpeechSession, syncSpeechSnapshot]);

  return {
    speechSnapshot,
    startSpeech,
    stopSpeech
  };
}
