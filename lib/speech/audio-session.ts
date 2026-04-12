import { createAudioLevelMonitor } from "@/lib/speech/audio-level-monitor";

export type SpeechAudioSession = {
  audioMonitor: ReturnType<typeof createAudioLevelMonitor>;
  dispose: () => void;
};

export async function createSpeechAudioSession(): Promise<SpeechAudioSession> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioContextCtor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Audio level monitoring is unavailable.");
  }

  const audioContext = new AudioContextCtor();

  if (typeof audioContext.resume === "function") {
    await audioContext.resume().catch(() => {});
  }

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const audioMonitor = createAudioLevelMonitor({ analyser });

  return {
    audioMonitor,
    dispose() {
      try {
        source.disconnect();
      } catch {}

      audioMonitor.dispose();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => {});
    }
  };
}
