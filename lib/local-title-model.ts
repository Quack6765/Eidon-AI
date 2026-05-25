import { pipeline, env, type TextGenerationPipeline } from "@huggingface/transformers";
import path from "node:path";

const MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct";
const SYSTEM_PROMPT = [
  "Generate a short conversation title from the user's first message.",
  "Return only the title.",
  "Prefer 2 to 4 words.",
  "Keep it natural and specific.",
  "Do not use quotes, markdown, labels, or trailing punctuation.",
].join("\n");

let pipelineInstance: TextGenerationPipeline | null = null;
let loadingPromise: Promise<TextGenerationPipeline> | null = null;

function getCacheDir(): string {
  const dataDir = process.env.EIDON_DATA_DIR || path.join(process.cwd(), ".data");
  return path.join(dataDir, "model-cache");
}

async function loadPipeline(): Promise<TextGenerationPipeline> {
  if (pipelineInstance) {
    return pipelineInstance;
  }

  if (loadingPromise) {
    return loadingPromise;
  }

  env.cacheDir = getCacheDir();

  loadingPromise = pipeline("text-generation", MODEL_ID, {
    dtype: "q4",
    device: "cpu",
  }).then((p) => {
    pipelineInstance = p;
    return p;
  }).catch((err) => {
    loadingPromise = null;
    throw err;
  });

  return loadingPromise;
}

export async function runLocalTitleInference(userMessage: string): Promise<string> {
  const generator = await loadPipeline();

  const output = await generator(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    {
      max_new_tokens: 12,
      temperature: 0.3,
      do_sample: true,
      repetition_penalty: 1.2,
    }
  );

  const messages = output[0].generated_text;
  const lastMessage = messages[messages.length - 1];
  return String(lastMessage.content).trim();
}
