import { notFound } from "next/navigation";

import { BotDetailView } from "@/components/agents/bot-detail-view";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getBot, listBots, toBotSummary } from "@/lib/bots";
import { listAutomations } from "@/lib/automations";
import { getConversation, listConversationsPage } from "@/lib/conversations";
import { buildConversationViewPayload } from "@/lib/conversation-view";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function BotPage({
  params
}: {
  params: Promise<{ botId: string }>;
}) {
  const user = await requireUser();
  const { botId } = await params;
  const bot = getBot(botId, user.id);

  if (!bot) {
    notFound();
  }

  const conversation = getConversation(bot.homeConversationId, user.id);

  if (!conversation) {
    notFound();
  }

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={listConversationsPage({ userId: user.id })}
      folders={listFolders(user.id)}
      bots={listBots(user.id).map(toBotSummary)}
      currentConversation={conversation}
    >
      <BotDetailView
        bot={toBotSummary(bot)}
        systemPrompt={bot.systemPrompt}
        conversationPayload={buildConversationViewPayload(
          conversation,
          user.id,
          getSanitizedSettings(user.id)
        )}
        routines={listAutomations(user.id).filter((automation) => automation.botId === bot.id)}
      />
    </Shell>
  );
}
