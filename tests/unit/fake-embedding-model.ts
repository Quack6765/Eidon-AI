import { vi } from "vitest";

export const FAKE_VOCAB = [
  "montreal",
  "typescript",
  "budget",
  "paris",
  "coffee",
  "kubernetes",
  "garden",
  "violin",
  "invoice",
  "marathon",
  "sailing",
  "chess"
];

export const fakeEmbeddingState = {
  ready: true,
  disabled: false,
  modelId: "fake-model-v1",
  embedCalls: 0
};

export function fakeEmbed(text: string): Float32Array {
  const vector = new Float32Array(FAKE_VOCAB.length);
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    const index = FAKE_VOCAB.indexOf(word);
    if (index >= 0) vector[index] += 1;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
  }
  return vector;
}

export function createFakeEmbeddingModule() {
  return {
    getEmbeddingModelId: () => fakeEmbeddingState.modelId,
    isEmbeddingDisabled: () => fakeEmbeddingState.disabled,
    isEmbeddingModelReady: () => fakeEmbeddingState.ready && !fakeEmbeddingState.disabled,
    awaitEmbeddingModel: async () => fakeEmbeddingState.ready && !fakeEmbeddingState.disabled,
    initEmbeddingModel: vi.fn(async () => {
      if (fakeEmbeddingState.disabled) return false;
      fakeEmbeddingState.ready = true;
      return true;
    }),
    disposeEmbeddingModel: vi.fn(() => {
      fakeEmbeddingState.ready = false;
    }),
    embedTexts: vi.fn(async (texts: string[]) => {
      if (!fakeEmbeddingState.ready || fakeEmbeddingState.disabled) return null;
      fakeEmbeddingState.embedCalls += 1;
      return texts.map(fakeEmbed);
    })
  };
}

export function resetFakeEmbeddingState() {
  fakeEmbeddingState.ready = true;
  fakeEmbeddingState.disabled = false;
  fakeEmbeddingState.modelId = "fake-model-v1";
  fakeEmbeddingState.embedCalls = 0;
}
