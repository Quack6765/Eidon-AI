import { notFound } from "next/navigation";

import { AutomationsWorkspace } from "@/components/automations/automations-workspace";
import { Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { getAutomation, listAutomationRuns, listAutomations } from "@/lib/automations";
import { listConversationsPage } from "@/lib/conversations";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";

export const dynamic = "force-dynamic";

export default async function AutomationPage({
  params
}: {
  params: Promise<{ automationId: string }>;
}) {
  const user = await requireUser();
  const { automationId } = await params;
  const automation = getAutomation(automationId, user.id);

  if (!automation) {
    notFound();
  }

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={listConversationsPage({ userId: user.id })}
      folders={listFolders(user.id)}
      automations={listAutomations(user.id)}
    >
      <AutomationsWorkspace automation={automation} runs={listAutomationRuns(automation.id, user.id)} />
    </Shell>
  );
}
