import { resolveCapabilities, supportsVisibleReasoning } from "@/lib/model-capabilities";
import {
  getProviderApiKey,
  getProviderApiMode,
  resolveProviderProfileCapabilities
} from "@/lib/provider-profile";
import { estimatePromptTokens, setActiveTokenizer } from "@/lib/tokenization";
import { normalizeLineBreaks } from "@/lib/text-utils";
import {
  buildOpenAIChatCompletionMessages,
  buildOpenAIResponsesInput,
  createOpenAIClient
} from "@/lib/provider-adapters/openai-message-formatting";
import { withDateContextUserMessage } from "@/lib/provider-message-formatting";
import {
  getResponseOutputItemMessageText,
  getResponseText,
  mergeRecoveredStreamText
} from "@/lib/provider-response-parsing";
import { createTextToolCallInterceptor } from "@/lib/tool-call-text-parsing";
import {
  createThinkingDelimiterInterceptor,
  stripThinkingDelimiters
} from "@/lib/thinking-delimiter-parsing";
import type {
  ChatStreamEvent,
  ProviderProfile,
  ProviderResponseItem,
  ProviderToolCall,
  ReasoningEffort,
  RuntimeProviderProfile
} from "@/lib/types";
import type {
  ProviderStreamInput,
  ProviderStreamResult,
  ProviderTextInput,
  ProviderTextPurpose
} from "@/lib/provider-adapters/types";

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

const LOW_EFFORT_PURPOSES: ReadonlySet<ProviderTextPurpose> = new Set(["title", "web_search_planning", "research_planning", "speech_cleanup"]);

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

  const client = createOpenAIClient(profile, getProviderApiKey(profile));

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
  const contextualPromptMessages = withDateContextUserMessage(promptMessages);
  setActiveTokenizer(settings.tokenizerModel ?? "gpt-tokenizer");

  const client = createOpenAIClient(settings, getProviderApiKey(settings));
  const abortController = new AbortController();
  const signal = input.abortSignal ?? abortController.signal;
  let answer = "";
  let thinking = "";
  const responseItems: ProviderResponseItem[] = [];
  let usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  } = {
    inputTokens: estimatePromptTokens(contextualPromptMessages)
  };

  if (getProviderApiMode(settings) === "responses") {
    const reasoning = buildReasoningConfig(settings);

    const responseCreateParams: Record<string, unknown> = {
      model: settings.model,
      input: buildOpenAIResponsesInput(contextualPromptMessages),
      stream: true,
      max_output_tokens: settings.maxOutputTokens,
      reasoning,
      ...buildRequestParameters(settings)
    };

    let stream: AsyncIterable<any>;
    if (input.tools?.length) {
      const toResponseTools = (strict: boolean) =>
        input.tools!.map((tool) => ({
          type: "function",
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters ?? {},
          strict
        }));
      responseCreateParams.tools = toResponseTools(true);

      try {
        stream = await client.responses.create(
          responseCreateParams as any,
          { signal }
        ) as unknown as AsyncIterable<any>;
      } catch (createError) {
        const isSchemaError =
          createError instanceof Error &&
          (createError.message.includes("strict") ||
            createError.message.includes("schema") ||
            createError.message.includes("additionalProperties") ||
            (createError as any).status === 400);
        if (!isSchemaError) throw createError;
        responseCreateParams.tools = toResponseTools(false);
        stream = await client.responses.create(
          responseCreateParams as any,
          { signal }
        ) as unknown as AsyncIterable<any>;
      }
    } else {
      stream = await client.responses.create(
        responseCreateParams as any,
        { signal }
      ) as unknown as AsyncIterable<any>;
    }

    const pendingToolCalls = new Map<string, { name: string; arguments: string }>();

    try {
      for await (const event of stream) {
        if (event.type === "response.function_call_arguments.delta") continue;

        if (
          event.type === "response.output_text.delta" ||
          event.type === "response.content_part.delta"
        ) {
          const text = normalizeLineBreaks(String(event.delta ?? ""));
          answer += text;
          yield { type: "answer_delta", text };
        }

        if (
          event.type === "response.reasoning_summary_text.delta" ||
          event.type === "response.reasoning_text.delta"
        ) {
          const text = "delta" in event
            ? normalizeLineBreaks(String(event.delta ?? ""))
            : "";
          thinking += text;
          yield { type: "thinking_delta", text };
        }

        if (event.type === "response.completed" && event.response?.usage) {
          usage = {
            inputTokens: event.response.usage.input_tokens ?? 0,
            outputTokens: event.response.usage.output_tokens ?? 0,
            reasoningTokens: event.response.usage.output_tokens_details?.reasoning_tokens
          };
        }

        if (event.type === "response.output_item.done") {
          const item = event.item as ProviderResponseItem & {
            type?: string;
            name?: string;
            arguments?: string;
            call_id?: string;
            summary?: Array<{ text?: string }>;
            content?: unknown[];
          };

          responseItems.push(item);

          if (item.type === "function_call" && item.call_id) {
            pendingToolCalls.set(item.call_id, {
              name: item.name ?? "",
              arguments: item.arguments ?? ""
            });
          }

          if (item.type === "reasoning" && Array.isArray(item.summary)) {
            const combined = normalizeLineBreaks(
              item.summary.map((part) => part.text ?? "").join("")
            );
            const recovery = mergeRecoveredStreamText(thinking, combined);
            thinking = recovery.nextText;
            if (recovery.delta) {
              yield { type: "thinking_delta", text: recovery.delta };
            }
          }

          if (item.type === "message") {
            const recovery = mergeRecoveredStreamText(
              answer,
              getResponseOutputItemMessageText(item)
            );
            answer = recovery.nextText;
            if (recovery.delta) {
              yield { type: "answer_delta", text: recovery.delta };
            }
          }
        }
      }
    } finally {
      if (!abortController.signal.aborted) abortController.abort();
    }

    yield {
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens
    };

    const toolCalls = [...pendingToolCalls].map(([id, call]) => ({
      id,
      name: call.name,
      arguments: call.arguments
    }));
    return {
      answer,
      thinking,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      responseItems: responseItems.length ? responseItems : undefined,
      usage
    };
  }

  const chatCreateParams: Record<string, unknown> = {
    model: settings.model,
    messages: buildOpenAIChatCompletionMessages(contextualPromptMessages, settings),
    stream: true,
    max_completion_tokens: settings.maxOutputTokens,
    ...buildChatCompletionsOptions(settings),
    ...buildRequestParameters(settings)
  };

  if (input.tools?.length) {
    chatCreateParams.tools = input.tools;
  }

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
          outputTokens: chunk.usage.completion_tokens
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

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
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
