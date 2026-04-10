import { notFound, redirect } from "next/navigation";

import { ChatView } from "@/components/chat-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getConversation, listConversationsPage, listVisibleMessages } from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";
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
  await requireUser();
  const { conversationId } = await params;
  const conversationPage = listConversationsPage();
  const folders = listFolders();
  const conversation = getConversation(conversationId);
  const settings = getSanitizedSettings();

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
    <Shell conversationPage={ensureConversationInPage(conversationPage, conversation)} folders={folders}>
      <ChatView
        payload={{
          conversation,
          messages: listVisibleMessages(conversation.id),
          providerProfiles: settings.providerProfiles,
          defaultProviderProfileId: settings.defaultProviderProfileId,
          debug: getConversationDebugStats(conversation.id)
        }}
      />
    </Shell>
  );
}
