import { encode } from "gpt-tokenizer";

import type { Message, MessageAttachment, PromptMessage } from "@/lib/types";

export function estimateTextTokens(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return encode(value).length;
}

export function estimatePromptTokens(messages: PromptMessage[]) {
  return messages.reduce((total, message) => {
    return total + estimatePromptContentTokens(message.content) + 12;
  }, 0);
}

export function estimatePromptContentTokens(content: PromptMessage["content"]) {
  if (typeof content === "string") {
    return estimateTextTokens(content);
  }

  return content.reduce((total, part) => {
    if (part.type === "text") {
      return total + estimateTextTokens(part.text);
    }

    return total + estimateTextTokens(`[Image attachment: ${part.filename}]`);
  }, 0);
}

export function estimateAttachmentTokens(attachments: MessageAttachment[]) {
  return attachments.reduce((total, attachment) => {
    if (attachment.kind === "image") {
      return total + estimateTextTokens(`[Image attachment: ${attachment.filename}]`);
    }

    return total + estimateTextTokens(
      `Attached file: ${attachment.filename}\n${attachment.extractedText}`
    );
  }, 0);
}

export function estimateMessageTokens(message: Pick<Message, "content" | "thinkingContent" | "attachments">) {
  return (
    estimateTextTokens(`${message.content}\n${message.thinkingContent}`) +
    estimateAttachmentTokens(message.attachments ?? [])
  );
}
