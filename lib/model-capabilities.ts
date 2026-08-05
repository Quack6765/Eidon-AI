import type { ApiMode, VisionMode } from "@/lib/types";
import {
  MODEL_REGISTRY,
  MODEL_REQUEST_QUIRKS,
  type ModelCapabilityOverride,
  type ModelRequestQuirk
} from "@/lib/model-registry";

type CapabilityFlag = boolean | { apiModes: ApiMode[] };

type ResolvedCapabilities = {
  reasoning: boolean;
  vision: boolean;
  supportsTemperature: boolean;
  thinkingReplay: boolean;
  extraBody: "none" | "thinking" | "reasoning_effort";
  strictExtraRejection: boolean;
};

function bareModelId(model: string) {
  const normalized = model.trim().toLowerCase();
  return normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;
}

const DEFAULT_CAPABILITIES: ResolvedCapabilities = {
  reasoning: false,
  vision: false,
  supportsTemperature: true,
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
  const bareModel = bareModelId(model);

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

  const requestQuirk: Partial<ModelRequestQuirk> | undefined =
    MODEL_REQUEST_QUIRKS.find((candidate) => bareModel.startsWith(candidate.prefix));
  if (requestQuirk) {
    const { prefix: _, ...quirks } = requestQuirk;
    Object.assign(resolved, quirks);
  }

  if (userOverrides) {
    Object.assign(resolved, userOverrides);
  }

  return resolved;
}

export function supportsVisibleReasoning(model: string, apiMode: ApiMode): boolean {
  return resolveCapabilities(model, apiMode).reasoning;
}

export function modelMatchesPrefix(model: string, prefix: string): boolean {
  return bareModelId(model).startsWith(prefix.trim().toLowerCase());
}

export function supportsImageInput(model: string, apiMode: ApiMode): boolean {
  return resolveCapabilities(model, apiMode).vision;
}

export function getDefaultVisionMode(model: string, apiMode: ApiMode): VisionMode {
  return supportsImageInput(model, apiMode) ? "native" : "none";
}
