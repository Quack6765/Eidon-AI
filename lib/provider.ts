import OpenAI from "openai";

import { getAttachmentDataUrl } from "@/lib/attachments";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import { estimatePromptTokens, setActiveTokenizer } from "@/lib/tokenization";
import { normalizeLineBreaks } from "@/lib/utils";
import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ToolDefinition,
  ProviderToolCall
} from "@/lib/types";

function createClient(settings: ProviderProfile, apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: settings.apiBaseUrl
  });
}

function toResponseContentParts(content: PromptMessage["content"]) {
  const parts = typeof content === "string"
    ? [{ type: "text" as const, text: content }]
    : content;

  return parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "input_text" as const,
        text: part.text
      };
    }

    return {
      type: "input_image" as const,
      image_url: getAttachmentDataUrl(part)
    };
  });
}

function toChatCompletionContentParts(content: PromptMessage["content"]) {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text" as const,
        text: part.text
      };
    }

    return {
      type: "image_url" as const,
      image_url: {
        url: getAttachmentDataUrl(part)
      }
    };
  });
}

function buildResponsesInput(messages: PromptMessage[]): any[] {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          call_id: toolCall.id
        });
      }
      if (typeof message.content === "string" && message.content.trim()) {
        input.push({ role: "assistant", content: toResponseContentParts(message.content) });
      }
      continue;
    }

    input.push({
      role: message.role,
      content: toResponseContentParts(message.content)
    });
  }

  return input;
}

function buildChatCompletionMessages(messages: PromptMessage[]): any[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId ?? "",
        content: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: typeof message.content === "string" && message.content.trim() ? message.content : null,
        tool_calls: message.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      };
    }

    return {
      role: message.role,
      content: toChatCompletionContentParts(message.content)
    };
  });
}

function normalizeReasoningEffort(
  effort: ProviderProfile["reasoningEffort"]
): "low" | "medium" | "high" {
  if (effort === "xhigh") {
    return "high";
  }

  return effort;
}

function buildReasoningConfig(settings: ProviderProfile) {
  if (!supportsVisibleReasoning(settings.model, settings.apiMode)) {
    return undefined;
  }

  const effort = normalizeReasoningEffort(settings.reasoningEffort);

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
  if (!supportsVisibleReasoning(settings.model, settings.apiMode)) {
    return {};
  }

  const effort = normalizeReasoningEffort(settings.reasoningEffort);

  if (settings.apiBaseUrl.includes("ollama.com")) {
    const ollamaEffort = settings.reasoningSummaryEnabled ? effort : "none";

    return {
      extra_body: {
        reasoning_effort: ollamaEffort,
        reasoning: {
          effort: ollamaEffort
        }
      }
    } as const;
  }

  return {
    extra_body: {
      thinking: {
        type: settings.reasoningSummaryEnabled ? "enabled" : "disabled"
      }
    }
  } as const;
}

function getResponseText(output: unknown) {
  if (typeof output === "string") {
    return output;
  }

  if (
    output &&
    typeof output === "object" &&
    "output_text" in output &&
    typeof (output as { output_text?: string }).output_text === "string"
  ) {
    return (output as { output_text: string }).output_text;
  }

  if (
    output &&
    typeof output === "object" &&
    "output" in output &&
    Array.isArray((output as { output?: unknown[] }).output)
  ) {
    return (output as { output: unknown[] }).output
      .flatMap((item) => {
        if (
          item &&
          typeof item === "object" &&
          "content" in item &&
          Array.isArray((item as { content?: unknown[] }).content)
        ) {
          return (item as { content: Array<{ text?: string }> }).content
            .map((part) => part.text ?? "")
            .filter(Boolean);
        }

        return [];
      })
      .join("");
  }

  return "";
}

