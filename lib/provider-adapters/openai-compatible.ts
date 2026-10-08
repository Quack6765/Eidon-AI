import { resolveCapabilities, supportsVisibleReasoning } from "@/lib/model-capabilities";
import { isOfficialOpenAiApiBaseUrl } from "@/lib/provider-catalog";
import {
  getProviderApiBaseUrl,
  getProviderApiKey,
  getProviderApiMode,
  resolveProviderProfileCapabilities
} from "@/lib/provider-profile";
import { estimatePromptTokens, setActiveTokenizer } from "@/lib/tokenization";
import { normalizeLineBreaks } from "@/lib/text-utils";
import {
  buildOpenAIChatCompletionMessages,
  buildOpenAIResponsesInput,
  buildOpenAIResponsesTools,
  createOpenAIClient
} from "@/lib/provider-adapters/openai-message-formatting";
import { withDateContextUserMessage, withToolResultImagesAsUserMessages } from "@/lib/provider-message-formatting";
import { getResponseText } from "@/lib/provider-response-parsing";
import { createTextToolCallInterceptor } from "@/lib/tool-call-text-parsing";
import {
  createThinkingDelimiterInterceptor,
  stripThinkingDelimiters
} from "@/lib/thinking-delimiter-parsing";
import type {
  ChatStreamEvent,
  ProviderProfile,
  ProviderToolCall,
  ReasoningEffort,
  RuntimeProviderProfile
} from "@/lib/types";
import type {
  ProviderStreamInput,
  ProviderStreamResult,
  ProviderTextInput,
  ProviderUsage
} from "@/lib/provider-adapters/types";
import { LOW_EFFORT_PURPOSES } from "@/lib/provider-adapters/types";
import { streamOpenAIResponses } from "@/lib/provider-adapters/openai-responses-stream";

function normalizeReasoningEffort(
  settings: ProviderProfile
): "none" | "low" | "medium" | "high" | "xhigh" | "max" | undefined {
  const effort = settings.reasoningEffort;
  const capabilities = resolveProviderProfileCapabilities(settings);
  if (effort === "none") {
    return capabilities.explicitDisabledReasoning ? "none" : undefined;
  }
  if (effort === "xhigh" || effort === "max") {
    return capabilities.reasoningEfforts.includes("max") ? effort : "high";
  }

  return effort;
}

function buildReasoningConfig(settings: ProviderProfile) {
  if (!supportsVisibleReasoning(settings.model, getProviderApiMode(settings))) {
    return undefined;
  }

  const effort = normalizeReasoningEffort(settings);
  if (!effort) {
    return undefined;
  }

  if (effort === "none") return { effort } as const;

  if (settings.reasoningSummaryEnabled) {
    return {
      effort,
      summary: "auto"
    } as const;
  }

  return {
    effort
  } as const;
}

function buildChatCompletionsOptions(settings: ProviderProfile) {
  const apiMode = getProviderApiMode(settings);
  if (!supportsVisibleReasoning(settings.model, apiMode)) {
    return {};
  }

  const caps = resolveCapabilities(settings.model, apiMode);

  if (settings.reasoningEffort === "none") {
    if (caps.extraBody === "thinking") {
      return {
        thinking: {
          type: "disabled"
        }
      } as const;
    }
    return {};
  }

  const effort = normalizeReasoningEffort(settings);

  if (settings.providerKind === "openai_compatible" &&
    settings.providerConfig.reasoningParameterMode === "mirrored") {
    const ollamaEffort = settings.reasoningSummaryEnabled ? effort : "none";

    return {
      reasoning_effort: ollamaEffort,
      reasoning: {
        effort: ollamaEffort
      }
    } as const;
  }

  if (caps.strictExtraRejection) {
    return {};
  }

  if (caps.extraBody === "reasoning_effort") {
    return effort
      ? {
          thinking: {
            type: "enabled"
          },
          reasoning_effort: effort
        } as const
      : {};
  }

  if (caps.extraBody === "thinking") {
    return {
      thinking: {
        type: settings.reasoningSummaryEnabled ? "enabled" : "disabled"
      }
    } as const;
  }

  return {};
}

