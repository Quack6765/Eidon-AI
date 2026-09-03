import { AgentsWorkspace } from "@/components/agents/agents-workspace";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { ensureChiefBot, listBots, MAX_BOTS_PER_USER, toBotSummary } from "@/lib/bots";
import { listRecentBotRuns } from "@/lib/bot-runs";
import { listConversationsPage } from "@/lib/conversations";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await requireUser();
  ensureChiefBot(user.id);

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={listConversationsPage({ userId: user.id })}
      folders={listFolders(user.id)}
      bots={listBots(user.id).map(toBotSummary)}
    >
      <AgentsWorkspace
        initialBots={listBots(user.id).map(toBotSummary)}
        initialRuns={listRecentBotRuns({ userId: user.id, limit: 20 })}
        initialLimits={{ maxBots: MAX_BOTS_PER_USER }}
      />
    </Shell>
  );
}