export async function callProviderText(input: {
  settings: ProviderProfileWithApiKey;
  prompt: string;
  purpose: "compaction" | "test" | "title";
  conversationId?: string;
}) {
  const { settings } = input;
  const client = createClient(settings, settings.apiKey);

  if (settings.apiMode === "responses") {
    const reasoning = buildReasoningConfig(settings);
    const response = await client.responses.create({
      model: settings.model,
      input: input.prompt,
      max_output_tokens: Math.min(settings.maxOutputTokens, 4000),
      reasoning
    });

    const text = normalizeLineBreaks(getResponseText(response));

    if (!text.trim()) {
      throw new Error("Provider returned an empty response");
    }

    return text;
  }

  const response = await client.chat.completions.create({
    model: settings.model,
    messages: [{ role: "user", content: input.prompt }],
    temperature: settings.temperature,
    max_completion_tokens: Math.min(settings.maxOutputTokens, 4000),
    ...buildChatCompletionsOptions(settings)
  });

  const text = normalizeLineBreaks(
    typeof response.choices[0]?.message?.content === "string"
      ? response.choices[0]?.message?.content
      : ""
  );

  if (!text.trim()) {
    throw new Error("Provider returned an empty response");
  }

  return text;
}

export async function* streamProviderResponse(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
}): AsyncGenerator<
  ChatStreamEvent,
  { answer: string; thinking: string; toolCalls?: ProviderToolCall[]; usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } },
  void
