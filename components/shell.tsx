"use client";

import { useState, type PropsWithChildren } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "@/components/sidebar";
import { SettingsNav } from "@/components/settings/settings-nav";
import { ContextTokensProvider } from "@/lib/context-tokens-context";
import type { Conversation, ConversationListPage, Folder } from "@/lib/types";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { useGlobalWebSocket } from "@/lib/ws-client";

export function Shell({
  conversationPage,
  folders,
  children
}: PropsWithChildren<{ conversationPage: ConversationListPage; folders?: Folder[] }>) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useGlobalWebSocket();
  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;
  const isSettingsPage = pathname.startsWith("/settings");
  const mobileMenuLabel = isSettingsPage ? "Open settings menu" : "Open menu";

  return (
    <div className="flex h-[100dvh] w-full bg-[var(--background)] overflow-hidden">
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            key="sidebar-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <div
        className={`fixed inset-y-0 left-0 z-50 w-[280px] transform transition-transform duration-300 ease-out md:relative md:z-0 md:translate-x-0 border-r border-white/5 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {isSettingsPage ? (
          <SettingsNav onCloseAction={() => setIsSidebarOpen(false)} />
        ) : (
          <Sidebar conversationPage={conversationPage} folders={folders} onClose={() => setIsSidebarOpen(false)} />
        )}
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col w-full overflow-hidden pt-14 md:pt-0">
        <div className="fixed top-0 left-0 right-0 z-30 flex h-14 items-center justify-between px-4 md:hidden bg-[var(--background)]/80 backdrop-blur-xl border-b border-white/4">
          <button
            type="button"
            className="p-2 -ml-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
            onClick={() => setIsSidebarOpen(true)}
            aria-label={mobileMenuLabel}
          >
            <Menu className="h-5 w-5" />
          </button>

          {isSettingsPage ? (
            <>
              <span className="text-sm font-semibold tracking-[0.01em] text-[var(--text)]">
                Settings
              </span>
              <div className="w-9" aria-hidden="true" />
            </>
          ) : (
            <>
              <span
                className="font-bold tracking-[0.12em] leading-none inline-block text-lg"
                style={{
                  fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundImage: "linear-gradient(to bottom, #FFFFFF 0%, #D4C8FF 40%, #8b5cf6 100%)",
                  filter: "drop-shadow(0 0 8px rgba(139,92,246,0.5)) drop-shadow(0 0 20px rgba(139,92,246,0.25)) drop-shadow(0 0 36px rgba(139,92,246,0.12))",
                }}
              >
                Eidon
              </span>

              <button
                type="button"
                className="p-2 -mr-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
                onClick={async () => {
                  try {
                    await deleteConversationIfStillEmpty(activeConversationId);
                    const res = await fetch("/api/conversations", { method: "POST" });
                    const data = (await res.json()) as { conversation: Conversation };
                    router.push(`/chat/${data.conversation.id}`);
                  } catch (e) {}
                }}
              >
                <Plus className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        <ContextTokensProvider>{children}</ContextTokensProvider>
      </div>
    </div>
  );
}
