import { pipeline, env, type TextGenerationPipeline } from "@huggingface/transformers";
import path from "node:path";

const MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";

const PIPELINE_KEY = Symbol.for("eidon:title-model-pipeline");
const LOADING_KEY = Symbol.for("eidon:title-model-loading");

type GlobalStore = Record<symbol, TextGenerationPipeline | Promise<TextGenerationPipeline> | null | undefined>;

function getGlobal(): GlobalStore {
  return globalThis as GlobalStore;
}

function getPipelineInstance(): TextGenerationPipeline | null {
  return (getGlobal()[PIPELINE_KEY] as TextGenerationPipeline | null | undefined) ?? null;
}

function setPipelineInstance(value: TextGenerationPipeline | null) {
  getGlobal()[PIPELINE_KEY] = value;
}

function getLoadingPromise(): Promise<TextGenerationPipeline> | null {
  return (getGlobal()[LOADING_KEY] as Promise<TextGenerationPipeline> | null | undefined) ?? null;
}

function setLoadingPromise(value: Promise<TextGenerationPipeline> | null) {
  getGlobal()[LOADING_KEY] = value;
}

function getCacheDir(): string {
  const dataDir = process.env.EIDON_DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(dataDir, "model-cache");
}

async function loadPipeline(): Promise<TextGenerationPipeline> {
  const existing = getPipelineInstance();
  if (existing) {
    return existing;
  }

  const loading = getLoadingPromise();
  if (loading) {
    return loading;
  }

  env.cacheDir = getCacheDir();

  console.log(`[title-model] Loading ${MODEL_ID} (dtype=q4, device=cpu)...`);

  const promise = (pipeline("text-generation", MODEL_ID, {
    dtype: "q4",
    device: "cpu",
  }) as Promise<TextGenerationPipeline>).then((p) => {
    setPipelineInstance(p);
    return p;
  }).catch((err) => {
    setLoadingPromise(null);
    throw err;
  });

  setLoadingPromise(promise);
  return promise;
}

export async function initTitleModel(): Promise<void> {
  try {
    await loadPipeline();
    console.log("[title-model] SmolLM2-360M-Instruct ready");
  } catch (err) {
    console.error("[title-model] Failed to load:", err);
  }
}

export function disposeTitleModel(): void {
  const instance = getPipelineInstance();
  const loading = getLoadingPromise();

  if (!instance && !loading) {
    console.log("[title-model] SmolLM2-360M-Instruct not loaded, nothing to unload");
    return;
  }

  if (instance) {
    instance.dispose?.();
  }

  setPipelineInstance(null);
  setLoadingPromise(null);
  console.log("[title-model] SmolLM2-360M-Instruct unloaded");
}

function buildPrompt(userMessage: string): string {
  const truncated = userMessage.length > 120 ? userMessage.slice(0, 120) : userMessage;
  return [
    'Title: How do I bake chocolate chip cookies? -> Chocolate Chip Cookies',
    'Title: What are the best practices for React state management? -> React State Management',
    'Title: Help me fix a Python IndexError in my loop -> Python IndexError Fix',
    'Title: Explain quantum computing in simple terms -> Quantum Computing Explained',
    'Title: What is the difference between let and const in JavaScript? -> JavaScript Let vs Const',
    `Title: ${truncated} ->`,
  ].join('\n');
}

export async function runLocalTitleInference(userMessage: string): Promise<string> {
  const generator = await loadPipeline();
  const prompt = buildPrompt(userMessage);

  const output = await generator(prompt, {
    max_new_tokens: 6,
    do_sample: false,
    repetition_penalty: 1.4,
  });

  const fullText = String(
    typeof output[0].generated_text === "string"
      ? output[0].generated_text
      : JSON.stringify(output[0].generated_text)
  );

  const afterArrow = fullText.split("->").pop()?.trim() ?? "";
  const firstLine = afterArrow.split("\n")[0]?.trim() ?? "";
  return firstLine;
}
