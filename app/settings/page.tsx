import Link from "next/link";

import { Shell } from "@/components/shell";
import { SettingsForm } from "@/components/settings-form";
import { Button } from "@/components/ui/button";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await requireUser();
  const conversationPage = listConversationsPage();
  const folders = listFolders();
  const settings = getSanitizedSettings();

  return (
    <Shell conversationPage={conversationPage} folders={folders}>
      <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full space-y-6 animate-slide-up">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
              Configuration
            </p>
            <h1
              className="mt-2 text-4xl md:text-5xl leading-none text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Settings
            </h1>
          </div>
          <Link href="/">
            <Button variant="secondary">Back to chat</Button>
          </Link>
        </div>

        <SettingsForm settings={settings} user={user} />
      </main>
    </Shell>
  );
}
