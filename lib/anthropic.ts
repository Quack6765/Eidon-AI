import Anthropic from "@anthropic-ai/sdk";

import { getAttachmentDataUrl } from "@/lib/attachments";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import { normalizeLineBreaks } from "@/lib/text-utils";
import { estimatePromptTokens } from "@/lib/tokenization";
import type {
  ChatStreamEvent,
  PromptMessage,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ProviderToolCall,
  ReasoningEffort,
  ToolDefinition
} from "@/lib/types";

type AnthropicEffort = "low" | "medium" | "high" | "max";

const EFFORT_BY_REASONING: Record<Exclude<ReasoningEffort, "none">, AnthropicEffort> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max"
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

function withCacheControl(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length < 2) {
    return messages;
  }

  const cacheIndex = messages.length - 2;

  return messages.map((message, index) => {
    if (index !== cacheIndex || !Array.isArray(message.content) || message.content.length === 0) {
      return message;
    }

    const content = message.content.map((block, blockIndex) =>
      blockIndex === message.content.length - 1
        ? ({ ...block, cache_control: { type: "ephemeral" } } as Anthropic.ContentBlockParam)
        : block
    );

    return { ...message, content };
  });
}

export function buildAnthropicRequest(input: {
  settings: ProviderProfile;
  messages: PromptMessage[];
  tools?: ToolDefinition[];
}): Record<string, unknown> {
  const system = extractSystemPrompt(input.messages);
  const messages = withCacheControl(toAnthropicMessages(input.messages));
  const effort = supportsVisibleReasoning(input.settings.model, input.settings.apiMode)
    ? mapReasoningEffortToAnthropic(input.settings.reasoningEffort)
    : null;

  const params: Record<string, unknown> = {
    model: input.settings.model,
    max_tokens: input.settings.maxOutputTokens,
    messages
  };

  if (system) {
    params.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  }

  if (effort) {
    params.thinking = { type: "adaptive" };
    params.effort = effort;
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
  usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

function createAnthropicClient(settings: ProviderProfileWithApiKey): Anthropic {
  return new Anthropic({ apiKey: settings.apiKey, baseURL: settings.apiBaseUrl });
}

export async function* streamAnthropicResponse(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  client?: Anthropic;
}): AsyncGenerator<ChatStreamEvent, AnthropicStreamResult, void> {
  const client = input.client ?? createAnthropicClient(input.settings);
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
        usage.inputTokens =
          (startUsage.input_tokens ?? 0) +
          (startUsage.cache_read_input_tokens ?? 0) +
          (startUsage.cache_creation_input_tokens ?? 0);
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
    outputTokens: usage.outputTokens
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
  settings: ProviderProfileWithApiKey;
  messages: PromptMessage[];
  client?: Anthropic;
}): Promise<string> {
  const client = input.client ?? createAnthropicClient(input.settings);
  const params = buildAnthropicRequest({ settings: input.settings, messages: input.messages });
  const response = (await client.messages.create({
    ...params,
    max_tokens: Math.min(input.settings.maxOutputTokens, 4000)
  } as never)) as { content?: Array<{ type: string; text?: string }> };

  return normalizeLineBreaks(
    (response.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
  );
}