function buildRequestParameters(settings: ProviderProfile) {
  const capabilities = resolveProviderProfileCapabilities(settings);
  return {
    ...(capabilities.supportsTemperature
      ? { temperature: settings.temperature }
      : {}),
    ...(settings.providerKind === "openai_compatible" &&
    capabilities.processingModes.length
      ? {
          service_tier:
            settings.providerConfig.processingMode === "fast"
              ? "priority"
              : "default"
        }
      : {})
  };
}

function buildPromptCacheParameters(settings: ProviderProfile, conversationId?: string) {
  return conversationId && isOfficialOpenAiApiBaseUrl(getProviderApiBaseUrl(settings))
    ? { prompt_cache_key: conversationId }
    : {};
}

export async function callOpenAiCompatibleText(input: ProviderTextInput) {
  const { settings } = input;
  const profile = LOW_EFFORT_PURPOSES.has(input.purpose)
    ? {
        ...settings,
        reasoningEffort: (settings.reasoningEffort === "none" ? "none" : "low") as ReasoningEffort,
        reasoningSummaryEnabled: false
      }
    : settings;
  const contextualPrompt = withDateContextUserMessage([{ role: "user", content: input.prompt }]);

  const client = createOpenAIClient(profile, getProviderApiKey(profile), input.conversationId);

  if (getProviderApiMode(profile) === "responses") {
    const reasoning = buildReasoningConfig(profile);
    const request = {
      model: profile.model,
      input: buildOpenAIResponsesInput(contextualPrompt),
      max_output_tokens: Math.min(profile.maxOutputTokens, 4000),
      reasoning,
      ...buildRequestParameters(profile)
    };
    const response = input.abortSignal
      ? await client.responses.create(request as any, { signal: input.abortSignal })
      : await client.responses.create(request as any);

    const text = stripThinkingDelimiters(normalizeLineBreaks(getResponseText(response)));

    if (!text.trim()) {
      throw new Error("Provider returned an empty response");
    }

    return text;
  }

  const request = {
    model: profile.model,
    messages: buildOpenAIChatCompletionMessages(contextualPrompt, profile),
    max_completion_tokens: Math.min(profile.maxOutputTokens, 4000),
    ...buildChatCompletionsOptions(profile),
    ...buildRequestParameters(profile)
  } as any;
  const response = input.abortSignal
    ? await client.chat.completions.create(request, { signal: input.abortSignal })
    : await client.chat.completions.create(request);

  const text = stripThinkingDelimiters(
    normalizeLineBreaks(
      typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0]?.message?.content
        : ""
    )
  );

  if (!text.trim()) {
    throw new Error("Provider returned an empty response");
  }

  return text;
}

export async function discoverOpenAiCompatibleModels(settings: RuntimeProviderProfile) {
  const client = createOpenAIClient(settings, getProviderApiKey(settings));
  const models = await client.models.list();
  return models.data.map((model) => ({
    id: model.id,
    name: model.id,
    maxContextWindowTokens: null
  }));
}

