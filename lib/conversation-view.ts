import { getConversationDebugStats, getConversationContextUsage } from "@/lib/compaction";
import { listQueuedMessages, listVisibleMessages } from "@/lib/conversations";
import { getSanitizedSettings } from "@/lib/settings";
import type {
  AppSettings,
  Conversation,
  Message,
  ProviderProfileSummary,
  QueuedMessage
} from "@/lib/types";

export type ConversationViewPayload = {
  conversation: Conversation;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  settings: Pick<
    AppSettings,
    "speechTranscription" | "speechCleanupEnabled" | "confirmExternalLinks" | "toolCallDisplay"
  >;
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string | null;
  contextTokens: number | null;
  compactionLimit: number;
  debug: ReturnType<typeof getConversationDebugStats>;
};

export function buildConversationViewPayload(
  conversation: Conversation,
  userId: string,
  settings = getSanitizedSettings(userId)
): ConversationViewPayload {
  const validProviderIds = new Set(settings.providerProfiles.map((profile) => profile.id));
  const providerProfileId =
    conversation.providerProfileId && validProviderIds.has(conversation.providerProfileId)
      ? conversation.providerProfileId
      : settings.defaultProviderProfileId && validProviderIds.has(settings.defaultProviderProfileId)
        ? settings.defaultProviderProfileId
        : settings.providerProfiles[0]?.id ?? null;
  const contextUsage = getConversationContextUsage(conversation.id, userId);
  return {
    conversation: providerProfileId === conversation.providerProfileId
      ? conversation
      : { ...conversation, providerProfileId },
    messages: listVisibleMessages(conversation.id),
    queuedMessages: listQueuedMessages(conversation.id),
    settings: {
      speechTranscription: settings.speechTranscription,
      speechCleanupEnabled: settings.speechCleanupEnabled,
      confirmExternalLinks: settings.confirmExternalLinks,
      toolCallDisplay: settings.toolCallDisplay
    },
    providerProfiles: settings.providerProfiles,
    defaultProviderProfileId: settings.defaultProviderProfileId,
    contextTokens: contextUsage?.contextTokens ?? null,
    compactionLimit: contextUsage?.compactionLimit ?? 0,
    debug: getConversationDebugStats(conversation.id)
  };
}
