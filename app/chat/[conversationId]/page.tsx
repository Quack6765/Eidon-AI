import { notFound, redirect } from "next/navigation";

import { ChatView } from "@/components/chat-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getConversation, listConversationsPage, listQueuedMessages, listVisibleMessages } from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";
import type { ConversationListPage } from "@/lib/types";

function ensureConversationInPage(
  page: ConversationListPage,
  conversation: NonNullable<ReturnType<typeof getConversation>>
) {
  if (page.conversations.some((entry) => entry.id === conversation.id)) {
    return page;
  }

  return {
    ...page,
    conversations: [...page.conversations, conversation].sort((left, right) => {
      if (left.updatedAt === right.updatedAt) {
        return right.id.localeCompare(left.id);
      }
      return left.updatedAt > right.updatedAt ? -1 : 1;
    })
  };
}

export default async function ConversationPage({
  params
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const user = await requireUser();
  const { conversationId } = await params;
  const conversationPage = listConversationsPage({ userId: user.id });
  const folders = listFolders(user.id);
  const conversation = getConversation(conversationId, user.id);
  const settings = getSanitizedSettings(user.id);

  if (!conversation) {
    notFound();
  }

  if (
    conversation.conversationOrigin === "automation" &&
    conversation.automationId &&
    conversation.automationRunId
  ) {
    redirect(`/automations/${conversation.automationId}/runs/${conversation.automationRunId}`);
  }

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={ensureConversationInPage(conversationPage, conversation)}
      folders={folders}
    >
      <ChatView
        payload={{
          conversation,
          messages: listVisibleMessages(conversation.id),
          queuedMessages: listQueuedMessages(conversation.id),
          settings: {
            sttEngine: settings.sttEngine,
            sttLanguage: settings.sttLanguage
          },
          providerProfiles: settings.providerProfiles,
          defaultProviderProfileId: settings.defaultProviderProfileId,
          debug: getConversationDebugStats(conversation.id)
        }}
      />
    </Shell>
  );
}
