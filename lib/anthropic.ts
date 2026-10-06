import Anthropic from "@anthropic-ai/sdk";

import { getAttachmentDataUrl } from "@/lib/attachments";
import { env } from "@/lib/env";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import { providerHttpOptions } from "@/lib/provider-http";
import { getOpenCodeSessionHeaders, getProviderApiBaseUrl, getProviderApiKey, getProviderApiMode } from "@/lib/provider-profile";
import { normalizeLineBreaks } from "@/lib/text-utils";
import { estimatePromptTokens } from "@/lib/tokenization";
import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderProfile,
  RuntimeProviderProfile,
  ProviderToolCall,
  ReasoningEffort,
  ToolDefinition
} from "@/lib/types";

type AnthropicEffort = "low" | "medium" | "high" | "max";

const EFFORT_BY_REASONING: Record<Exclude<ReasoningEffort, "none">, AnthropicEffort> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max"
};

export function mapReasoningEffortToAnthropic(effort: ReasoningEffort): AnthropicEffort | null {
  if (effort === "none") {
    return null;
  }
  return EFFORT_BY_REASONING[effort];
}

function contentToText(content: PromptMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => ("text" in part ? part.text : "")).join("");
}

export function extractSystemPrompt(messages: PromptMessage[]): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => contentToText(message.content))
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

function toUserContent(content: PromptMessage["content"]): string | Anthropic.ContentBlockParam[] {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text } as Anthropic.ContentBlockParam;
    }

    const dataUrl = getAttachmentDataUrl(part);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mimeType as Anthropic.Base64ImageSource["media_type"],
        data: base64
      }
    } as Anthropic.ContentBlockParam;
  });
}

function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function toAnthropicMessages(messages: PromptMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  function push(role: "user" | "assistant", content: string | Anthropic.ContentBlockParam[]) {
    const previous = result[result.length - 1];
    const incoming = Array.isArray(content) ? content : [{ type: "text", text: content } as Anthropic.ContentBlockParam];

    if (previous && previous.role === role) {
      const previousBlocks = Array.isArray(previous.content)
        ? previous.content
        : [{ type: "text", text: previous.content } as Anthropic.ContentBlockParam];
      previous.content = [...previousBlocks, ...incoming];
      return;
    }

    result.push({ role, content });
  }

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      push("user", [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? "",
          content: contentToText(message.content)
        } as Anthropic.ContentBlockParam
      ]);
      continue;
    }

    if (message.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];

      if (message.reasoningSignature && message.reasoningContent?.trim() && message.toolCalls?.length) {
        blocks.push({
          type: "thinking",
          thinking: message.reasoningContent,
          signature: message.reasoningSignature
        } as Anthropic.ContentBlockParam);
      }

      const text = contentToText(message.content);
      if (text.trim()) {
        blocks.push({ type: "text", text } as Anthropic.ContentBlockParam);
      }

      for (const toolCall of message.toolCalls ?? []) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: safeParseJson(toolCall.arguments)
        } as Anthropic.ContentBlockParam);
      }

      if (blocks.length) {
        push("assistant", blocks);
      }
      continue;
    }

    push("user", toUserContent(message.content));
  }

  return result;
}

export function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: (tool.function.parameters ?? { type: "object" }) as Anthropic.Tool.InputSchema
  }));
}

function cacheControl() {
  return env.EIDON_ANTHROPIC_CACHE_TTL === "1h"
    ? { type: "ephemeral", ttl: "1h" }
    : { type: "ephemeral" };
}

function toBlocks(content: Anthropic.MessageParam["content"]): Anthropic.ContentBlockParam[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function countBlocks(messages: Anthropic.MessageParam[]) {
  return messages.reduce((total, message) => total + toBlocks(message.content).length, 0);
}

function withCacheControl(messages: Anthropic.MessageParam[], volatileBlockCount: number): Anthropic.MessageParam[] {
  const target = countBlocks(messages) - volatileBlockCount - 1;
  if (target < 0) {
    return messages;
  }

  let offset = 0;

  return messages.map((message) => {
    const blocks = toBlocks(message.content);
    const markIndex = target - offset;
    offset += blocks.length;

    if (markIndex < 0 || markIndex >= blocks.length) {
      return message;
    }

    return {
      ...message,
      content: blocks.map((block, index) =>
        index === markIndex ? ({ ...block, cache_control: cacheControl() } as Anthropic.ContentBlockParam) : block
      )
    };
  });
}

export function buildAnthropicRequest(input: {
  settings: ProviderProfile;
  messages: PromptMessage[];
  tools?: ToolDefinition[];
}): Record<string, unknown> {
  const system = extractSystemPrompt(input.messages);
  const volatileBlockCount = countBlocks(toAnthropicMessages(input.messages.filter((message) => message.volatile)));
  const messages = withCacheControl(toAnthropicMessages(input.messages), volatileBlockCount);
  const effort = supportsVisibleReasoning(input.settings.model, getProviderApiMode(input.settings))
    ? mapReasoningEffortToAnthropic(input.settings.reasoningEffort)
    : null;

  const params: Record<string, unknown> = {
    model: input.settings.model,
    max_tokens: input.settings.maxOutputTokens,
    messages
  };

  if (system) {
    params.system = [{ type: "text", text: system, cache_control: cacheControl() }];
  }

  if (effort) {
    params.thinking = { type: "adaptive" };
    params.output_config = { effort };
  } else {
    params.temperature = input.settings.temperature;
  }

  if (input.tools?.length) {
    params.tools = toAnthropicTools(input.tools);
  }

  return params;
}

type AnthropicStreamResult = {
  answer: string;
  thinking: string;
  toolCalls?: ProviderToolCall[];
  reasoningSignature?: string;
  usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number };
};

