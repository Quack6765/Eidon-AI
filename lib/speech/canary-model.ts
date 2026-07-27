import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";

import { env } from "@/lib/env";
import type { SttLanguage } from "@/lib/speech/types";
import type {
  OfflineRecognizer,
  OfflineRecognizerConfig
} from "sherpa-onnx-node";

export const CANARY_MODEL_NAME = "Canary 180M Flash";
export const CANARY_MODEL_REPOSITORY =
  "csukuangfj/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8";
export const CANARY_MODEL_REVISION = "9077164e0d3dd1d5353743e89ceaa1d3a770838c";
export const CANARY_SAMPLE_RATE = 16_000;
export const MAX_CANARY_AUDIO_SECONDS = 300;
export const MAX_CANARY_AUDIO_BYTES = CANARY_SAMPLE_RATE * MAX_CANARY_AUDIO_SECONDS * 4;

const CANARY_CHUNK_SECONDS = 30;
const CANARY_CHUNK_OVERLAP_SECONDS = 1;
type CanaryModelFile = {
  name: string;
  size: number;
  sha256: string;
};

const CANARY_MODEL_FILES: readonly CanaryModelFile[] = [
  {
    name: "encoder.int8.onnx",
    size: 132_678_643,
    sha256: "7a75b4e2a5857a6dcc0819503bbe3fad66943db4a3ccf21d3f27c633667d303f"
  },
  {
    name: "decoder.int8.onnx",
    size: 74_437_848,
    sha256: "e41a2ab9c0c2fe81a1e8ade5a45fb02a74bc4db7d1f91b89a54a25e2cf79cba2"
  },
  {
    name: "tokens.txt",
    size: 53_555,
    sha256: "2dae6fc7815f9640645e0c765522b278ee0cef49b482d91f6913e334628d3e77"
  }
];

type CanaryLanguage = Exclude<SttLanguage, "auto">;

type CanaryRuntime = {
  config: OfflineRecognizerConfig;
  recognizer: OfflineRecognizer;
};

type CanaryStore = {
  loading: Promise<CanaryRuntime> | null;
  runtime: CanaryRuntime | null;
};

type CanaryModelOverrides = {
  createRecognizer?: (config: OfflineRecognizerConfig) => Promise<OfflineRecognizer>;
  directory?: string;
  fetcher?: typeof fetch;
  files?: readonly CanaryModelFile[];
};

const CANARY_STORE_KEY = Symbol.for("eidon.speech.canary-runtime");
const CANARY_OVERRIDES_KEY = Symbol.for("eidon.speech.canary-model-overrides");

function getCanaryStore() {
  const scope = globalThis as typeof globalThis & {
    [CANARY_STORE_KEY]?: CanaryStore;
  };

  if (!scope[CANARY_STORE_KEY]) {
    scope[CANARY_STORE_KEY] = {
      loading: null,
      runtime: null
    };
  }

  return scope[CANARY_STORE_KEY];
}

function getCanaryModelOverrides() {
  const scope = globalThis as typeof globalThis & {
    [CANARY_OVERRIDES_KEY]?: CanaryModelOverrides;
  };
  return scope[CANARY_OVERRIDES_KEY] ?? {};
}

function getCanaryModelDirectory() {
  return path.resolve(
    env.EIDON_DATA_DIR,
    "model-cache",
    "canary-180m-flash-int8",
    CANARY_MODEL_REVISION
  );
}

