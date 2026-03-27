"use client";

import { useState, type PropsWithChildren } from "react";
import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import type { Conversation } from "@/lib/types";

export function Shell({
  conversations,
  children
}: PropsWithChildren<{ conversations: Conversation[] }>) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] w-full bg-[var(--background)] overflow-hidden">
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation */}
      <div 
        className={`fixed inset-y-0 left-0 z-50 w-[260px] transform bg-[var(--sidebar)] transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar conversations={conversations} onClose={() => setIsSidebarOpen(false)} />
      </div>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col relative w-full overflow-hidden">
        {/* Mobile Header */}
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between px-4 md:hidden bg-[var(--background)]/80 backdrop-blur-md border-b border-white/5">
          <button 
            type="button"
            className="p-2 -ml-2 text-[var(--text)] hover:bg-white/5 rounded-md"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          
          <div className="font-semibold text-[var(--text)]">Hermes</div>
          
          <button
            type="button"
            className="p-2 -mr-2 text-[var(--text)] hover:bg-white/5 rounded-md"
            onClick={async () => {
              // Quick new chat for mobile header
              try {
                const res = await fetch("/api/conversations", { method: "POST" });
                const data = await res.json() as { conversation: Conversation };
                window.location.href = `/chat/${data.conversation.id}`;
              } catch (e) {
                // Ignore
              }
            }}
          >
            <Plus className="h-6 w-6" />
          </button>
        </div>

        {children}
      </div>
    </div>
  );
}
