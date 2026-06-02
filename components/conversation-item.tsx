"use client";

import React, { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  MoreHorizontal,
  FolderIcon,
  Trash2,
  FolderInput,
  Pencil,
  X,
  MessageSquare,
  LoaderCircle
} from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CONVERSATION_REMOVED_EVENT,
  CONVERSATION_TITLE_UPDATED_EVENT,
  dispatchConversationRemoved,
  dispatchConversationTitleUpdated
} from "@/lib/conversation-events";
import type { Folder } from "@/lib/types";
import { highlightMatch } from "@/lib/sidebar-helpers";
import type { SidebarConversation } from "@/lib/sidebar-helpers";
import { RenameModal } from "@/components/ui/rename-modal";

export function DropdownPortal({
  anchorRef,
  children,
  open,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  open: boolean;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 4, left: rect.right - 224, width: 224 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleScroll() {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: rect.right - 224, width: 224 });
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  if (!open || !coords) return null;

  return createPortal(
    <div style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width, zIndex: 9999 }}>
      {children}
    </div>,
    document.body
  );
}

export function ConversationItem({
  conversation,
  active,
  onNavigate,
  onDeleteConversation,
  onMoveConversation,
  allFolders,
  dragEnabled,
  searchQuery
}: {
  conversation: SidebarConversation;
  active: boolean;
  onNavigate?: (conversationId: string, href: string) => void | Promise<void>;
  onDeleteConversation: (conversationId: string) => void;
  onMoveConversation: (conversationId: string, folderId: string | null) => void;
  allFolders: Folder[];
  dragEnabled: boolean;
  searchQuery: string;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({ id: conversation.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const trimmedSearchQuery = searchQuery.trim();
  const highlightedTitle = trimmedSearchQuery
    ? highlightMatch(conversation.title, trimmedSearchQuery)
    : null;
  const highlightedMatchSnippet =
    trimmedSearchQuery && conversation.matchSnippet
      ? highlightMatch(conversation.matchSnippet, trimmedSearchQuery)
      : null;
  const titlePaddingClass = active ? "pr-8" : "pr-8 md:pr-0 md:group-hover:pr-8";
  const actionVisibilityClass = active
    ? "opacity-100"
    : "opacity-100 md:opacity-0 md:group-hover:opacity-100";

  function handleNavigate(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (
      !onNavigate ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    void onNavigate(`/chat/${conversation.id}`, conversation.id);
  }

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && menuRef.current.contains(e.target as Node)
      ) return;
      if (
        triggerRef.current && triggerRef.current.contains(e.target as Node)
      ) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const response = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    if (response.ok) {
      onDeleteConversation(conversation.id);
      dispatchConversationRemoved({ conversationId: conversation.id });
    }
    if (active) {
      router.push("/");
    }
    router.refresh();
    setMenuOpen(false);
    setConfirmDelete(false);
  }

  async function handleMoveToFolder(folderId: string | null) {
    const response = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId })
    });
    if (response.ok) {
      onMoveConversation(conversation.id, folderId);
    }
    router.refresh();
    setMenuOpen(false);
  }

  async function handleRenameConversation(newTitle: string) {
    const response = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle })
    });
    if (response.ok) {
      dispatchConversationTitleUpdated({
        conversationId: conversation.id,
        title: newTitle
      });
    }
    router.refresh();
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative mb-0.5"
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
      aria-label={`${conversation.title} conversation`}
    >
      <Link
        href={`/chat/${conversation.id}`}
        onClick={handleNavigate}
        className={`group relative flex items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-all duration-300 ${
          active
            ? "bg-white/[0.05] text-white font-semibold"
            : "text-white/70 hover:bg-white/[0.03] hover:text-white/90"
        }`}
      >
        {(conversation.isActive || conversation.titleGenerationStatus === "running") ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--accent)]" />
        ) : (
          <MessageSquare className={`h-4 w-4 shrink-0 transition-opacity duration-300 ${active ? "opacity-100 text-[var(--accent)]" : "opacity-60"}`} />
        )}

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {highlightedTitle ? (
            <div
              className={`truncate ${titlePaddingClass}`}
              dangerouslySetInnerHTML={{ __html: highlightedTitle }}
            />
          ) : (
            <div className={`truncate ${titlePaddingClass}`}>
              {conversation.title}
            </div>
          )}

          {highlightedMatchSnippet ? (
            <div
              className={`mt-0.5 truncate pr-8 text-xs ${active ? "text-white/55" : "text-white/40 group-hover:text-white/50"}`}
              dangerouslySetInnerHTML={{ __html: highlightedMatchSnippet }}
            />
          ) : null}

          <div
            data-sidebar-row-actions="conversation"
            className={`absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-transparent via-transparent to-transparent pl-4 pr-1 transition-opacity duration-300 ${actionVisibilityClass}`}
            onClick={(e) => e.preventDefault()}
          >
            <button
              ref={triggerRef}
              type="button"
              aria-label={`Conversation actions for ${conversation.title}`}
              title={`Conversation actions for ${conversation.title}`}
              className="text-white/20 hover:text-white transition-colors duration-200 p-1 rounded-lg hover:bg-white/5"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(!menuOpen);
                setConfirmDelete(false);
              }}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Link>

      <DropdownPortal anchorRef={triggerRef} open={menuOpen}>
        <div
          ref={menuRef}
          className="w-full rounded-2xl border border-white/5 bg-[#121214] p-2 shadow-2xl backdrop-blur-xl animate-fade-in relative"
        >
          <button
            onClick={() => setMenuOpen(false)}
            className="absolute top-1.5 right-1.5 p-1 text-white/20 hover:text-white/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {confirmDelete ? (
            <div className="px-2 py-2">
              <p className="text-xs text-white/40 mb-3 px-1">Delete conversation?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  className="flex-1 rounded-xl bg-red-500/10 text-red-400 text-xs py-2.5 hover:bg-red-500/20 transition-colors duration-200 font-semibold"
                >
                  Delete
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); setMenuOpen(false); }}
                  className="flex-1 rounded-xl bg-white/5 text-white/40 text-xs py-2.5 hover:bg-white/10 transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {allFolders.length > 0 && (
                <>
                  <button
                    onClick={() => handleMoveToFolder(null)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
                  >
                    <FolderInput className="h-4 w-4 opacity-50" />
                    No folder
                  </button>
                  {allFolders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleMoveToFolder(f.id)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
                    >
                      <FolderIcon className="h-4 w-4 opacity-50" />
                      {f.name}
                    </button>
                  ))}
                  <div className="my-1.5 border-t border-white/5" />
                </>
              )}
              <button
                onClick={() => { setRenameOpen(true); setMenuOpen(false); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
              >
                <Pencil className="h-4 w-4 opacity-50" />
                Rename
              </button>
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors duration-200"
              >
                <Trash2 className="h-4 w-4 opacity-70" />
                Delete
              </button>
            </>
          )}
        </div>
      </DropdownPortal>
      <RenameModal
        open={renameOpen}
        onOpenChange={setRenameOpen}
        value={conversation.title}
        onSave={handleRenameConversation}
        title="Rename conversation"
      />
    </div>
  );
}
