import { encode } from "gpt-tokenizer";

import type { Message, MessageAttachment, PromptMessage } from "@/lib/types";

export type TokenizerEngine = "gpt-tokenizer" | "off";

export type Tokenizer = {
  estimateTextTokens: (text: string) => number;
  estimatePromptTokens: (messages: PromptMessage[]) => number;
  estimatePromptContentTokens: (content: PromptMessage["content"]) => number;
  estimateAttachmentTokens: (attachments: MessageAttachment[]) => number;
  estimateMessageTokens: (message: Pick<Message, "content" | "thinkingContent" | "attachments">) => number;
};

function charCountTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function buildGptTokenizer(): Tokenizer {
  return {
    estimateTextTokens: (text: string) => text.trim() ? encode(text).length : 0,
    estimatePromptTokens: (messages) => {
      const tok = buildGptTokenizer();
      return messages.reduce((total, m) => total + tok.estimatePromptContentTokens(m.content) + 12, 0);
    },
    estimatePromptContentTokens: (content) => {
      if (typeof content === "string") return encode(content).length;
      const tok = buildGptTokenizer();
      return content.reduce((total, part) => {
        if (part.type === "text") return total + encode(part.text).length;
        return total + encode(`[Image attachment: ${part.filename}]`).length;
      }, 0);
    },
    estimateAttachmentTokens: (attachments) =>
      attachments.reduce((total, a) => {
        if (a.kind === "image") return total + encode(`[Image attachment: ${a.filename}]`).length;
        return total + encode(`Attached file: ${a.filename}\n${a.extractedText}`).length;
      }, 0),
    estimateMessageTokens: (m) => {
      const tok = buildGptTokenizer();
      return tok.estimateTextTokens(`${m.content}\n${m.thinkingContent}`) +
        tok.estimateAttachmentTokens(m.attachments ?? []);
    }
  };
}

function buildOffTokenizer(): Tokenizer {
  return {
    estimateTextTokens: (text: string) => text.trim() ? Math.ceil(text.trim().length / 4) : 0,
    estimatePromptTokens: (messages) => {
      const tok = buildOffTokenizer();
      return messages.reduce((total, m) => total + tok.estimatePromptContentTokens(m.content) + 12, 0);
    },
    estimatePromptContentTokens: (content) => {
      if (typeof content === "string") return charCountTokens(content);
      return content.reduce((total, part) => {
        if (part.type === "text") return total + charCountTokens(part.text);
        return total + charCountTokens(`[Image attachment: ${part.filename}]`);
      }, 0);
    },
    estimateAttachmentTokens: (attachments) =>
      attachments.reduce((total, a) => {
        if (a.kind === "image") return total + charCountTokens(`[Image attachment: ${a.filename}]`);
        return total + charCountTokens(`Attached file: ${a.filename}\n${a.extractedText}`);
      }, 0),
    estimateMessageTokens: (m) =>
      charCountTokens(`${m.content}\n${m.thinkingContent}`) +
      buildOffTokenizer().estimateAttachmentTokens(m.attachments ?? [])
  };
}

export function createTokenizer(engine?: string): Tokenizer {
  switch (engine) {
    case "off":
      return buildOffTokenizer();
    case "gpt-tokenizer":
    default:
      return buildGptTokenizer();
  }
}
