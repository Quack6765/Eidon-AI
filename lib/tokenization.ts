import { encode } from "gpt-tokenizer";

import type { PromptMessage } from "@/lib/types";

export function estimateTextTokens(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return encode(value).length;
}

export function estimatePromptTokens(messages: PromptMessage[]) {
  return messages.reduce((total, message) => {
    return total + estimateTextTokens(message.content) + 12;
  }, 0);
}
