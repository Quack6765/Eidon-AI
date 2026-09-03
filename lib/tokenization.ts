import type { Message, MessageAttachment, PromptMessage, RuntimeProviderProfile } from "@/lib/types";
import { createTokenizer, Tokenizer } from "@/lib/token-estimator";

let activeTokenizer: Tokenizer | null = null;

function getActiveTokenEstimator() {
  if (!activeTokenizer) {
    activeTokenizer = createTokenizer("gpt-tokenizer");
  }
  return activeTokenizer;
}

export function setActiveTokenizer(engine: string) {
  activeTokenizer = createTokenizer(engine);
}

export function estimateTextTokens(value: string) {
  return getActiveTokenEstimator().estimateTextTokens(value);
}

export function estimatePromptTokens(messages: PromptMessage[]) {
  return getActiveTokenEstimator().estimatePromptTokens(messages);
}

export function estimatePromptContentTokens(content: PromptMessage["content"]) {
  return getActiveTokenEstimator().estimatePromptContentTokens(content);
}

export function estimateAttachmentTokens(attachments: MessageAttachment[]) {
  return getActiveTokenEstimator().estimateAttachmentTokens(attachments);
}

export function estimateMessageTokens(message: Pick<Message, "content" | "thinkingContent" | "attachments">) {
  return getActiveTokenEstimator().estimateMessageTokens(message);
}

export function computeCompactionLimit(settings: RuntimeProviderProfile): number {
  const allowedPromptTokens =
    settings.modelContextLimit - settings.maxOutputTokens - settings.safetyMarginTokens;
  return Math.floor(allowedPromptTokens * settings.compactionThreshold);
}
