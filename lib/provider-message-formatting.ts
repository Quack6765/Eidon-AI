import type { PromptContentPart, PromptMessage, PromptTextContentPart } from "@/lib/types";

function buildDateContextContent() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localTime = now.toLocaleString("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long"
  });

  return [
    "Current date and time context for this request (not shown to the user):",
    `- Local: ${localTime} (${timezone})`,
    `- UTC: ${now.toISOString()}`
  ].join("\n");
}

export function withDateContextUserMessage(messages: PromptMessage[]): PromptMessage[] {
  return [...messages, { role: "user", content: buildDateContextContent(), volatile: true }];
}

export function withDateContextSystemPrompt(systemPrompt: string) {
  const context = buildDateContextContent();
  return `${systemPrompt.trim()}\n\n${context}`;
}

const MAX_INLINE_TOOL_IMAGES = 8;
const TOOL_IMAGE_EVICTION_BLOCK = 4;

export function buildOmittedImagePart(filename: string): PromptTextContentPart {
  return {
    type: "text",
    text: `[image omitted from context to save tokens: ${filename} — file remains attached to this message]`
  };
}

function countToolImages(messages: PromptMessage[]) {
  return messages.reduce(
    (count, message) =>
      message.role === "tool" && typeof message.content !== "string"
        ? count + message.content.filter((part) => part.type === "image").length
        : count,
    0
  );
}

export function withToolResultImagesAsUserMessages(messages: PromptMessage[]): PromptMessage[] {
  const imageCount = countToolImages(messages);
  let imagesToOmit = imageCount > MAX_INLINE_TOOL_IMAGES
    ? Math.ceil((imageCount - MAX_INLINE_TOOL_IMAGES) / TOOL_IMAGE_EVICTION_BLOCK) * TOOL_IMAGE_EVICTION_BLOCK
    : 0;
  const result: PromptMessage[] = [];
  let pendingImages: PromptContentPart[] = [];

  const flushPendingImages = () => {
    if (!pendingImages.length) return;
    result.push({
      role: "user",
      content: [{ type: "text", text: "Images returned by the tool calls above:" }, ...pendingImages]
    });
    pendingImages = [];
  };

  for (const message of messages) {
    if (message.role !== "tool") {
      flushPendingImages();
      result.push(message);
      continue;
    }

    if (typeof message.content === "string") {
      result.push(message);
      continue;
    }

    const texts: string[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        texts.push(part.text);
      } else if (imagesToOmit > 0) {
        imagesToOmit -= 1;
        texts.push(buildOmittedImagePart(part.filename).text);
      } else {
        pendingImages.push({ type: "text", text: `Attached image: ${part.filename}` }, part);
      }
    }
    result.push({ ...message, content: texts.join("\n") });
  }

  flushPendingImages();
  return result;
}
