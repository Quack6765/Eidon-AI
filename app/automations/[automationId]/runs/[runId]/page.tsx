import { notFound } from "next/navigation";

import { ChatView } from "@/components/chat-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getAutomationRun, listAutomations } from "@/lib/automations";
import { getConversation, listConversationsPage, listVisibleMessages } from "@/lib/conversations";
import { getConversationDebugStats } from "@/lib/compaction";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function AutomationRunPage({
  params
}: {
  params: Promise<{ automationId: string; runId: string }>;
}) {
  const user = await requireUser();
  const { automationId, runId } = await params;
  const run = getAutomationRun(runId, user.id);

  if (!run?.conversationId || run.automationId !== automationId) {
    notFound();
  }

  const conversation = getConversation(run.conversationId, user.id);
  if (!conversation) {
    notFound();
  }

  const settings = getSanitizedSettings(user.id);

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={listConversationsPage({ userId: user.id })}
      folders={listFolders(user.id)}
      automations={listAutomations(user.id)}
    >
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
