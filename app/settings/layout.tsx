import { Shell } from "@/components/shell";
import { listConversationsPage } from "@/lib/conversations";
import { isPasswordLoginEnabled } from "@/lib/env";
import { listFolders } from "@/lib/folders";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const conversationPage = listConversationsPage({ userId: user.id });
  const folders = listFolders(user.id);

  return (
    <Shell
      currentUser={user}
      passwordLoginEnabled={isPasswordLoginEnabled()}
      conversationPage={conversationPage}
      folders={folders}
    >
      <main className="flex-1 overflow-y-auto animate-fade-in">
        {children}
      </main>
    </Shell>
  );
}
