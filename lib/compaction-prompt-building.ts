import { buildCompactionSummaryPromptBody } from "@/lib/compaction-summary";
import { callProviderText } from "@/lib/provider";
import { estimateTextTokens } from "@/lib/tokenization";
import type { Message, MessageAttachment, PromptContentPart, PromptMessage, ProviderProfileWithApiKey } from "@/lib/types";

export function buildSummaryPrompt(label: string, blocks: string, sourceSpan: {
  startMessageId: string;
  endMessageId: string;
  messageCount: number;
}, existingSummary?: string) {
  return buildCompactionSummaryPromptBody({
    label,
    blocks,
    sourceSpan,
    existingSummary
  });
}

export async function summarizeBlocks(
  conversationId: string,
  prompt: string,
  settings: ProviderProfileWithApiKey
): Promise<string> {
  return await callProviderText({
    settings,
    prompt,
    purpose: "compaction",
    conversationId
  });
}

export function truncateTextToTokenLimit(text: string, maxTokens: number) {
  if (!text.trim() || maxTokens <= 0) {
    return "";
  }

  if (estimateTextTokens(text) <= maxTokens) {
    return text;
  }

  let low = 0;
  let high = text.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.slice(0, mid).trimEnd();

    if (estimateTextTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

export function buildTextAttachmentPart(
  attachment: MessageAttachment,
  remainingAttachmentTextTokens: { value: number }
): PromptContentPart {
  const header = `Attached file: ${attachment.filename}\n`;
  const truncationMarker = "\n[truncated]";
  const availableTokens = Math.max(
    remainingAttachmentTextTokens.value -
      estimateTextTokens(header) -
      estimateTextTokens(truncationMarker),
    0
  );
  const excerpt = truncateTextToTokenLimit(attachment.extractedText, availableTokens);
  const needsTruncation = excerpt !== attachment.extractedText;
  const text = `${header}${excerpt || (attachment.extractedText ? "" : "[empty file]")}${
    needsTruncation ? truncationMarker : ""
  }`.trimEnd();

  remainingAttachmentTextTokens.value = Math.max(
    remainingAttachmentTextTokens.value - estimateTextTokens(excerpt),
    0
  );

  return {
    type: "text",
    text
  };
}

export function buildUserPromptContent(
  message: Pick<Message, "content" | "attachments">,
  remainingAttachmentTextTokens: { value: number },
  referencedAssistantImages: MessageAttachment[] = []
): PromptMessage["content"] {
  const parts: PromptContentPart[] = [];

  if (message.content) {
    parts.push({
      type: "text",
      text: message.content
    });
  }

  referencedAssistantImages.forEach((attachment) => {
    parts.push({
      type: "text",
      text: `Previous image reference: ${attachment.filename}`
    });
    parts.push({
      type: "image",
      attachmentId: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      relativePath: attachment.relativePath
    });
  });

  (message.attachments ?? []).forEach((attachment) => {
    if (attachment.kind === "image") {
      parts.push({
        type: "text",
        text: `Attached image: ${attachment.filename}`
      });
      parts.push({
        type: "image",
        attachmentId: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        relativePath: attachment.relativePath
      });
      return;
    }

    parts.push(buildTextAttachmentPart(attachment, remainingAttachmentTextTokens));
  });

  if (!parts.length) {
    return "";
  }

  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text;
  }

  return parts;
}

export function getLatestUserMessageIndex(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

export function getMostRecentAssistantImageAttachments(messages: Message[], latestUserIndex: number) {
  if (latestUserIndex <= 0) {
    return [];
  }

  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    const wasImageGenerationTurn = (message.actions ?? []).some((action) => action.kind === "image_generation");
    if (!wasImageGenerationTurn) {
      continue;
    }

    const imageAttachments = (message.attachments ?? []).filter((attachment) => attachment.kind === "image");
    if (imageAttachments.length > 0) {
      return imageAttachments;
    }
  }

  return [];
}
