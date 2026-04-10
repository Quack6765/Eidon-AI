import { AutomationsWorkspace } from "@/components/automations/automations-workspace";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { listAutomations } from "@/lib/automations";
import { listConversationsPage } from "@/lib/conversations";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const user = await requireUser();
  const automations = listAutomations(user.id);

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={listConversationsPage({ userId: user.id })}
      folders={listFolders(user.id)}
      automations={automations}
    >
      <AutomationsWorkspace automation={null} runs={[]} />
    </Shell>
  );
}
