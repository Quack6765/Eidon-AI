import type { ApiMode, VisionMode } from "@/lib/types";
import { MODEL_REGISTRY, type ModelCapabilityOverride } from "@/lib/model-registry";

type CapabilityFlag = boolean | { apiModes: ApiMode[] };

type ResolvedCapabilities = {
  reasoning: boolean;
  vision: boolean;
  thinkingReplay: boolean;
  extraBody: "none" | "thinking" | "reasoning_effort";
  strictExtraRejection: boolean;
};

const DEFAULT_CAPABILITIES: ResolvedCapabilities = {
  reasoning: false,
  vision: false,
  thinkingReplay: false,
  extraBody: "none",
  strictExtraRejection: false,
};

function resolveCapabilityFlag(flag: CapabilityFlag, apiMode: ApiMode): boolean {
  if (typeof flag === "boolean") return flag;
  return flag.apiModes.includes(apiMode);
}

export function resolveCapabilities(
  model: string,
  apiMode: ApiMode,
  userOverrides?: Partial<ResolvedCapabilities>
): ResolvedCapabilities {
  const normalized = model.trim().toLowerCase();
  const bareModel = normalized.includes("/") ? normalized.slice(normalized.lastIndexOf("/") + 1) : normalized;

  const resolved = { ...DEFAULT_CAPABILITIES };

  const entry: Partial<ModelCapabilityOverride> | undefined =
    MODEL_REGISTRY.find((e) => bareModel.startsWith(e.prefix));

  if (entry) {
    const { prefix: _, ...overrides } = entry;
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        if (key === "reasoning" || key === "vision") {
          (resolved as Record<string, unknown>)[key] = resolveCapabilityFlag(
            value as CapabilityFlag,
            apiMode
          );
        } else {
          (resolved as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  if (userOverrides) {
    Object.assign(resolved, userOverrides);
  }

  return resolved;
}

export function supportsVisibleReasoning(model: string, apiMode: ApiMode): boolean {
  return resolveCapabilities(model, apiMode).reasoning;
}

export function supportsImageInput(model: string, apiMode: ApiMode): boolean {
  return resolveCapabilities(model, apiMode).vision;
}

export function getDefaultVisionMode(model: string, apiMode: ApiMode): VisionMode {
  return supportsImageInput(model, apiMode) ? "native" : "none";
}
