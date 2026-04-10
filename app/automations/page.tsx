import { AutomationsWorkspace } from "@/components/automations/automations-workspace";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { listAutomations } from "@/lib/automations";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireUser();
  const automations = listAutomations();

  return (
    <Shell
      conversationPage={listConversationsPage()}
      folders={listFolders()}
      automations={automations}
    >
      <AutomationsWorkspace automation={null} runs={[]} />
    </Shell>
  );
}
