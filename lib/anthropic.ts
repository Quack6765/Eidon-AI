import Anthropic from "@anthropic-ai/sdk";

import { getAttachmentDataUrl } from "@/lib/attachments";
import { supportsVisibleReasoning } from "@/lib/model-capabilities";
import type {
  PromptMessage,
  ProviderProfile,
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

    result.push({ role, content: Array.isArray(content) ? content : content });
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
