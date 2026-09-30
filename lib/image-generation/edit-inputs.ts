import { readAttachmentBuffer } from "@/lib/attachments";
import {
  getLatestUserMessageIndex,
  getMostRecentAssistantImageAttachments
} from "@/lib/compaction-prompt-building";
import { listMessages } from "@/lib/conversations";
import type { MessageAttachment, PromptMessage } from "@/lib/types";
import { IMAGE_ROLE_DEFAULT_LABELS, orderReferenceImages } from "./slots";
import type {
  ImageGenerationImageRole,
  ImageGenerationInputSlot,
  ImageGenerationReferenceImage
} from "./types";

const MAX_EDIT_INPUT_IMAGES = 4;

type ReferenceSource = Pick<MessageAttachment, "filename" | "mimeType" | "relativePath">;

function collectImageParts(content: PromptMessage["content"]): ReferenceSource[] {
  if (typeof content === "string") return [];
  return content
    .filter((part) => part.type === "image")
    .map((part) => ({
      filename: part.filename,
      mimeType: part.mimeType,
      relativePath: part.relativePath
    }));
}

function latestUserIndex(promptMessages: PromptMessage[]) {
  for (let index = promptMessages.length - 1; index >= 0; index -= 1) {
    if (promptMessages[index]?.role === "user") return index;
  }
  return -1;
}

function assignSlots(
  sources: ReferenceSource[],
  overrides?: ImageGenerationInputSlot[]
): ImageGenerationInputSlot[] {
  const overrideByFilename = new Map((overrides ?? []).map((slot) => [slot.filename, slot]));
  const hasCanvas = (overrides ?? []).some((slot) => slot.role === "canvas");
  let claimedCanvas = false;

  return sources.map((source) => {
    const override = overrideByFilename.get(source.filename);
    if (override) {
      return {
        filename: source.filename,
        role: override.role,
        label: override.label?.trim() || IMAGE_ROLE_DEFAULT_LABELS[override.role]
      };
    }
    const role: ImageGenerationImageRole = !hasCanvas && !claimedCanvas ? "canvas" : "content";
    if (role === "canvas") claimedCanvas = true;
    return { filename: source.filename, role, label: IMAGE_ROLE_DEFAULT_LABELS[role] };
  });
}

export function resolveEditInputImages(
  promptMessages: PromptMessage[],
  conversationId?: string,
  overrides?: ImageGenerationInputSlot[]
): ImageGenerationReferenceImage[] {
  const sources: ReferenceSource[] = [];
  const latestIndex = latestUserIndex(promptMessages);

  const latestMessage = latestIndex >= 0 ? promptMessages[latestIndex] : undefined;
  if (latestMessage) {
    sources.push(...collectImageParts(latestMessage.content));
  }

  if (!sources.length && conversationId) {
    const messages = listMessages(conversationId);
    const messageIndex = getLatestUserMessageIndex(messages);
    if (messageIndex > 0) {
      sources.push(...getMostRecentAssistantImageAttachments(messages, messageIndex));
    }
  }

  if (!sources.length) {
    for (let index = latestIndex - 1; index >= 0 && sources.length < MAX_EDIT_INPUT_IMAGES; index -= 1) {
      const message = promptMessages[index];
      if (message?.role === "user") {
        sources.push(...collectImageParts(message.content));
      }
    }
  }

  const seen = new Set<string>();
  const uniqueSources = sources.filter((source) => {
    if (seen.has(source.relativePath)) return false;
    seen.add(source.relativePath);
    return true;
  });

  const slots = assignSlots(uniqueSources, overrides);

  return orderReferenceImages(
    uniqueSources.flatMap((source, index) => {
      try {
        return [{
          bytes: readAttachmentBuffer(source),
          mimeType: source.mimeType,
          filename: source.filename,
          role: slots[index].role,
          label: slots[index].label
        }];
      } catch {
        return [];
      }
    })
  ).slice(0, MAX_EDIT_INPUT_IMAGES);
}
