import {
  callAnthropicText,
  streamAnthropicResponse
} from "@/lib/anthropic";
import { setActiveTokenizer } from "@/lib/tokenization";
import { withDateContextUserMessage } from "@/lib/provider-message-formatting";
import { stripThinkingDelimiters } from "@/lib/thinking-delimiter-parsing";
import type { ChatStreamEvent, ReasoningEffort, RuntimeProviderProfile } from "@/lib/types";
import Anthropic from "@anthropic-ai/sdk";
import { getProviderApiBaseUrl, getProviderApiKey } from "@/lib/provider-profile";
import type {
  ProviderStreamInput,
  ProviderStreamResult,
  ProviderTextInput,
  ProviderTextPurpose
} from "@/lib/provider-adapters/types";

const LOW_EFFORT_PURPOSES: ReadonlySet<ProviderTextPurpose> = new Set(["title", "web_search_planning", "research_planning", "speech_cleanup"]);

export async function callAnthropicAdapterText(input: ProviderTextInput) {
  const settings = LOW_EFFORT_PURPOSES.has(input.purpose)
    ? {
        ...input.settings,
        reasoningEffort: (input.settings.reasoningEffort === "none" ? "none" : "low") as ReasoningEffort,
        reasoningSummaryEnabled: false
      }
    : input.settings;
  const text = stripThinkingDelimiters(
    await callAnthropicText({
      settings,
      messages: withDateContextUserMessage([{ role: "user", content: input.prompt }]),
      abortSignal: input.abortSignal
    })
  );
  if (!text.trim()) throw new Error("Provider returned an empty response");
  return text;
}

export async function discoverAnthropicModels(settings: RuntimeProviderProfile) {
  const client = new Anthropic({
    apiKey: getProviderApiKey(settings),
    baseURL: getProviderApiBaseUrl(settings)
  });
  const models = await client.models.list();
  return models.data.map((model) => ({
    id: model.id,
    name: model.display_name,
    maxContextWindowTokens: null
  }));
}

export async function* streamAnthropicAdapterResponse(
  input: ProviderStreamInput
): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  setActiveTokenizer(input.settings.tokenizerModel ?? "gpt-tokenizer");
  return yield* streamAnthropicResponse({
    settings: input.settings,
    promptMessages: withDateContextUserMessage(input.promptMessages),
    tools: input.tools,
    abortSignal: input.abortSignal
  });
}
