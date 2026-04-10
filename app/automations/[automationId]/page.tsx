import { notFound } from "next/navigation";

import { AutomationsWorkspace } from "@/components/automations/automations-workspace";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getAutomation, listAutomationRuns, listAutomations } from "@/lib/automations";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

export default async function AutomationPage({
  params
}: {
  params: Promise<{ automationId: string }>;
}) {
  await requireUser();
  const { automationId } = await params;
  const automation = getAutomation(automationId);

  if (!automation) {
    notFound();
  }

  return (
    <Shell
      conversationPage={listConversationsPage()}
      folders={listFolders()}
      automations={listAutomations()}
    >
      <AutomationsWorkspace automation={automation} runs={listAutomationRuns(automation.id)} />
    </Shell>
  );
}
