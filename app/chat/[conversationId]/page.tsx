import { notFound } from "next/navigation";

import { ChatView } from "@/components/chat-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getConversation, listConversations, listMessages } from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";

export default async function ConversationPage({
  params
}: {
  params: Promise<{ conversationId: string }>;
}) {
  await requireUser();
  const { conversationId } = await params;
  const conversations = listConversations();
  const conversation = getConversation(conversationId);

  if (!conversation) {
    notFound();
  }

  return (
    <Shell conversations={conversations}>
      <ChatView
        payload={{
          conversation,
          messages: listMessages(conversation.id),
          debug: getConversationDebugStats(conversation.id)
        }}
      />
    </Shell>
  );
}
