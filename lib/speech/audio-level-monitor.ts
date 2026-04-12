export type AudioLevelMonitor = {
  readLevel(): number;
  dispose(): void;
};

export function createAudioLevelMonitor(input: { analyser: AnalyserNode }): AudioLevelMonitor {
  const buffer = new Uint8Array(input.analyser.fftSize);

  return {
    readLevel() {
      input.analyser.getByteTimeDomainData(buffer);
      const peak = buffer.reduce((max, value) => Math.max(max, Math.abs(value - 128)), 0);
      return Math.min(1, peak / 128);
    },
    dispose() {}
  };
}
