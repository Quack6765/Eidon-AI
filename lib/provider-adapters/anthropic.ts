import {
  callAnthropicText,
  streamAnthropicResponse
} from "@/lib/anthropic";
import { withDateContextUserMessage } from "@/lib/provider-message-formatting";
import { adapterStream, runAdapterText } from "@/lib/provider-adapters/kit";
import Anthropic from "@anthropic-ai/sdk";
import { providerHttpOptions } from "@/lib/provider-http";
import { getOpenCodeSessionHeaders, getProviderApiBaseUrl, getProviderApiKey } from "@/lib/provider-profile";
import type { RuntimeProviderProfile } from "@/lib/types";
import type { ProviderTextInput } from "@/lib/provider-adapters/types";

export function callAnthropicAdapterText(input: ProviderTextInput) {
  return runAdapterText(input, (settings) =>
    callAnthropicText({
      settings,
      messages: withDateContextUserMessage([{ role: "user", content: input.prompt }]),
      conversationId: input.conversationId,
      abortSignal: input.abortSignal
    })
  );
}

export async function discoverAnthropicModels(settings: RuntimeProviderProfile) {
  const client = new Anthropic({
    apiKey: getProviderApiKey(settings),
    baseURL: getProviderApiBaseUrl(settings),
    defaultHeaders: getOpenCodeSessionHeaders(settings),
    ...providerHttpOptions
  });
  const models = await client.models.list();
  return models.data.map((model) => ({
    id: model.id,
    name: model.display_name,
    maxContextWindowTokens: null
  }));
}

export const streamAnthropicAdapterResponse = adapterStream(
  { normalizePromptMessages: true, usageEvents: "vendor" },
  (input) => streamAnthropicResponse({
    settings: input.settings,
    promptMessages: input.promptMessages,
    tools: input.tools,
    conversationId: input.conversationId,
    abortSignal: input.abortSignal
  })
);
