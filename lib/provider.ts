import OpenAI from "openai";

import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import { estimateTextTokens } from "@/lib/tokenization";
import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderProfile,
  ProviderProfileWithApiKey
} from "@/lib/types";

function createClient(settings: ProviderProfile, apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: settings.apiBaseUrl
  });
}

function toResponsesInput(messages: PromptMessage[]) {
  return messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");
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

  return {
    extra_body: {
      thinking: {
        type: settings.reasoningSummaryEnabled ? "enabled" : "disabled"
      }
    }
  } as const;
}

function normalizeProviderText(text: string) {
  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "\n");
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
  purpose: "compaction" | "test";
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

    const text = normalizeProviderText(getResponseText(response));

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

  const text = normalizeProviderText(
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
}): AsyncGenerator<ChatStreamEvent, { answer: string; thinking: string; usage: {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
} }, void> {
  const { settings, promptMessages } = input;
  const client = createClient(settings, settings.apiKey);
  let answer = "";
  let thinking = "";
  let usage: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  } = {
    inputTokens: estimateTextTokens(promptMessages.map((message) => message.content).join("\n\n"))
  };

  if (settings.apiMode === "responses") {
    const reasoning = buildReasoningConfig(settings);
    const stream = await client.responses.create({
      model: settings.model,
      input: toResponsesInput(promptMessages),
      stream: true,
      temperature: settings.temperature,
      max_output_tokens: settings.maxOutputTokens,
      reasoning
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const text = normalizeProviderText(String(event.delta ?? ""));
        answer += text;
        yield { type: "answer_delta", text };
      }

      if (
        event.type === "response.reasoning_summary_text.delta" ||
        event.type === "response.reasoning_text.delta"
      ) {
        const text = "delta" in event ? normalizeProviderText(String(event.delta ?? "")) : "";
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
          summary?: Array<{ text?: string }>;
        };

        if (item.type === "reasoning" && Array.isArray(item.summary)) {
          const combined = normalizeProviderText(item.summary.map((part) => part.text ?? "").join(""));

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

    yield {
      type: "usage",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens
    };

    return { answer, thinking, usage };
  }

  const stream = await client.chat.completions.create({
    model: settings.model,
    messages: promptMessages,
    stream: true,
    temperature: settings.temperature,
    max_completion_tokens: settings.maxOutputTokens,
    ...buildChatCompletionsOptions(settings)
  });

  for await (const chunk of stream) {
    const reasoningDelta = normalizeProviderText(
      "reasoning_content" in (chunk.choices[0]?.delta ?? {})
        ? String(
            (chunk.choices[0]?.delta as { reasoning_content?: string }).reasoning_content ?? ""
          )
        : ""
    );
    const delta = normalizeProviderText(chunk.choices[0]?.delta?.content ?? "");

    if (reasoningDelta) {
      thinking += reasoningDelta;
      yield { type: "thinking_delta", text: reasoningDelta };
    }

    if (delta) {
      answer += delta;
      yield { type: "answer_delta", text: delta };
    }

    if (chunk.usage) {
      usage = {
        inputTokens: chunk.usage.prompt_tokens,
        outputTokens: chunk.usage.completion_tokens
      };
    }
  }

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
  };

  return { answer, thinking, usage };
}
