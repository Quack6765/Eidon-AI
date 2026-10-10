import type OpenAI from "openai";

import {
  getResponseOutputItemMessageText,
  mergeRecoveredStreamText
} from "@/lib/provider-response-parsing";
import { normalizeLineBreaks } from "@/lib/text-utils";
import { estimatePromptTokens } from "@/lib/tokenization";
import type { ProviderStreamResult, ProviderUsage } from "@/lib/provider-adapters/types";
import type { ChatStreamEvent, PromptMessage, ProviderResponseItem } from "@/lib/types";

export async function* streamOpenAIResponses(input: {
  client: OpenAI;
  params: Record<string, unknown>;
  promptMessages: PromptMessage[];
  abortSignal?: AbortSignal;
}): AsyncGenerator<ChatStreamEvent, ProviderStreamResult, void> {
  const abortController = new AbortController();
  const signal = input.abortSignal ?? abortController.signal;
  let answer = "";
  let thinking = "";
  const responseItems: ProviderResponseItem[] = [];
  let usage: ProviderUsage = {};

  const stream = await input.client.responses.create(
    { ...input.params, stream: true } as any,
    { signal }
  ) as unknown as AsyncIterable<any>;

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
          reasoningTokens: event.response.usage.output_tokens_details?.reasoning_tokens,
          cacheReadTokens: event.response.usage.input_tokens_details?.cached_tokens
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

  usage.inputTokens ||= estimatePromptTokens(input.promptMessages);

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningTokens,
    cacheReadTokens: usage.cacheReadTokens
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
