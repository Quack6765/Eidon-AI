"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreHorizontal,
  FolderIcon,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Trash2,
  Pencil,
  X
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { FOLDER_DROP_PREFIX } from "@/lib/sidebar-dnd";
import type { Folder } from "@/lib/types";
import type { SidebarConversation } from "@/lib/sidebar-helpers";
import { ConversationItem } from "@/components/conversation-item";
import { DropdownPortal } from "@/components/conversation-item";
import { RenameModal } from "@/components/ui/rename-modal";

export function FolderItem({
  folder,
  conversations,
  activeConversationId,
  allFolders,
  onNavigate,
  onDeleteConversation,
  onMoveConversation,
  onCreateInFolder,
  dragEnabled,
  showCount,
  searchQuery
}: {
  folder: Folder;
  conversations: SidebarConversation[];
  activeConversationId: string | null;
  allFolders: Folder[];
  onNavigate?: (conversationId: string, href: string) => void | Promise<void>;
  onDeleteConversation: (conversationId: string) => void;
  onMoveConversation: (conversationId: string, folderId: string | null) => void;
  onCreateInFolder: (folderId: string) => void;
  dragEnabled: boolean;
  showCount: boolean;
  searchQuery: string;
}) {
  const [collapsed, setCollapsed] = useState(() => {
    if (activeConversationId === null) return true;
    return !conversations.some(c => c.id === activeConversationId);
  });
  const [renameOpen, setRenameOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({ id: folder.id });
  const {
    setNodeRef: setFolderDropRef,
    isOver: isOverFolderDrop
  } = useDroppable({
    id: `${FOLDER_DROP_PREFIX}${folder.id}`
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  useEffect(() => {
    if (!folderMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current && menuRef.current.contains(e.target as Node)
      ) return;
      if (
        triggerRef.current && triggerRef.current.contains(e.target as Node)
      ) return;
      setFolderMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [folderMenuOpen]);

  useEffect(() => {
    if (activeConversationId === null) return;
    setCollapsed(!conversations.some(c => c.id === activeConversationId));
  }, [activeConversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRename(newName: string) {
    await fetch(`/api/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName })
    });
    router.refresh();
  }

  async function handleDeleteFolder() {
    if (!confirmDeleteFolder) {
      setConfirmDeleteFolder(true);
      return;
    }
    await fetch(`/api/folders/${folder.id}`, { method: "DELETE" });
    router.refresh();
    setFolderMenuOpen(false);
    setConfirmDeleteFolder(false);
  }

  return (
    <div ref={setNodeRef} style={style} {...(dragEnabled ? attributes : {})}>
      <div
        ref={dragEnabled ? setFolderDropRef : undefined}
        className={`group flex items-center gap-3 rounded-2xl pl-1 pr-3 py-2 text-sm text-white/70 hover:bg-white/[0.03] transition-all duration-300 cursor-pointer ${
          dragEnabled && isOverFolderDrop
            ? "bg-white/[0.05] border border-white/10 shadow-2xl"
            : "border border-transparent"
        }`}
        data-folder-drop-id={folder.id}
        data-folder-name={folder.name}
        aria-label={`${folder.name} folder`}
        {...(dragEnabled ? listeners : {})}
      >
        {collapsed ? (
          <FolderIcon className="h-4 w-4 opacity-60" />
        ) : (
          <FolderOpen className="h-4 w-4 text-[var(--accent)] opacity-60" />
        )}
        <span
          className="flex-1 truncate font-medium"
          onClick={() => setCollapsed(!collapsed)}
        >
          {folder.name}
        </span>
        {showCount ? (
          <span className="text-[10px] font-bold text-white/10 group-hover:text-white/20 transition-colors mr-1 tabular-nums">{conversations.length}</span>
        ) : null}
        <div
          data-sidebar-row-actions="folder"
          className="flex items-center gap-1 opacity-100 transition-opacity duration-300 md:opacity-0 md:group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`New chat in ${folder.name}`}
            onClick={() => onCreateInFolder(folder.id)}
            className="p-1 text-white/20 hover:text-white transition-colors duration-200"
            title={`New chat in ${folder.name}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div>
            <button
              ref={triggerRef}
              type="button"
              aria-label={`Folder actions for ${folder.name}`}
              title={`Folder actions for ${folder.name}`}
              onClick={() => { setFolderMenuOpen(!folderMenuOpen); setConfirmDeleteFolder(false); }}
              className="p-1 text-white/20 hover:text-white transition-colors duration-200"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label={collapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
          onClick={() => setCollapsed(!collapsed)}
          className="shrink-0 p-0.5 opacity-30 hover:opacity-100 transition-opacity"
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      <DropdownPortal anchorRef={triggerRef} open={folderMenuOpen}>
        <div
          ref={menuRef}
          className="w-48 rounded-2xl border border-white/5 bg-[#121214] p-2 shadow-2xl backdrop-blur-xl animate-fade-in relative"
        >
          <button
            onClick={() => setFolderMenuOpen(false)}
            className="absolute top-1.5 right-1.5 p-1 text-white/20 hover:text-white/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {confirmDeleteFolder ? (
            <div className="px-2 py-2">
              <p className="text-xs text-white/40 mb-3 px-1">Delete folder?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDeleteFolder}
                  className="flex-1 rounded-xl bg-red-500/10 text-red-400 text-xs py-2 hover:bg-red-500/20 transition-colors duration-200 font-semibold"
                >
                  Delete
                </button>
                <button
                  onClick={() => { setConfirmDeleteFolder(false); setFolderMenuOpen(false); }}
                  className="flex-1 rounded-xl bg-white/5 text-white/40 text-xs py-2 hover:bg-white/10 transition-colors duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => { setRenameOpen(true); setFolderMenuOpen(false); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
              >
                <Pencil className="h-4 w-4 opacity-50" />
                Rename
              </button>
              <button
                onClick={handleDeleteFolder}
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
        value={folder.name}
        onSave={handleRename}
        title="Rename folder"
        maxLength={100}
      />

      {!collapsed && conversations.length > 0 && (
        <div className="ml-3 mt-1 flex flex-col border-l border-white/15 pl-1.5">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={activeConversationId === conversation.id}
              onNavigate={onNavigate}
              onDeleteConversation={onDeleteConversation}
              onMoveConversation={onMoveConversation}
              allFolders={allFolders}
              dragEnabled={dragEnabled}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
}
