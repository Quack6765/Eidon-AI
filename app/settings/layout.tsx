import { Shell } from "@/components/shell";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { requireUser } from "@/lib/auth";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const conversationPage = listConversationsPage();
  const folders = listFolders();

  return (
    <Shell conversationPage={conversationPage} folders={folders}>
      <main className="flex-1 overflow-y-auto p-6 md:p-8 animate-fade-in">
        <div className="max-w-[55%]">
          {children}
        </div>
      </main>
    </Shell>
  );
}
