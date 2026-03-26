import Link from "next/link";

import { Shell } from "@/components/shell";
import { SettingsForm } from "@/components/settings-form";
import { Button } from "@/components/ui/button";
import { listConversations } from "@/lib/conversations";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await requireUser();
  const conversations = listConversations();
  const settings = getSanitizedSettings();

  return (
    <Shell conversations={conversations}>
      <main className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.3em] text-[color:var(--accent)]">
              Configuration
            </p>
            <h1
              className="mt-2 text-5xl leading-none"
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
