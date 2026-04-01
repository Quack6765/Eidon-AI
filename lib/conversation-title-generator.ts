import { callProviderText } from "@/lib/provider";
import type { ProviderProfileWithApiKey } from "@/lib/types";

export const DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE = "Files";
export const DEFAULT_CONVERSATION_TITLE = "Conversation";
export const MAX_CONVERSATION_TITLE_LENGTH = 48;

function trimToWordBoundary(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength).trim();
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace >= 16) {
    return truncated.slice(0, lastSpace).trim();
  }

  return truncated;
}

export function buildConversationTitlePrompt(firstMessage: string) {
  return [
    "Generate a short conversation title from the user's first message.",
    "Return only the title.",
    "Prefer 2 to 4 words.",
    "Keep it natural and specific.",
    "Do not use quotes, markdown, labels, or trailing punctuation.",
    "",
    "User message:",
    firstMessage
  ].join("\n");
}

export function sanitizeGeneratedConversationTitle(rawTitle: string) {
  const firstLine = rawTitle.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine
    .replace(/["'`“”]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/g, "")
    .trim();

  return trimToWordBoundary(collapsed, MAX_CONVERSATION_TITLE_LENGTH);
}

export async function generateConversationTitle(input: {
  settings: ProviderProfileWithApiKey;
  firstMessage: string;
}) {
  const rawTitle = await callProviderText({
    settings: input.settings,
    prompt: buildConversationTitlePrompt(input.firstMessage),
    purpose: "title"
  });
  const title = sanitizeGeneratedConversationTitle(rawTitle);

  if (!title) {
    throw new Error("Provider returned an empty title");
  }

  return title;
}
