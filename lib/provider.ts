import OpenAI from "openai";

import { estimateTextTokens } from "@/lib/tokenization";
import type { AppSettings, ChatStreamEvent, PromptMessage } from "@/lib/types";

function createClient(settings: AppSettings, apiKey: string) {
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
  effort: AppSettings["reasoningEffort"]
): "low" | "medium" | "high" {
  if (effort === "xhigh") {
    return "high";
  }

  return effort;
}

function buildReasoningConfig(settings: AppSettings) {
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
  settings: AppSettings & { apiKey: string };
  prompt: string;
  purpose: "compaction" | "test";
  conversationId?: string;
}) {
  const { settings } = input;
  const client = createClient(settings, settings.apiKey);

  if (settings.apiMode === "responses") {
    const response = await client.responses.create({
      model: settings.model,
      input: input.prompt,
      max_output_tokens: Math.min(settings.maxOutputTokens, 4000),
      reasoning: buildReasoningConfig(settings)
    });

    const text = getResponseText(response);

    if (!text.trim()) {
      throw new Error("Provider returned an empty response");
    }

    return text;
  }

  const response = await client.chat.completions.create({
    model: settings.model,
    messages: [{ role: "user", content: input.prompt }],
    temperature: settings.temperature,
    max_completion_tokens: Math.min(settings.maxOutputTokens, 4000)
  });

  const text = response.choices[0]?.message?.content ?? "";

  if (!text.trim()) {
    throw new Error("Provider returned an empty response");
  }

  return text;
}

export async function* streamProviderResponse(input: {
  settings: AppSettings & { apiKey: string };
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
    const stream = await client.responses.create({
      model: settings.model,
      input: toResponsesInput(promptMessages),
      stream: true,
      temperature: settings.temperature,
      max_output_tokens: settings.maxOutputTokens,
      reasoning: buildReasoningConfig(settings)
    });

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        const text = event.delta ?? "";
        answer += text;
        yield { type: "answer_delta", text };
      }

      if (
        event.type === "response.reasoning_summary_text.delta" ||
        event.type === "response.reasoning_text.delta"
      ) {
        const text = "delta" in event ? String(event.delta ?? "") : "";
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
          const combined = item.summary.map((part) => part.text ?? "").join("");

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
    max_completion_tokens: settings.maxOutputTokens
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";

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
