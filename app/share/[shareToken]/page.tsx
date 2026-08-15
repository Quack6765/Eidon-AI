import { notFound } from "next/navigation";

import { SharedConversationView } from "@/components/shared-conversation-view";
import { getSharedConversationSnapshot } from "@/lib/conversations";
import { toSharedConversationView } from "@/lib/shared-conversation-view";

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

  const view = toSharedConversationView(snapshot);

  return (
    <SharedConversationView
      conversation={view.conversation}
      messages={view.messages}
      shareToken={shareToken}
    />
  );
}