function getCanaryModelUrl(filename: string) {
  return `https://huggingface.co/${CANARY_MODEL_REPOSITORY}/resolve/${CANARY_MODEL_REVISION}/${filename}`;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function isValidModelFile(input: {
  path: string;
  size: number;
  sha256: string;
}) {
  try {
    const fileStat = await stat(input.path);
    return fileStat.isFile() &&
      fileStat.size === input.size &&
      await sha256File(input.path) === input.sha256;
  } catch {
    return false;
  }
}

async function downloadModelFile(input: {
  directory: string;
  fetcher: typeof fetch;
  name: string;
  size: number;
  sha256: string;
}) {
  const targetPath = path.join(input.directory, input.name);
  if (await isValidModelFile({ ...input, path: targetPath })) {
    return targetPath;
  }

  await unlink(targetPath).catch(() => {});
  const temporaryPath = `${targetPath}.${process.pid}.download`;
  await unlink(temporaryPath).catch(() => {});

  const response = await input.fetcher(getCanaryModelUrl(input.name), {
    redirect: "follow",
    signal: AbortSignal.timeout(15 * 60_000)
  });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${CANARY_MODEL_NAME} model file ${input.name}.`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > 0 && declaredLength !== input.size) {
    throw new Error(`Unexpected size for ${CANARY_MODEL_NAME} model file ${input.name}.`);
  }

  try {
    const file = await open(temporaryPath, "w", 0o600);
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let bytesWritten = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        bytesWritten += value.byteLength;
        if (bytesWritten > input.size) {
          throw new Error(`Unexpected size for ${CANARY_MODEL_NAME} model file ${input.name}.`);
        }

        hash.update(value);
        await file.write(value);
      }
      await file.sync();
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      await file.close();
    }

    if (bytesWritten !== input.size || hash.digest("hex") !== input.sha256) {
      throw new Error(`Integrity check failed for ${CANARY_MODEL_NAME} model file ${input.name}.`);
    }

    await rename(temporaryPath, targetPath);
    return targetPath;
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function createRecognizerConfig(input: {
  decoder: string;
  encoder: string;
  language: CanaryLanguage;
  tokens: string;
}): OfflineRecognizerConfig {
  return {
    featConfig: {
      sampleRate: CANARY_SAMPLE_RATE,
      featureDim: 80
    },
    modelConfig: {
      canary: {
        encoder: input.encoder,
        decoder: input.decoder,
        srcLang: input.language,
        tgtLang: input.language,
        usePnc: 1
      },
      tokens: input.tokens,
      numThreads: Math.max(1, Math.min(4, availableParallelism() - 1)),
      provider: "cpu",
      debug: 0
    }
  };
}
async function loadCanaryRuntime() {
  const overrides = getCanaryModelOverrides();
  const directory = overrides.directory ?? getCanaryModelDirectory();
  const filesToDownload = overrides.files ?? CANARY_MODEL_FILES;
  const fetcher = overrides.fetcher ?? fetch;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const downloadResults = await Promise.allSettled(
    filesToDownload.map((file) => downloadModelFile({ directory, fetcher, ...file }))
  );
  const failedDownload = downloadResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failedDownload) {
    throw failedDownload.reason;
  }
  const downloaded = downloadResults.map((result) =>
    (result as PromiseFulfilledResult<string>).value
  );
  const files = Object.fromEntries(
    filesToDownload.map((file, index) => [file.name, downloaded[index]])
  );
  const config = createRecognizerConfig({
    encoder: files["encoder.int8.onnx"],
    decoder: files["decoder.int8.onnx"],
    tokens: files["tokens.txt"],
    language: "en"
  });
  const recognizer = overrides.createRecognizer
    ? await overrides.createRecognizer(config)
    : await import("sherpa-onnx-node").then((sherpaOnnx) => {
      const Recognizer = sherpaOnnx.OfflineRecognizer ?? sherpaOnnx.default.OfflineRecognizer;
      return Recognizer.createAsync(config);
    });

  return { config, recognizer };
}

export async function ensureCanaryModelReady() {
  const store = getCanaryStore();
  if (store.runtime) {
    return store.runtime;
  }

  if (store.loading) {
    return store.loading;
  }

  store.loading = loadCanaryRuntime().then(
    (runtime) => {
      store.runtime = runtime;
      store.loading = null;
      return runtime;
    },
    (error) => {
      store.loading = null;
      throw error;
    }
  );
  return store.loading;
}

function normalizeTranscriptWord(word: string) {
  return word.toLocaleLowerCase().replace(/^\p{P}+|\p{P}+$/gu, "");
}

export function mergeCanaryTranscripts(current: string, next: string) {
  const left = current.trim();
  const right = next.trim();
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const leftWords = left.split(/\s+/);
  const rightWords = right.split(/\s+/);
  const maxOverlap = Math.min(16, leftWords.length, rightWords.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const leftTail = leftWords.slice(-overlap).map(normalizeTranscriptWord);
    const rightHead = rightWords.slice(0, overlap).map(normalizeTranscriptWord);
    if (leftTail.every((word, index) => word && word === rightHead[index])) {
      return [...leftWords, ...rightWords.slice(overlap)].join(" ");
    }
  }

  return `${left} ${right}`;
}

export async function transcribeWithCanary(
  samples: Float32Array,
  language: CanaryLanguage
) {
  const runtime = await ensureCanaryModelReady();
  runtime.config.modelConfig.canary.srcLang = language;
  runtime.config.modelConfig.canary.tgtLang = language;
  runtime.recognizer.setConfig(runtime.config);

  const chunkSize = CANARY_CHUNK_SECONDS * CANARY_SAMPLE_RATE;
  const overlapSize = CANARY_CHUNK_OVERLAP_SECONDS * CANARY_SAMPLE_RATE;
  let transcript = "";

  for (let start = 0; start < samples.length;) {
    const end = Math.min(samples.length, start + chunkSize);
    const stream = runtime.recognizer.createStream();
    stream.acceptWaveform({
      sampleRate: CANARY_SAMPLE_RATE,
      samples: samples.slice(start, end)
    });
    const result = await runtime.recognizer.decodeAsync(stream);
    transcript = mergeCanaryTranscripts(transcript, result.text);
    if (end === samples.length) {
      break;
    }
    start = end - overlapSize;
  }

  return transcript.trim();
}

export function resetCanaryModelForTests() {
  const scope = globalThis as typeof globalThis & {
    [CANARY_STORE_KEY]?: CanaryStore;
    [CANARY_OVERRIDES_KEY]?: CanaryModelOverrides;
  };
  delete scope[CANARY_STORE_KEY];
  delete scope[CANARY_OVERRIDES_KEY];
}

export function configureCanaryModelForTests(overrides: CanaryModelOverrides) {
  const scope = globalThis as typeof globalThis & {
    [CANARY_OVERRIDES_KEY]?: CanaryModelOverrides;
  };
  scope[CANARY_OVERRIDES_KEY] = overrides;
}
