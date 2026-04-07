import type { ApiMode, VisionMode } from "@/lib/types";

function normalizeModel(model: string) {
  return model.trim().toLowerCase();
}

export function supportsVisibleReasoning(model: string, apiMode: ApiMode) {
  const normalized = normalizeModel(model);

  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("glm-5") || normalized.startsWith("glm-4.7")) {
    return true;
  }

  if (normalized.startsWith("kimi-k2")) {
    return true;
  }

  if (apiMode !== "responses") {
    return false;
  }

  if (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("gpt-oss")
  ) {
    return true;
  }

  if (
    normalized.startsWith("gpt-4.1") ||
    normalized.startsWith("gpt-4o") ||
    normalized.startsWith("gpt-3.5")
  ) {
    return false;
  }

  return false;
}

export function supportsImageInput(model: string, apiMode: ApiMode) {
  const normalized = normalizeModel(model);

  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("gpt-4o") ||
    normalized.startsWith("gpt-4.1") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("claude-3") ||
    normalized.startsWith("claude-4") ||
    normalized.startsWith("gemini") ||
    normalized.startsWith("glm-4") ||
    normalized.startsWith("glm-5")
  ) {
    return true;
  }

  if (apiMode === "responses" && normalized.startsWith("gpt-oss")) {
    return true;
  }

  return false;
}

export function getDefaultVisionMode(model: string, apiMode: ApiMode): VisionMode {
  return supportsImageInput(model, apiMode) ? "native" : "none";
}
