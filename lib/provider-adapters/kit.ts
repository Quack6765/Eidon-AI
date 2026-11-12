import {
  withDateContextUserMessage,
  withToolResultImagesAsUserMessages
} from "@/lib/provider-message-formatting";
import { setActiveTokenizer, estimatePromptTokens } from "@/lib/tokenization";
import { stripThinkingDelimiters } from "@/lib/thinking-delimiter-parsing";
import type {
  ChatStreamEvent,
  PromptMessage,
  ReasoningEffort,
  RuntimeProviderProfile
} from "@/lib/types";
import {
  LOW_EFFORT_PURPOSES,
  type ProviderStreamInput,
  type ProviderStreamResult,
  type ProviderTextInput
} from "@/lib/provider-adapters/types";

function downgradeForTextPurpose(
  settings: RuntimeProviderProfile,
  purpose: ProviderTextInput["purpose"]
): RuntimeProviderProfile {
  if (!LOW_EFFORT_PURPOSES.has(purpose)) {
    return settings;
  }
  return {
    ...settings,
    reasoningEffort: (settings.reasoningEffort === "none" ? "none" : "low") as ReasoningEffort,
    reasoningSummaryEnabled: false
  };
}

export function normalizeAdapterPromptMessages(messages: PromptMessage[]): PromptMessage[] {
  return withDateContextUserMessage(withToolResultImagesAsUserMessages(messages));
}

export async function runAdapterText(
  input: ProviderTextInput,
  run: (settings: RuntimeProviderProfile) => Promise<string>
): Promise<string> {
  const text = stripThinkingDelimiters(
    await run(downgradeForTextPurpose(input.settings, input.purpose))
  );
  if (!text.trim()) {
    throw new Error("Provider returned an empty response");
  }
  return text;
}

export type AdapterUsageEvents = "kit" | "vendor" | "none";

export type AdapterStreamOptions = {
  normalizePromptMessages: boolean;
  usageEvents: AdapterUsageEvents;
};

export function adapterStream(
  options: AdapterStreamOptions,
  vendor: (
    input: ProviderStreamInput
  ) => AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void>
): (
  input: ProviderStreamInput
) => AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  return async function* (input: ProviderStreamInput) {
    setActiveTokenizer(input.settings.tokenizerModel ?? "gpt-tokenizer");
    const streamInput = options.normalizePromptMessages
      ? { ...input, promptMessages: normalizeAdapterPromptMessages(input.promptMessages) }
      : input;
    const delegate = vendor(streamInput);
    let usageEmitted = false;
    let result: ProviderStreamResult | undefined;
    try {
      while (true) {
        const next = await delegate.next();
        if (next.done) {
          result = next.value;
          break;
        }
        if (next.value.type === "usage") {
          usageEmitted = true;
        }
        yield next.value;
      }
    } finally {
      await delegate.return(undefined as unknown as ProviderStreamResult);
    }
    if (options.usageEvents === "kit" && !usageEmitted && result) {
      result.usage.inputTokens ||= estimatePromptTokens(streamInput.promptMessages);
      yield {
        type: "usage",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.reasoningTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens
      };
    }
    return result as ProviderStreamResult;
  };
}