> {
  const { settings, promptMessages } = input;
  setActiveTokenizer(settings.tokenizerModel ?? "gpt-tokenizer");
  const client = createClient(settings, settings.apiKey);
  const abortController = new AbortController();
  let answer = "";
  let thinking = "";
  let usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  } = {
    inputTokens: estimatePromptTokens(promptMessages)
  };

  if (settings.apiMode === "responses") {
    const reasoning = buildReasoningConfig(settings);

    const responseCreateParams: Record<string, unknown> = {
      model: settings.model,
      input: buildResponsesInput(promptMessages),
      stream: true,
      temperature: settings.temperature,
      max_output_tokens: settings.maxOutputTokens,
      reasoning
    };

    if (input.tools?.length) {
      const toolsWithStrict = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: true
      }));

      const toolsWithoutStrict = input.tools.map((tool) => ({
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters ?? {},
        strict: false
      }));

      responseCreateParams.tools = toolsWithStrict;

      let stream: AsyncIterable<any>;
      try {
        stream = await client.responses.create(
          responseCreateParams as any,
          { signal: abortController.signal }
        ) as unknown as AsyncIterable<any>;
      } catch (createError) {
        const isSchemaError =
          createError instanceof Error &&
          (createError.message.includes("strict") ||
            createError.message.includes("schema") ||
            createError.message.includes("additionalProperties") ||
            (createError as any).status === 400);

        if (isSchemaError) {
          responseCreateParams.tools = toolsWithoutStrict;
          stream = await client.responses.create(
            responseCreateParams as any,
            { signal: abortController.signal }
          ) as unknown as AsyncIterable<any>;
        } else {
          throw createError;
        }
      }

      const pendingToolCalls = new Map<string, { name: string; arguments: string }>();

      try {
        for await (const event of stream) {
          if (event.type === "response.function_call_arguments.delta") {
            continue;
          }

          if (event.type === "response.output_text.delta") {
            const text = normalizeLineBreaks(String(event.delta ?? ""));
            answer += text;
            yield { type: "answer_delta", text };
          }

          if (
            event.type === "response.reasoning_summary_text.delta" ||
            event.type === "response.reasoning_text.delta"
          ) {
            const text = "delta" in event ? normalizeLineBreaks(String(event.delta ?? "")) : "";
            thinking += text;
            yield { type: "thinking_delta", text };
          }

          if (event.type === "response.completed" && event.response?.usage) {
            usage = {
              inputTokens: event.response.usage.input_tokens,
              outputTokens: event.response.usage.output_tokens,
              reasoningTokens: event.response.usage.output_tokens_details?.reasoning_tokens
            };
          }

          if (event.type === "response.output_item.done") {
            const item = event.item as {
              type?: string;
              name?: string;
              arguments?: string;
              call_id?: string;
              summary?: Array<{ text?: string }>;
            };

            if (item.type === "function_call" && item.call_id) {
              pendingToolCalls.set(item.call_id, {
                name: item.name ?? "",
                arguments: item.arguments ?? ""
              });
            }

            if (item.type === "reasoning" && Array.isArray(item.summary)) {
              const combined = normalizeLineBreaks(item.summary.map((part) => part.text ?? "").join(""));

              if (combined && combined !== thinking) {
                const delta = combined.slice(thinking.length);
                thinking = combined;

                if (delta) {
                  yield { type: "thinking_delta", text: delta };
                }
              }
            }
          }
        }
      } finally {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      }

      yield {
        type: "usage",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens
      };

      const toolCalls: ProviderToolCall[] = [];
      for (const [id, call] of pendingToolCalls) {
        toolCalls.push({ id, name: call.name, arguments: call.arguments });
      }

      return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
    }

    const stream = await client.responses.create(
      responseCreateParams as any,
      { signal: abortController.signal }
    ) as unknown as AsyncIterable<any>;

    const pendingToolCalls = new Map<string, { name: string; arguments: string }>();

    try {
      for await (const event of stream) {
        if (event.type === "response.function_call_arguments.delta") {
          continue;
        }

        if (event.type === "response.output_text.delta") {
          const text = normalizeLineBreaks(String(event.delta ?? ""));
          answer += text;
          yield { type: "answer_delta", text };
        }

        if (
          event.type === "response.reasoning_summary_text.delta" ||
          event.type === "response.reasoning_text.delta"
        ) {
          const text = "delta" in event ? normalizeLineBreaks(String(event.delta ?? "")) : "";
          thinking += text;
          yield { type: "thinking_delta", text };
        }

        if (event.type === "response.completed" && event.response?.usage) {
          usage = {
            inputTokens: event.response.usage.input_tokens,
            outputTokens: event.response.usage.output_tokens,
            reasoningTokens: event.response.usage.output_tokens_details?.reasoning_tokens
          };
        }

        if (event.type === "response.output_item.done") {
          const item = event.item as {
            type?: string;
            name?: string;
            arguments?: string;
            call_id?: string;
            summary?: Array<{ text?: string }>;
          };

          if (item.type === "function_call" && item.call_id) {
            pendingToolCalls.set(item.call_id, {
              name: item.name ?? "",
              arguments: item.arguments ?? ""
            });
          }

          if (item.type === "reasoning" && Array.isArray(item.summary)) {
            const combined = normalizeLineBreaks(item.summary.map((part) => part.text ?? "").join(""));

            if (combined && combined !== thinking) {
              const delta = combined.slice(thinking.length);
              thinking = combined;

              if (delta) {
                yield { type: "thinking_delta", text: delta };
              }
            }
          }
        }
      }
    } finally {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }

    yield {
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens
    };

    const toolCalls: ProviderToolCall[] = [];
    for (const [id, call] of pendingToolCalls) {
      toolCalls.push({ id, name: call.name, arguments: call.arguments });
    }

    return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
  }

  const chatCreateParams: Record<string, unknown> = {
    model: settings.model,
    messages: buildChatCompletionMessages(promptMessages),
    stream: true,
    temperature: settings.temperature,
    max_completion_tokens: settings.maxOutputTokens,
    ...buildChatCompletionsOptions(settings)
  };

  if (input.tools?.length) {
    chatCreateParams.tools = input.tools;
  }

  const stream = await client.chat.completions.create(
    chatCreateParams as any,
    { signal: abortController.signal }
  ) as unknown as AsyncIterable<any>;

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
        answer += delta;
        yield { type: "answer_delta", text: delta };
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

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
  };

  const toolCalls: ProviderToolCall[] = [];
  for (const [, call] of toolCallChunks) {
    toolCalls.push({ id: `call_${toolCalls.length}`, name: call.name, arguments: call.arguments });
  }

  return { answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
}
