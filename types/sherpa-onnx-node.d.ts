declare module "sherpa-onnx-node" {
  export type OfflineRecognizerConfig = {
    featConfig: {
      sampleRate: number;
      featureDim: number;
    };
    modelConfig: {
      canary: {
        encoder: string;
        decoder: string;
        srcLang: string;
        tgtLang: string;
        usePnc: number;
      };
      tokens: string;
      numThreads: number;
      provider: "cpu";
      debug: number;
    };
  };

  export type OfflineRecognizerResult = {
    text: string;
  };

  export type OfflineStream = {
    acceptWaveform(input: {
      sampleRate: number;
      samples: Float32Array;
    }): void;
  };

  export class OfflineRecognizer {
    static createAsync(config: OfflineRecognizerConfig): Promise<OfflineRecognizer>;
    config: OfflineRecognizerConfig;
    createStream(): OfflineStream;
    setConfig(config: OfflineRecognizerConfig): void;
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>;
  }

  const sherpaOnnx: {
    OfflineRecognizer: typeof OfflineRecognizer;
    readWave(filename: string): {
      sampleRate: number;
      samples: Float32Array;
    };
  };

  export default sherpaOnnx;
}