function createAnthropicClient(settings: RuntimeProviderProfile, conversationId?: string): Anthropic {
  return new Anthropic({
    apiKey: getProviderApiKey(settings),
    baseURL: getProviderApiBaseUrl(settings),
    defaultHeaders: getOpenCodeSessionHeaders(settings, conversationId),
    ...providerHttpOptions
  });
}

export async function* streamAnthropicResponse(input: {
  settings: RuntimeProviderProfile;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  conversationId?: string;
  client?: Anthropic;
}): AsyncGenerator<ChatStreamEvent, AnthropicStreamResult, void> {
  const client = input.client ?? createAnthropicClient(input.settings, input.conversationId);
  const showThinking = input.settings.reasoningSummaryEnabled;
  const params = buildAnthropicRequest({
    settings: input.settings,
    messages: input.promptMessages,
    tools: input.tools
  });

  let answer = "";
  let thinking = "";
  let reasoningSignature: string | undefined;
  const usage: AnthropicStreamResult["usage"] = {
    inputTokens: estimatePromptTokens(input.promptMessages)
  };
  const toolUseBlocks = new Map<number, { id: string; name: string; json: string }>();

  const stream = client.messages.stream(
    params as never,
    input.abortSignal ? { signal: input.abortSignal } : undefined
  ) as AsyncIterable<Record<string, any>>;

  for await (const event of stream) {
    if (event.type === "message_start") {
      const startUsage = event.message?.usage;
      if (startUsage) {
        const reportedInputTokens =
          (startUsage.input_tokens ?? 0) +
          (startUsage.cache_read_input_tokens ?? 0) +
          (startUsage.cache_creation_input_tokens ?? 0);
        usage.inputTokens = Math.max(reportedInputTokens, usage.inputTokens ?? 0);
        usage.cacheReadTokens = startUsage.cache_read_input_tokens ?? usage.cacheReadTokens;
        usage.cacheCreationTokens = startUsage.cache_creation_input_tokens ?? usage.cacheCreationTokens;
      }
    } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      toolUseBlocks.set(event.index, {
        id: event.content_block.id,
        name: event.content_block.name,
        json: ""
      });
    } else if (event.type === "content_block_delta") {
      const delta = event.delta ?? {};
      if (delta.type === "text_delta") {
        const text = normalizeLineBreaks(String(delta.text ?? ""));
        answer += text;
        yield { type: "answer_delta", text };
      } else if (delta.type === "thinking_delta") {
        const text = String(delta.thinking ?? "");
        thinking += text;
        if (showThinking) {
          yield { type: "thinking_delta", text: normalizeLineBreaks(text) };
        }
      } else if (delta.type === "signature_delta") {
        reasoningSignature = String(delta.signature ?? "");
      } else if (delta.type === "input_json_delta") {
        const block = toolUseBlocks.get(event.index);
        if (block) {
          block.json += String(delta.partial_json ?? "");
        }
      }
    } else if (event.type === "message_delta") {
      usage.outputTokens = event.usage?.output_tokens ?? usage.outputTokens;
    }
  }

  yield {
    type: "usage",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens
  };

  const toolCalls: ProviderToolCall[] = [...toolUseBlocks.values()].map((block) => ({
    id: block.id,
    name: block.name,
    arguments: block.json || "{}"
  }));

  return {
    answer,
    thinking,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    reasoningSignature,
    usage
  };
}

export async function callAnthropicText(input: {
  settings: RuntimeProviderProfile;
  messages: PromptMessage[];
  conversationId?: string;
  client?: Anthropic;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const client = input.client ?? createAnthropicClient(input.settings, input.conversationId);
  const params = buildAnthropicRequest({ settings: input.settings, messages: input.messages });
  const request = {
    ...params,
    max_tokens: Math.min(input.settings.maxOutputTokens, 4000)
  } as never;
  const response = (input.abortSignal
    ? await client.messages.create(request, { signal: input.abortSignal })
    : await client.messages.create(request)) as { content?: Array<{ type: string; text?: string }> };

  return normalizeLineBreaks(
    (response.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
  );
}
