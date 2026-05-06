import { notFound } from "next/navigation";

import { SharedConversationView } from "@/components/shared-conversation-view";
import { getSharedConversationSnapshot } from "@/lib/conversations";

export default async function SharedConversationPage({
  params
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;
  const snapshot = getSharedConversationSnapshot(shareToken);

  if (!snapshot) {
    notFound();
  }

  return (
    <SharedConversationView
      conversation={snapshot.conversation}
      messages={snapshot.messages}
      shareToken={shareToken}
    />
  );
}
