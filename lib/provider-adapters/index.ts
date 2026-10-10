import { PROVIDER_CATALOG, type ProviderKind } from "@/lib/provider-catalog";
import { canUseProviderProfile } from "@/lib/provider-profile";
import { callAnthropicAdapterText, discoverAnthropicModels, streamAnthropicAdapterResponse } from "@/lib/provider-adapters/anthropic";
import { chatgptSubscriptionConnectionFlows } from "@/lib/provider-adapters/chatgpt-provider-connection";
import {
  callChatgptSubscriptionText,
  discoverChatgptSubscriptionModels,
  getChatgptSubscriptionUsageLimits,
  streamChatgptSubscriptionResponse
} from "@/lib/provider-adapters/chatgpt-subscription";
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
  },
  chatgpt_subscription: {
    getReadinessError: (profile) =>
      profile.credentials.accessToken
        ? null
        : "Connect an account in settings before starting a chat",
    supportsStreamRetry: true,
    connectionFlows: chatgptSubscriptionConnectionFlows,
    discoverModels: discoverChatgptSubscriptionModels,
    getUsageLimits: getChatgptSubscriptionUsageLimits,
    callText: callChatgptSubscriptionText,
    stream: streamChatgptSubscriptionResponse
  }
} satisfies Record<ProviderKind, ProviderAdapter>;

export function getProviderAdapter(kind: ProviderKind): ProviderAdapter {
  return PROVIDER_ADAPTERS[kind];
}

export const PRIVATE_PROVIDER_MESSAGE =
  "This provider is private to the administrator who connected it. Choose another provider.";

export function getProviderReadinessError(
  profile: Parameters<ProviderAdapter["getReadinessError"]>[0],
  userId: string | null
) {
  return getProviderAdapter(profile.providerKind).getReadinessError(profile) ??
    (canUseProviderProfile(profile, userId) ? null : PRIVATE_PROVIDER_MESSAGE);
}

export function getProviderConnectionMode(kind: ProviderKind) {
  return PROVIDER_CATALOG[kind].connectionMode;
}
