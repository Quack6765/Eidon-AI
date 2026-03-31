"use client";

import { useState, type PropsWithChildren } from "react";
import { Menu, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "@/components/sidebar";
import type { Conversation, Folder } from "@/lib/types";

export function Shell({
  conversations,
  folders,
  children
}: PropsWithChildren<{ conversations: Conversation[]; folders?: Folder[] }>) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
        className={`fixed inset-y-0 left-0 z-50 w-[280px] transform bg-[var(--sidebar)] transition-transform duration-300 ease-out md:relative md:z-0 md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar conversations={conversations} folders={folders} onClose={() => setIsSidebarOpen(false)} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col relative w-full overflow-y-auto">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between px-4 md:hidden bg-[var(--background)]/80 backdrop-blur-xl border-b border-white/4">
          <button
            type="button"
            className="p-2 -ml-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="font-semibold text-[var(--text)] text-sm tracking-wide">Hermes</div>

          <button
            type="button"
            className="p-2 -mr-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
            onClick={async () => {
              try {
                const res = await fetch("/api/conversations", { method: "POST" });
                const data = (await res.json()) as { conversation: Conversation };
                window.location.href = `/chat/${data.conversation.id}`;
              } catch (e) {}
            }}
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
