"use client";

import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AutomationsNav } from "@/components/automations/automations-nav";
import { Sidebar } from "@/components/sidebar";
import { SettingsNav } from "@/components/settings/settings-nav";
import { ContextTokensProvider } from "@/lib/context-tokens-context";
import type { AuthUser, Automation, Conversation, ConversationListPage, Folder } from "@/lib/types";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { consumeHomeSubmitSidebarAutoHide } from "@/lib/chat-bootstrap";
import { useGlobalWebSocket } from "@/lib/ws-client";

export function Shell({
  currentUser,
  passwordLoginEnabled,
  conversationPage,
  folders,
  automations,
  children
}: PropsWithChildren<{
  currentUser: AuthUser;
  passwordLoginEnabled: boolean;
  conversationPage: ConversationListPage;
  folders?: Folder[];
  automations?: Automation[];
}>) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const consumedHomeSubmitAutoHideConversationIdRef = useRef<string | null>(null);
  const hasAppliedDesktopDefaultRef = useRef(false);

  const pathname = usePathname();
  const router = useRouter();
  useGlobalWebSocket();
  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;
  const isSettingsPage = pathname.startsWith("/settings");
  const isAutomationsPage = pathname.startsWith("/automations");
  const isDesktopSidebarOpen = isSettingsPage || isSidebarOpen;
  const mobileMenuLabel = isSettingsPage ? "Open settings menu" : "Open menu";
  const sidebarToggleLabel = isSidebarOpen ? "Collapse sidebar" : "Expand sidebar";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isDesktop = window.innerWidth >= 768;
    let shouldAutoHideActiveConversation = false;

    if (activeConversationId) {
      if (consumedHomeSubmitAutoHideConversationIdRef.current === activeConversationId) {
        shouldAutoHideActiveConversation = true;
      } else if (consumeHomeSubmitSidebarAutoHide(activeConversationId)) {
        consumedHomeSubmitAutoHideConversationIdRef.current = activeConversationId;
        shouldAutoHideActiveConversation = true;
      }
    }

    if (!isDesktop) {
      return;
    }

    if (pathname === "/") {
      hasAppliedDesktopDefaultRef.current = true;
      setIsSidebarOpen(true);
      return;
    }

    if (isSettingsPage) {
      return;
    }

    if (shouldAutoHideActiveConversation) {
      hasAppliedDesktopDefaultRef.current = true;
      setIsSidebarOpen(false);
      return;
    }

    if (!hasAppliedDesktopDefaultRef.current) {
      hasAppliedDesktopDefaultRef.current = true;
      setIsSidebarOpen(true);
    }
  }, [activeConversationId, isSettingsPage, pathname]);

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
        className={`fixed inset-y-0 left-0 z-50 w-[280px] transform transition-transform duration-300 ease-out border-r border-white/5 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          isDesktopSidebarOpen ? "md:translate-x-0" : "md:-translate-x-full"
        }`}
      >
        {isSettingsPage ? (
          <SettingsNav
            currentUser={currentUser}
            passwordLoginEnabled={passwordLoginEnabled}
            onCloseAction={() => setIsSidebarOpen(false)}
          />
        ) : isAutomationsPage ? (
          <AutomationsNav automations={automations ?? []} onCloseAction={() => setIsSidebarOpen(false)} />
        ) : (
          <Sidebar conversationPage={conversationPage} folders={folders} onClose={() => setIsSidebarOpen(false)} />
        )}
      </div>

      {!isSettingsPage ? (
        <button
          type="button"
          onClick={() => setIsSidebarOpen((prev) => !prev)}
          className={`group/sidebar-toggle hidden md:flex fixed top-[72px] z-50 h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[var(--background)]/95 text-white/45 shadow-[0_2px_8px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-[left,background-color,border-color,color] duration-200 ease-out hover:border-white/18 hover:bg-[#171717] hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            isSidebarOpen ? "left-[262px]" : "left-3"
          }`}
          aria-label={sidebarToggleLabel}
          aria-pressed={isSidebarOpen}
          title={sidebarToggleLabel}
        >
          <span className="absolute left-1.5 top-2 h-5 w-px rounded bg-white/12 transition-colors duration-150 group-hover/sidebar-toggle:bg-white/24" />
          {isSidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
          <span
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#161616] px-2 py-1 text-[11px] font-medium text-white/70 opacity-0 shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition-opacity duration-150 group-hover/sidebar-toggle:opacity-100 group-focus-visible/sidebar-toggle:opacity-100 ${
              isSidebarOpen ? "right-11" : "left-11"
            }`}
          >
            {isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          </span>
        </button>
      ) : null}

      <div className={`relative flex min-h-0 min-w-0 flex-1 flex-col w-full overflow-hidden pt-14 md:pt-0 transition-all duration-300 ease-out ${
        isDesktopSidebarOpen ? "md:pl-[280px]" : "md:pl-0"
      }`}>
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
            <span className="text-sm font-semibold tracking-[0.01em] text-[var(--text)]">
              Settings
            </span>
          ) : (
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
          )}

          {isAutomationsPage ? (
            <div className="h-9 w-9" />
          ) : (
            <button
              type="button"
              className="p-2 -mr-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
              onClick={async () => {
                try {
                  await deleteConversationIfStillEmpty(activeConversationId);
                  const res = await fetch("/api/conversations", { method: "POST" });
                  const data = (await res.json()) as { conversation: Conversation };
                  router.push(`/chat/${data.conversation.id}`);
                } catch {}
              }}
              aria-label="New chat"
            >
              <Plus className="h-5 w-5" />
            </button>
          )}
        </div>

        <ContextTokensProvider>{children}</ContextTokensProvider>
      </div>
    </div>
  );
}
