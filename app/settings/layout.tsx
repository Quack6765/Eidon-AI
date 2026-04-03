import { Shell } from "@/components/shell";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const conversationPage = listConversationsPage();
  const folders = listFolders();

  return (
    <Shell conversationPage={conversationPage} folders={folders}>
      <main className="flex-1 overflow-y-auto animate-fade-in">
        {children}
      </main>
    </Shell>
  );
}
