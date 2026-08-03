import { PROVIDER_CATALOG, type ProviderKind } from "@/lib/provider-catalog";
import { callAnthropicAdapterText, discoverAnthropicModels, streamAnthropicAdapterResponse } from "@/lib/provider-adapters/anthropic";
import {
  callGithubCopilotText,
  discoverGithubCopilotModels,
  githubCopilotConnectionFlows,
  streamGithubCopilotResponse
} from "@/lib/provider-adapters/github-copilot";
import { callOpenAiCompatibleText, discoverOpenAiCompatibleModels, streamOpenAiCompatibleResponse } from "@/lib/provider-adapters/openai-compatible";
import type { ProviderAdapter } from "@/lib/provider-adapters/types";

const PROVIDER_ADAPTERS = {
  openai_compatible: {
    getReadinessError: (profile) =>
      profile.credentials.apiKey ? null : "Set an API key in settings before starting a chat",
    supportsStreamRetry: true,
    discoverModels: discoverOpenAiCompatibleModels,
    callText: callOpenAiCompatibleText,
    stream: streamOpenAiCompatibleResponse
  },
  github_copilot: {
    getReadinessError: (profile) =>
      profile.credentials.accessToken
        ? null
        : "Connect an account in settings before starting a chat",
    supportsStreamRetry: false,
    connectionFlows: githubCopilotConnectionFlows,
    discoverModels: discoverGithubCopilotModels,
    callText: callGithubCopilotText,
    stream: streamGithubCopilotResponse
  },
  anthropic: {
    getReadinessError: (profile) =>
      profile.credentials.apiKey ? null : "Set an API key in settings before starting a chat",
    supportsStreamRetry: true,
    discoverModels: discoverAnthropicModels,
    callText: callAnthropicAdapterText,
    stream: streamAnthropicAdapterResponse
  }
} satisfies Record<ProviderKind, ProviderAdapter>;

export function getProviderAdapter(kind: ProviderKind): ProviderAdapter {
  return PROVIDER_ADAPTERS[kind];
}

export function getProviderReadinessError(
  profile: Parameters<ProviderAdapter["getReadinessError"]>[0]
) {
  return getProviderAdapter(profile.providerKind).getReadinessError(profile);
}

export function getProviderConnectionMode(kind: ProviderKind) {
  return PROVIDER_CATALOG[kind].connectionMode;
}
