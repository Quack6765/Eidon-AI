import OpenAI from "openai";

import { getAttachmentDataUrl } from "@/lib/attachments";
import { resolveCapabilities } from "@/lib/model-capabilities";
import { getProviderApiBaseUrl, getProviderApiMode } from "@/lib/provider-profile";
import type { PromptMessage, ProviderProfile } from "@/lib/types";

export function createOpenAIClient(settings: ProviderProfile, apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: getProviderApiBaseUrl(settings)
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

export function buildOpenAIResponsesInput(messages: PromptMessage[]): any[] {
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

function usesThinkingReplay(settings: ProviderProfile) {
  const apiMode = getProviderApiMode(settings);
  if (apiMode !== "chat_completions") {
    return false;
  }

  const caps = resolveCapabilities(settings.model, apiMode);
  return caps.thinkingReplay;
}

export function buildOpenAIChatCompletionMessages(messages: PromptMessage[], settings?: ProviderProfile): any[] {
  const replayReasoningContent = settings ? usesThinkingReplay(settings) : false;

  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId ?? "",
        content: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const assistantMessage: Record<string, unknown> = {
        role: "assistant" as const,
        content: typeof message.content === "string" && message.content.trim() ? message.content : null,
        tool_calls: message.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      };

      if (replayReasoningContent && message.reasoningContent?.trim()) {
        assistantMessage.reasoning_content = message.reasoningContent;
        if (assistantMessage.content === null) {
          assistantMessage.content = "";
        }
      }

      return assistantMessage;
    }

    if (message.role === "assistant" && replayReasoningContent && message.reasoningContent?.trim()) {
      return {
        role: "assistant" as const,
        content: toChatCompletionContentParts(message.content),
        reasoning_content: message.reasoningContent
      };
    }

    return {
      role: message.role,
      content: toChatCompletionContentParts(message.content)
    };
  });
}
