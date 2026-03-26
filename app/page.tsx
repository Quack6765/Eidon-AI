import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Shell } from "@/components/shell";
import { listConversations } from "@/lib/conversations";
import { requireUser } from "@/lib/auth";

export default async function HomePage() {
  await requireUser();
  const conversations = listConversations();

  return (
    <Shell conversations={conversations}>
      <main className="panel grain flex h-full min-h-[calc(100vh-2rem)] items-center justify-center rounded-[2rem] border p-10">
        <div className="max-w-2xl text-center">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.35em] text-[color:var(--accent)]">
            Self-hosted chat
          </p>
          <h2
            className="mt-6 text-6xl leading-none md:text-7xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Persistent conversations with visible thinking.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-[color:var(--muted)]">
            Create a new conversation from the left rail, configure your provider in settings,
            and let Hermes compact older turns automatically as the context fills up.
          </p>
          <div className="mt-10 flex justify-center gap-4">
            <Link href="/settings">
              <Button variant="secondary">Open settings</Button>
            </Link>
          </div>
        </div>
      </main>
    </Shell>
  );
}