export async function* streamOpenAiCompatibleResponse(
  input: ProviderStreamInput
): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  const { settings, promptMessages } = input;
  const contextualPromptMessages = withDateContextUserMessage(withToolResultImagesAsUserMessages(promptMessages));
  setActiveTokenizer(settings.tokenizerModel ?? "gpt-tokenizer");

  const client = createOpenAIClient(settings, getProviderApiKey(settings), input.conversationId);

  if (getProviderApiMode(settings) === "responses") {
    const reasoning = buildReasoningConfig(settings);

    const responseCreateParams: Record<string, unknown> = {
      model: settings.model,
      input: buildOpenAIResponsesInput(contextualPromptMessages),
      stream: true,
      max_output_tokens: settings.maxOutputTokens,
      reasoning,
      ...buildRequestParameters(settings),
      ...buildPromptCacheParameters(settings, input.conversationId)
    };

    if (input.tools?.length) {
      responseCreateParams.tools = buildOpenAIResponsesTools(input.tools);
    }

    return yield* streamOpenAIResponses({
      client,
      params: responseCreateParams,
      promptMessages: contextualPromptMessages,
      abortSignal: input.abortSignal
    });
  }

  const chatCreateParams: Record<string, unknown> = {
    model: settings.model,
    messages: buildOpenAIChatCompletionMessages(contextualPromptMessages, settings),
    stream: true,
    max_completion_tokens: settings.maxOutputTokens,
    ...buildChatCompletionsOptions(settings),
    ...buildRequestParameters(settings),
    ...buildPromptCacheParameters(settings, input.conversationId)
  };

  if (isOfficialOpenAiApiBaseUrl(getProviderApiBaseUrl(settings))) {
    chatCreateParams.stream_options = { include_usage: true };
  }

  if (input.tools?.length) {
    chatCreateParams.tools = input.tools;
  }

  const abortController = new AbortController();
  const signal = input.abortSignal ?? abortController.signal;
  let answer = "";
  let thinking = "";
  let usage: ProviderUsage = {};

  const stream = await client.chat.completions.create(
    chatCreateParams as any,
    { signal }
  ) as unknown as AsyncIterable<any>;

  const thinkingInterceptor = createThinkingDelimiterInterceptor();
  const answerInterceptor = createTextToolCallInterceptor();
  const toolCallChunks = new Map<string, { name: string; arguments: string }>();

  try {
    for await (const chunk of stream) {
      const rawDelta = chunk.choices[0]?.delta ?? {};
      const reasoningValue =
        "reasoning_content" in rawDelta
          ? (rawDelta as { reasoning_content?: string }).reasoning_content
          : "thinking" in rawDelta
            ? (rawDelta as { thinking?: string }).thinking
            : "reasoning" in rawDelta
              ? (rawDelta as { reasoning?: string }).reasoning
              : "";
      const reasoningDelta = normalizeLineBreaks(String(reasoningValue ?? ""));
      const delta = normalizeLineBreaks(chunk.choices[0]?.delta?.content ?? "");

      if (reasoningDelta) {
        thinking += reasoningDelta;
        yield { type: "thinking_delta", text: reasoningDelta };
      }

      if (delta) {
        const { answer: answerText, thinking: thinkingText } = thinkingInterceptor.feed(delta);
        if (thinkingText) {
          thinking += thinkingText;
          yield { type: "thinking_delta", text: thinkingText };
        }
        const emitted = answerInterceptor.feed(answerText);
        if (emitted) {
          yield { type: "answer_delta", text: emitted };
        }
      }

      if (rawDelta.tool_calls) {
        for (const toolCallChunk of rawDelta.tool_calls) {
          const index = String(toolCallChunk.index ?? 0);
          const existing = toolCallChunks.get(index);
          if (!existing) {
            toolCallChunks.set(index, {
              name: toolCallChunk.function?.name ?? "",
              arguments: toolCallChunk.function?.arguments ?? ""
            });
          } else {
            if (toolCallChunk.function?.name) {
              existing.name = toolCallChunk.function.name;
            }
            if (toolCallChunk.function?.arguments) {
              existing.arguments += toolCallChunk.function.arguments;
            }
          }
        }
      }

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens
        };
      }
    }
  } finally {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  }

  const thinkingTail = thinkingInterceptor.flush();
  if (thinkingTail.thinking) {
    thinking += thinkingTail.thinking;
    yield { type: "thinking_delta", text: thinkingTail.thinking };
  }
  if (thinkingTail.answer) {
    const tailEmitted = answerInterceptor.feed(thinkingTail.answer);
    if (tailEmitted) {
      yield { type: "answer_delta", text: tailEmitted };
    }
  }
  const answerTail = answerInterceptor.flush();
  if (answerTail) {
    yield { type: "answer_delta", text: answerTail };
  }
  answer = answerInterceptor.answer;

  usage.inputTokens ||= estimatePromptTokens(contextualPromptMessages);

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens
  };

  const toolCalls: ProviderToolCall[] = [];
  for (const [, call] of toolCallChunks) {
    toolCalls.push({ id: `call_${toolCalls.length}`, name: call.name, arguments: call.arguments });
  }
  for (const textToolCall of answerInterceptor.toolCalls) {
    toolCalls.push(textToolCall);
  }

  return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };

}
