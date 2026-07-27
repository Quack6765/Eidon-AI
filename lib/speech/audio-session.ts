import { createAudioLevelMonitor } from "@/lib/speech/audio-level-monitor";
import type { SpeechAudioRecorder } from "@/lib/speech/types";

export const CANARY_SAMPLE_RATE = 16_000;
export const MAX_EMBEDDED_RECORDING_SECONDS = 300;

export type SpeechAudioSession = {
  audioMonitor: ReturnType<typeof createAudioLevelMonitor>;
  audioRecorder: SpeechAudioRecorder | null;
  dispose: () => void;
};

export function resampleSpeechAudio(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate = CANARY_SAMPLE_RATE
) {
  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0) {
    throw new Error("Invalid microphone sample rate.");
  }

  if (samples.length === 0) {
    return new Float32Array();
  }

  if (sourceSampleRate === targetSampleRate) {
    return samples.slice();
  }

  const outputLength = Math.max(1, Math.floor(samples.length * targetSampleRate / sourceSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;

  if (ratio < 1) {
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * ratio;
      const lower = Math.floor(position);
      const upper = Math.min(samples.length - 1, lower + 1);
      const weight = position - lower;
      output[index] = samples[lower] * (1 - weight) + samples[upper] * weight;
    }
    return output;
  }

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = outputIndex * ratio;
    const end = Math.min(samples.length, (outputIndex + 1) * ratio);
    const firstIndex = Math.floor(start);
    const lastIndex = Math.min(samples.length - 1, Math.ceil(end) - 1);
    let total = 0;
    let totalWeight = 0;

    for (let inputIndex = firstIndex; inputIndex <= lastIndex; inputIndex += 1) {
      const weight = Math.max(0, Math.min(end, inputIndex + 1) - Math.max(start, inputIndex));
      total += samples[inputIndex] * weight;
      totalWeight += weight;
    }

    output[outputIndex] = totalWeight > 0 ? total / totalWeight : 0;
  }

  return output;
}

function createSpeechAudioRecorder(input: {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
}): SpeechAudioRecorder {
  if (typeof input.audioContext.createScriptProcessor !== "function") {
    throw new Error("Embedded audio capture is unavailable in this browser.");
  }

  const processor = input.audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const maxSourceSamples = Math.ceil(
    input.audioContext.sampleRate * MAX_EMBEDDED_RECORDING_SECONDS
  );
  let totalSamples = 0;
  let isRecording = false;
  let exceededLimit = false;

  processor.onaudioprocess = (event) => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (!isRecording) {
      return;
    }

    const samples = event.inputBuffer.getChannelData(0);
    const remaining = maxSourceSamples - totalSamples;
    if (remaining <= 0) {
      exceededLimit = true;
      return;
    }

    const captured = new Float32Array(samples.subarray(0, Math.min(samples.length, remaining)));
    chunks.push(captured);
    totalSamples += captured.length;
    if (captured.length < samples.length) {
      exceededLimit = true;
    }
  };

  input.source.connect(processor);
  processor.connect(input.audioContext.destination);

  return {
    start() {
      chunks.length = 0;
      totalSamples = 0;
      exceededLimit = false;
      isRecording = true;
    },
    async stop() {
      isRecording = false;
      if (exceededLimit) {
        throw new Error(
          `Embedded dictation is limited to ${MAX_EMBEDDED_RECORDING_SECONDS / 60} minutes per recording.`
        );
      }

      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }

      return {
        sampleRate: CANARY_SAMPLE_RATE,
        samples: resampleSpeechAudio(merged, input.audioContext.sampleRate)
      };
    },
    dispose() {
      isRecording = false;
      chunks.length = 0;
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {}
    }
  };
}

export async function createSpeechAudioSession(options: {
  captureAudio?: boolean;
} = {}): Promise<SpeechAudioSession> {
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
  const audioRecorder = options.captureAudio
    ? createSpeechAudioRecorder({ audioContext, source })
    : null;

  return {
    audioMonitor,
    audioRecorder,
    dispose() {
      try {
        source.disconnect();
      } catch {}

      audioRecorder?.dispose();
      audioMonitor.dispose();
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => {});
    }
  };
}
