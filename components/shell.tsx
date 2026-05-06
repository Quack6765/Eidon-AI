"use client";

import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Copy, Link2, Menu, PanelLeftClose, PanelLeftOpen, Plus, Share2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AutomationsNav } from "@/components/automations/automations-nav";
import { Sidebar } from "@/components/sidebar";
import { SettingsNav } from "@/components/settings/settings-nav";
import { ShareConversationProvider } from "@/components/share-conversation-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { writeTextToClipboard } from "@/lib/clipboard";
import { ContextTokensProvider } from "@/lib/context-tokens-context";
import type { AuthUser, Automation, Conversation, ConversationListPage, Folder } from "@/lib/types";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { consumeHomeSubmitSidebarAutoHide } from "@/lib/chat-bootstrap";
import { useGlobalWebSocket } from "@/lib/ws-client";

type SharePayload = {
  enabled: boolean;
  token: string | null;
  url: string | null;
};

export function Shell({
  currentUser,
  passwordLoginEnabled,
  conversationPage,
  folders,
  automations,
  currentConversation,
  children
}: PropsWithChildren<{
  currentUser: AuthUser;
  passwordLoginEnabled: boolean;
  conversationPage: ConversationListPage;
  folders?: Folder[];
  automations?: Automation[];
  currentConversation?: Conversation;
}>) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareState, setShareState] = useState<SharePayload | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const consumedHomeSubmitAutoHideConversationIdRef = useRef<string | null>(null);
  const hasAppliedDesktopDefaultRef = useRef(false);

  const pathname = usePathname();
  const router = useRouter();
  useGlobalWebSocket();
  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;
  const shareConversation = useMemo(() => {
    if (currentConversation) {
      return currentConversation;
    }

    if (!activeConversationId) {
      return null;
    }

    return conversationPage.conversations.find((conversation) => conversation.id === activeConversationId) ?? null;
  }, [activeConversationId, conversationPage.conversations, currentConversation]);
  const isSettingsPage = pathname.startsWith("/settings");
  const isAutomationsPage = pathname.startsWith("/automations");
  const isDesktopSidebarOpen = isSettingsPage || isSidebarOpen;
  const mobileMenuLabel = isSettingsPage ? "Open settings menu" : "Open menu";
  const sidebarToggleLabel = isSidebarOpen ? "Collapse sidebar" : "Expand sidebar";

  const normalizeSharePayload = (payload: SharePayload): SharePayload => {
    if (!payload.token || !payload.enabled || typeof window === "undefined") {
      return payload;
    }

    return {
      ...payload,
      url: `${window.location.origin}/share/${payload.token}`
    };
  };

  const loadShareState = async () => {
    if (!shareConversation) {
      return;
    }

    setShareLoading(true);
    setShareError("");

    try {
      const response = await fetch(`/api/conversations/${shareConversation.id}/share`);
      if (!response.ok) {
        throw new Error("Unable to load sharing");
      }

      setShareState(normalizeSharePayload(await response.json() as SharePayload));
    } catch {
      setShareError("Unable to load sharing.");
    } finally {
      setShareLoading(false);
    }
  };

  const openShareModal = () => {
    if (!shareConversation) {
      return;
    }

    setShareModalOpen(true);
    setShareCopied(false);
    setShareState({
      enabled: shareConversation.shareEnabled,
      token: shareConversation.shareToken,
      url: shareConversation.shareEnabled && shareConversation.shareToken
        ? `${window.location.origin}/share/${shareConversation.shareToken}`
        : null
    });
    void loadShareState();
  };

  const updateShare = async (enabled: boolean) => {
    if (!shareConversation) {
      return;
    }

    setShareLoading(true);
    setShareError("");
    setShareCopied(false);

    try {
      const response = await fetch(`/api/conversations/${shareConversation.id}/share`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      if (!response.ok) {
        throw new Error("Unable to update sharing");
      }

      const nextShare = normalizeSharePayload(await response.json() as SharePayload);
      setShareState(nextShare);

      if (nextShare.url) {
        await writeTextToClipboard(nextShare.url);
        setShareCopied(true);
      }
    } catch {
      setShareError("Unable to update sharing.");
    } finally {
      setShareLoading(false);
    }
  };

  const copyShareLink = async () => {
    if (!shareState?.url) {
      return;
    }

    setShareCopied(false);
    setShareError("");

    try {
      await writeTextToClipboard(shareState.url);
      setShareCopied(true);
    } catch {
      setShareError("Unable to copy link.");
    }
  };

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
            <div className="flex h-9 w-9 items-center justify-end">
              {shareConversation ? (
                <button
                  type="button"
                  className="p-2 -mr-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
                  onClick={openShareModal}
                  aria-label="Share conversation"
                  title="Share conversation"
                >
                  <Share2 className="h-[18px] w-[18px]" />
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {shareConversation ? (
                <button
                  type="button"
                  className="p-2 text-[var(--text)] hover:bg-white/5 rounded-lg transition-colors duration-200"
                  onClick={openShareModal}
                  aria-label="Share conversation"
                  title="Share conversation"
                >
                  <Share2 className="h-[18px] w-[18px]" />
                </button>
              ) : null}
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
            </div>
          )}
        </div>

        <ShareConversationProvider value={{ canShare: Boolean(shareConversation), openShareModal }}>
          <ContextTokensProvider>{children}</ContextTokensProvider>
        </ShareConversationProvider>
      </div>

      <AnimatePresence>
        {shareModalOpen && shareConversation ? (
          <motion.div
            key="share-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
            onClick={() => setShareModalOpen(false)}
          >
            <motion.div
              key="share-modal"
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="Share conversation"
              className="w-full max-w-[420px] rounded-2xl border border-white/8 bg-[var(--panel)] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/10 text-[var(--accent)]">
                    <Link2 className="h-[18px] w-[18px]" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-[var(--text)]">Share conversation</h2>
                  <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                    Anyone with the link can read this transcript.
                  </p>
                </div>
                <button
                  type="button"
                  className="-mr-2 -mt-2 rounded-lg p-2 text-white/45 transition-colors hover:bg-white/5 hover:text-white/75"
                  onClick={() => setShareModalOpen(false)}
                  aria-label="Close share dialog"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {shareState?.url ? (
                <div className="mt-5 flex gap-2">
                  <Input
                    value={shareState.url}
                    readOnly
                    aria-label="Share link"
                    className="h-10 rounded-xl px-3 py-2 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-10 w-10 shrink-0 rounded-md border border-white/6 bg-white/[0.02] px-0 text-white/35 hover:border-white/10 hover:bg-white/[0.05] hover:text-white/70"
                    onClick={() => void copyShareLink()}
                    aria-label={shareCopied ? "Copied share link" : "Copy share link"}
                    title={shareCopied ? "Copied" : "Copy link"}
                  >
                    {shareCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ) : null}

              {shareError ? (
                <p className={`${shareState?.url ? "mt-3" : "mt-5"} text-xs text-red-300`}>{shareError}</p>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--text)]">Share this conversation</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(shareState?.enabled)}
                  aria-label="Share this conversation"
                  disabled={shareLoading}
                  onClick={() => void updateShare(!shareState?.enabled)}
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-50 ${
                    shareState?.enabled
                      ? "border-[var(--accent)]/45 bg-[var(--accent)]"
                      : "border-white/10 bg-white/[0.08]"
                  }`}
                >
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-[var(--text)] shadow-[0_1px_5px_rgba(0,0,0,0.32)] transition-transform duration-150 ${
                      shareState?.enabled ? "translate-x-[21px]" : "translate-x-[1px]"
                    }`}
                  />
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
