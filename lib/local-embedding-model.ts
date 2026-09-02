import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import path from "node:path";

const DEFAULT_MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

const PIPELINE_KEY = Symbol.for("eidon:embedding-model-pipeline");
const LOADING_KEY = Symbol.for("eidon:embedding-model-loading");
const MODEL_KEY = Symbol.for("eidon:embedding-model-id");

type GlobalStore = Record<
  symbol,
  FeatureExtractionPipeline | Promise<FeatureExtractionPipeline> | string | null | undefined
>;

function getGlobal(): GlobalStore {
  return globalThis as GlobalStore;
}

function getPipelineInstance(): FeatureExtractionPipeline | null {
  return (getGlobal()[PIPELINE_KEY] as FeatureExtractionPipeline | null | undefined) ?? null;
}

function setPipelineInstance(value: FeatureExtractionPipeline | null) {
  getGlobal()[PIPELINE_KEY] = value;
}

function getLoadingPromise(): Promise<FeatureExtractionPipeline> | null {
  return (getGlobal()[LOADING_KEY] as Promise<FeatureExtractionPipeline> | null | undefined) ?? null;
}

function setLoadingPromise(value: Promise<FeatureExtractionPipeline> | null) {
  getGlobal()[LOADING_KEY] = value;
}

function getCacheDir(): string {
  const dataDir = process.env.EIDON_DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(dataDir, "model-cache");
}

export function getEmbeddingModelId(): string {
  return process.env.EIDON_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL_ID;
}

export function isEmbeddingDisabled(): boolean {
  return process.env.EIDON_EMBEDDING_DISABLED === "1";
}

export function isEmbeddingModelReady(): boolean {
  return getPipelineInstance() !== null && getGlobal()[MODEL_KEY] === getEmbeddingModelId();
}

async function loadPipeline(): Promise<FeatureExtractionPipeline> {
  const existing = getPipelineInstance();
  if (existing) {
    return existing;
  }

  const loading = getLoadingPromise();
  if (loading) {
    return loading;
  }

  env.cacheDir = getCacheDir();
  const modelId = getEmbeddingModelId();

  console.log(`[embedding-model] Loading ${modelId} (dtype=q8, device=cpu)...`);

  const promise = (pipeline("feature-extraction", modelId, {
    dtype: "q8",
    device: "cpu"
  }) as Promise<FeatureExtractionPipeline>).then((p) => {
    setPipelineInstance(p);
    getGlobal()[MODEL_KEY] = modelId;
    return p;
  }).catch((err) => {
    setLoadingPromise(null);
    throw err;
  });

  setLoadingPromise(promise);
  return promise;
}

export async function awaitEmbeddingModel(): Promise<boolean> {
  if (isEmbeddingDisabled()) return false;
  if (isEmbeddingModelReady()) return true;
  const loading = getLoadingPromise();
  if (!loading) return false;
  try {
    await loading;
    return isEmbeddingModelReady();
  } catch {
    return false;
  }
}

export async function initEmbeddingModel(): Promise<boolean> {
  if (isEmbeddingDisabled()) {
    return false;
  }
  try {
    await loadPipeline();
    console.log(`[embedding-model] ${getEmbeddingModelId()} ready`);
    return true;
  } catch (err) {
    console.error("[embedding-model] Failed to load:", err);
    return false;
  }
}

export function disposeEmbeddingModel(): void {
  const instance = getPipelineInstance();
  const loading = getLoadingPromise();

  if (!instance && !loading) {
    return;
  }

  if (instance) {
    instance.dispose?.();
  }

  setPipelineInstance(null);
  setLoadingPromise(null);
  getGlobal()[MODEL_KEY] = null;
  console.log(`[embedding-model] ${getEmbeddingModelId()} unloaded`);
}

export async function embedTexts(texts: string[]): Promise<Float32Array[] | null> {
  if (!texts.length) {
    return [];
  }
  const extractor = getPipelineInstance();
  if (!extractor || isEmbeddingDisabled() || !isEmbeddingModelReady()) {
    return null;
  }

  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const dims = output.dims;
  const dim = dims[dims.length - 1];
  const data = output.data as Float32Array;
  const vectors: Float32Array[] = [];
  for (let index = 0; index < texts.length; index += 1) {
    vectors.push(Float32Array.from(data.subarray(index * dim, (index + 1) * dim)));
  }
  return vectors;
}
