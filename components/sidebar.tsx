"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageCirclePlus, Settings, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

export function Sidebar({
  conversations
}: {
  conversations: Conversation[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleCreate() {
    const response = await fetch("/api/conversations", { method: "POST" });
    const payload = (await response.json()) as { conversation: Conversation };
    router.push(`/chat/${payload.conversation.id}`);
    router.refresh();
  }

  async function handleDelete(conversationId: string) {
    const response = await fetch(`/api/conversations/${conversationId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      return;
    }

    if (pathname === `/chat/${conversationId}`) {
      router.push("/");
    }

    router.refresh();
  }

  return (
    <aside className="panel grain flex h-full min-h-0 w-full max-w-[320px] flex-col rounded-[2rem] border px-4 py-5">
      <div className="mb-5 flex items-center justify-between gap-3 px-2">
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-[color:var(--accent)]">
            Hermes
          </p>
          <h1
            className="text-3xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Memory Atlas
          </h1>
        </div>
        <Link href="/settings">
          <Button variant="secondary" className="h-10 w-10 rounded-full p-0">
            <Settings className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <Button className="mb-5 w-full gap-2" onClick={handleCreate}>
        <MessageCirclePlus className="h-4 w-4" />
        New chat
      </Button>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {conversations.map((conversation) => {
          const active = pathname === `/chat/${conversation.id}`;

          return (
            <div
              key={conversation.id}
              className={`rounded-[1.4rem] border px-4 py-3 transition ${
                active
                  ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
                  : "border-white/6 bg-white/[0.03] hover:border-white/12 hover:bg-white/[0.05]"
              }`}
            >
              <div className="flex items-start gap-3">
                <Link href={`/chat/${conversation.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                    {conversation.title}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    {formatTimestamp(conversation.updatedAt)}
                  </p>
                </Link>
                <button
                  type="button"
                  className="mt-0.5 rounded-full p-1 text-[color:var(--muted)] transition hover:bg-white/10 hover:text-white"
                  onClick={() => handleDelete(conversation.id)}
                  aria-label={`Delete ${conversation.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}

        {!conversations.length ? (
          <div className="rounded-[1.6rem] border border-dashed border-white/10 px-4 py-5 text-sm text-[color:var(--muted)]">
            No saved conversations yet. Start a fresh thread and it will appear here.
          </div>
        ) : null}
      </div>
    </aside>
  );
}
