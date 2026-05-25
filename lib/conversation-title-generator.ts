import { runLocalTitleInference } from "@/lib/local-title-model";
import { getConversation } from "@/lib/conversations";
import { callProviderText } from "@/lib/provider";
import { getSettings, listProviderProfilesWithApiKeys } from "@/lib/settings";

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

export function sanitizeGeneratedConversationTitle(rawTitle: string) {
  const firstLine = rawTitle.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine
    .replace(/["'`""]+/g, "")
    .replace(/[.!?,;:\-–—]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return trimToWordBoundary(collapsed, MAX_CONVERSATION_TITLE_LENGTH);
}

function buildFallbackTitle(userMessage: string): string {
  return trimToWordBoundary(userMessage, MAX_CONVERSATION_TITLE_LENGTH) || DEFAULT_CONVERSATION_TITLE;
}

const LLM_TITLE_PROMPT = (message: string) =>
  `Generate a concise 2-4 word title for a conversation that starts with this message. Reply with only the title, no punctuation, no quotes, no explanation.\n\nMessage: "${message}"`;

export async function generateConversationTitle(input: {
  firstMessage: string;
  conversationId: string;
}) {
  const settings = getSettings();
  const mode = settings.titleGenerationMode;

  try {
    let rawTitle: string;

    if (mode === "local") {
      console.log(`[title-generation] mode=local model=SmolLM2-360M-Instruct conversationId=${input.conversationId}`);
      rawTitle = await runLocalTitleInference(input.firstMessage);
    } else {
      const profiles = listProviderProfilesWithApiKeys();
      let profile: typeof profiles[0] | undefined;

      if (mode === "same") {
        const conversation = getConversation(input.conversationId);
        const profileId = conversation?.providerProfileId ?? settings.defaultProviderProfileId;
        profile = profiles.find((p) => p.id === profileId);
      } else if (mode === "specific" && settings.titleGenerationProfileId) {
        profile = profiles.find((p) => p.id === settings.titleGenerationProfileId);
      }

      if (!profile) {
        console.log(`[title-generation] mode=${mode} no provider found, using fallback conversationId=${input.conversationId}`);
        return buildFallbackTitle(input.firstMessage);
      }

      console.log(`[title-generation] mode=${mode} model=${profile.model} provider=${profile.name} conversationId=${input.conversationId}`);
      rawTitle = await callProviderText({
        settings: profile,
        prompt: LLM_TITLE_PROMPT(input.firstMessage),
        purpose: "title",
        conversationId: input.conversationId
      });
    }

    const title = sanitizeGeneratedConversationTitle(rawTitle);

    console.log(`[title-generation] raw="${rawTitle}" sanitized="${title}" conversationId=${input.conversationId}`);

    if (!title || title.length < 2) {
      console.log(`[title-generation] title too short, using fallback conversationId=${input.conversationId}`);
      return buildFallbackTitle(input.firstMessage);
    }

    return title;
  } catch (err) {
    console.error(`[title-generation] failed mode=${mode} conversationId=${input.conversationId}:`, err);
    return buildFallbackTitle(input.firstMessage);
  }
}
