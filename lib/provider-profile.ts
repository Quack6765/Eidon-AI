import {
  PROVIDER_CATALOG,
  type ApiMode,
  type ProviderConnectionMode,
  type ProviderKind,
  type ProviderPresetId,
  type ProcessingMode,
  type ReasoningParameterMode,
  type ReasoningEffort,
  type VisionMode
} from "@/lib/provider-catalog";
import { modelMatchesPrefix } from "@/lib/model-capabilities";

export type ProviderConnectionStatus = "disconnected" | "connected" | "expired";

export type ProviderProfileCore = {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  compactionThreshold: number;
  freshTailCount: number;
  tokenizerModel: "gpt-tokenizer" | "off";
  safetyMarginTokens: number;
  leafSourceTokenLimit: number;
  leafMinMessageCount: number;
  mergedMinNodeCount: number;
  mergedTargetTokens: number;
  visionMode: VisionMode;
  providerPresetId: ProviderPresetId | null;
  createdAt: string;
  updatedAt: string;
};

export type OpenAiCompatibleProviderConfig = {
  apiBaseUrl: string;
  apiMode: ApiMode;
  processingMode: ProcessingMode;
  reasoningParameterMode: ReasoningParameterMode;
};

export type ProviderProfileCapabilities = {
  supportsTemperature: boolean;
  processingModes: readonly ProcessingMode[];
  reasoningEfforts: readonly ReasoningEffort[];
  explicitDisabledReasoning: boolean;
  outputTokenBudgetIncludesReasoning: boolean;
  longContextPricingThreshold: number | null;
};

export type AnthropicProviderConfig = {
  apiBaseUrl: string;
};

export type ProviderProfile = ProviderProfileCore & (
  | {
      providerKind: "openai_compatible";
      providerConfig: OpenAiCompatibleProviderConfig;
    }
  | {
      providerKind: "anthropic";
      providerConfig: AnthropicProviderConfig;
    }
  | {
      providerKind: "github_copilot";
      providerConfig: Record<string, never>;
    }
);

export type ProviderCredentials = {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
};

export type ProviderConnectionMetadata = {
  expiresAt?: string | null;
  refreshExpiresAt?: string | null;
  accountLabel?: string | null;
};

export type RuntimeProviderProfile = ProviderProfile & {
  credentials: ProviderCredentials;
  connectionMetadata: ProviderConnectionMetadata;
};

export type ProviderConnectionSummary = {
  mode: ProviderConnectionMode;
  status: ProviderConnectionStatus;
  accountLabel: string | null;
  expiresAt: string | null;
};

export type ProviderProfileSummary = ProviderProfile & {
  connection: ProviderConnectionSummary;
};

export function getProviderApiMode(profile: ProviderProfile): ApiMode {
  return profile.providerKind === "openai_compatible"
    ? profile.providerConfig.apiMode
    : "chat_completions";
}

export function getProviderApiBaseUrl(profile: ProviderProfile) {
  return profile.providerKind === "github_copilot"
    ? ""
    : profile.providerConfig.apiBaseUrl;
}

export function getProviderApiKey(profile: RuntimeProviderProfile) {
  return profile.credentials.apiKey ?? "";
}

export function getProviderProcessingMode(profile: ProviderProfile): ProcessingMode {
  return profile.providerKind === "openai_compatible"
    ? profile.providerConfig.processingMode
    : "standard";
}

export function resolveProviderProfileCapabilities(
  profile: ProviderProfile
): ProviderProfileCapabilities {
  const isOfficialEndpoint =
    profile.providerKind === "openai_compatible" &&
    profile.providerConfig.apiBaseUrl.trim().replace(/\/+$/, "").toLowerCase() ===
      "https://api.openai.com/v1";
  const hasExtendedReasoning = isOfficialEndpoint && modelMatchesPrefix(profile.model, "gpt-5.6");
  const reasoningEfforts = ["none", "low", "medium", "high", "xhigh"] as const;

  return {
    supportsTemperature:
      PROVIDER_CATALOG[profile.providerKind].editor.sampling && !isOfficialEndpoint,
    processingModes: isOfficialEndpoint ? ["standard", "fast"] : [],
    reasoningEfforts: hasExtendedReasoning
      ? [...reasoningEfforts, "max"]
      : reasoningEfforts,
    explicitDisabledReasoning: hasExtendedReasoning,
    outputTokenBudgetIncludesReasoning: hasExtendedReasoning,
    longContextPricingThreshold: hasExtendedReasoning ? 272000 : null
  };
}

export function getProviderConnectionSummary(
  profile: RuntimeProviderProfile
): ProviderConnectionSummary {
  const mode = PROVIDER_CATALOG[profile.providerKind].connectionMode;
  const hasCredential = mode === "api_key"
    ? Boolean(profile.credentials.apiKey)
    : Boolean(profile.credentials.accessToken);
  const expiresAt = profile.connectionMetadata.expiresAt ?? null;
  const expiry = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const status: ProviderConnectionStatus = !hasCredential
    ? "disconnected"
    : Number.isFinite(expiry) && expiry <= Date.now()
      ? "expired"
      : "connected";

  return {
    mode,
    status,
    accountLabel: profile.connectionMetadata.accountLabel ?? null,
    expiresAt
  };
}

export function toProviderProfileSummary(
  profile: RuntimeProviderProfile
): ProviderProfileSummary {
  const { credentials: _credentials, connectionMetadata: _metadata, ...publicProfile } = profile;
  return {
    ...publicProfile,
    connection: getProviderConnectionSummary(profile)
  };
}

export function isProviderKind(value: string): value is ProviderKind {
  return value in PROVIDER_CATALOG;
}
