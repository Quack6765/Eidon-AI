"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  Settings,
  MoreHorizontal,
  FolderIcon,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Trash2,
  FolderInput,
  Pencil,
  X
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  FOLDER_DROP_PREFIX,
  moveConversationForSidebarDrop,
  reorderSidebarFolders,
  UNFILED_DROP_ID
} from "@/lib/sidebar-dnd";
import type { Conversation, Folder } from "@/lib/types";

type SidebarConversation = Conversation & { matchSnippet?: string };

function ConversationItem({
  conversation,
  active,
  onClose,
  allFolders,
  dragEnabled
}: {
  conversation: SidebarConversation;
  active: boolean;
  onClose?: () => void;
  allFolders: Folder[];
  dragEnabled: boolean;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
    if (active) {
      router.push("/");
    }
    router.refresh();
    setMenuOpen(false);
    setConfirmDelete(false);
  }

  async function handleMoveToFolder(folderId: string | null) {
    await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId })
    });
    router.refresh();
    setMenuOpen(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
    >
      <Link
        href={`/chat/${conversation.id}`}
        onClick={onClose}
        className={`group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${
          active
            ? "bg-white/10 text-white font-medium"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        }`}
      >
        <div className="relative min-w-0 flex-1 overflow-hidden">
          {conversation.matchSnippet ? (
            <div className="truncate" dangerouslySetInnerHTML={{ __html: conversation.matchSnippet }} />
          ) : (
            <div className={`truncate ${active ? "pr-8" : "group-hover:pr-8"}`}>
              {conversation.title}
            </div>
          )}

          <div
            className={`absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-[var(--sidebar)] via-[var(--sidebar)] to-transparent pl-4 pr-1 ${
              active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            onClick={(e) => e.preventDefault()}
          >
            <button
              className="text-white/50 hover:text-white transition p-1"
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

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-2 z-50 mt-1 w-52 rounded-xl border border-white/10 bg-[#2f2f2f] p-1 shadow-xl"
        >
          {confirmDelete ? (
            <div className="px-2 py-1">
              <p className="text-xs text-white/70 mb-2 px-1">Delete this conversation?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  className="flex-1 rounded-lg bg-red-500/20 text-red-400 text-xs py-1.5 hover:bg-red-500/30 transition"
                >
                  Delete
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); setMenuOpen(false); }}
                  className="flex-1 rounded-lg bg-white/5 text-white/70 text-xs py-1.5 hover:bg-white/10 transition"
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
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition"
                  >
                    <FolderInput className="h-4 w-4" />
                    No folder
                  </button>
                  {allFolders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleMoveToFolder(f.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition"
                    >
                      <FolderIcon className="h-4 w-4" />
                      {f.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-white/5" />
                </>
              )}
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FolderItem({
  folder,
  conversations,
  activeConversationId,
  allFolders,
  onClose,
  onCreateInFolder,
  dragEnabled
}: {
  folder: Folder;
  conversations: SidebarConversation[];
  activeConversationId: string | null;
  allFolders: Folder[];
  onClose?: () => void;
  onCreateInFolder: (folderId: string) => void;
  dragEnabled: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
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
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!folderMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [folderMenuOpen]);

  async function handleRename() {
    if (!renameValue.trim()) return;
    await fetch(`/api/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() })
    });
    setRenaming(false);
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
        className="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:bg-white/5 transition cursor-pointer"
        data-folder-drop-id={folder.id}
        data-folder-name={folder.name}
        aria-label={`${folder.name} folder`}
        style={dragEnabled && isOverFolderDrop ? { backgroundColor: "rgba(255,255,255,0.08)" } : undefined}
        {...(dragEnabled ? listeners : {})}
      >
        <button onClick={() => setCollapsed(!collapsed)} className="p-0.5">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {collapsed ? (
          <FolderIcon className="h-4 w-4 text-white/50" />
        ) : (
          <FolderOpen className="h-4 w-4 text-amber-400/70" />
        )}
        {renaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="flex-1 bg-transparent border-b border-white/20 text-sm text-white outline-none px-1"
          />
        ) : (
          <span
            className="flex-1 truncate"
            onClick={() => setCollapsed(!collapsed)}
          >
            {folder.name}
          </span>
        )}
        <span className="text-xs text-white/30 mr-1">{conversations.length}</span>
        <div
          className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onCreateInFolder(folder.id)}
            className="p-0.5 text-white/40 hover:text-white transition"
            title="New chat in folder"
          >
            <Plus className="h-3 w-3" />
          </button>
          <div className="relative">
            <button
              onClick={() => { setFolderMenuOpen(!folderMenuOpen); setConfirmDeleteFolder(false); }}
              className="p-0.5 text-white/40 hover:text-white transition"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
            {folderMenuOpen && (
              <div
                ref={menuRef}
                className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-white/10 bg-[#2f2f2f] p-1 shadow-xl"
              >
                {confirmDeleteFolder ? (
                  <div className="px-2 py-1">
                    <p className="text-xs text-white/70 mb-2 px-1">Delete folder?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteFolder}
                        className="flex-1 rounded-lg bg-red-500/20 text-red-400 text-xs py-1.5 hover:bg-red-500/30 transition"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteFolder(false); setFolderMenuOpen(false); }}
                        className="flex-1 rounded-lg bg-white/5 text-white/70 text-xs py-1.5 hover:bg-white/10 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setRenaming(true); setFolderMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition"
                    >
                      <Pencil className="h-4 w-4" />
                      Rename
                    </button>
                    <button
                      onClick={handleDeleteFolder}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!collapsed && conversations.length > 0 && (
        <div className="ml-4 flex flex-col">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              active={activeConversationId === conversation.id}
              onClose={onClose}
              allFolders={allFolders}
              dragEnabled={dragEnabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  conversations,
  folders: initialFolders,
  onClose
}: {
  conversations: Conversation[];
  folders?: Folder[];
  onClose?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SidebarConversation[] | null>(null);
  const [localFolders, setLocalFolders] = useState<Folder[]>(initialFolders ?? []);
  const [localConversations, setLocalConversations] = useState(conversations);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [mounted, setMounted] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    setLocalFolders(initialFolders ?? []);
  }, [initialFolders]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}`);
      const data = await res.json() as { conversations: Conversation[] };

      const highlighted = data.conversations.map((c) => ({
        ...c,
        matchSnippet: highlightMatch(c.title, query)
      }));
      setSearchResults(highlighted);
    }, 200);
  }, []);

  function highlightMatch(text: string, query: string): string {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(regex, '<mark class="bg-amber-400/30 text-white rounded px-0.5">$1</mark>');
  }

  async function handleCreate(folderId?: string) {
    const body = folderId ? { folderId } : {};
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as { conversation: Conversation };
    router.push(`/chat/${payload.conversation.id}`);
    router.refresh();
    if (onClose) onClose();
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim() })
    });
    const data = await res.json() as { folder: Folder };
    setLocalFolders((prev) => [...prev, data.folder]);
    setNewFolderName("");
    setShowNewFolder(false);
    router.refresh();
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || searchResults) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const reorderedFolders = reorderSidebarFolders(localFolders, activeId, overId);

    if (reorderedFolders) {
      setLocalFolders(reorderedFolders);
      void fetch("/api/folders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reorderedFolders.map((folder) => folder.id))
      });
      return;
    }

    const reorderedConversations = moveConversationForSidebarDrop(
      localConversations,
      activeId,
      overId,
      new Set(localFolders.map((folder) => folder.id))
    );

    if (!reorderedConversations) {
      return;
    }

    setLocalConversations(reorderedConversations);
    void fetch("/api/conversations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        reorderedConversations.map((conversation) => ({
          id: conversation.id,
          folderId: conversation.folderId
        }))
      )
    });
  }, [localConversations, localFolders, searchResults]);

  const displayedConversations = searchResults ?? localConversations;
  const unfiled = displayedConversations.filter((c) => !c.folderId);

  const folderMap = new Map<string, SidebarConversation[]>();
  for (const conv of displayedConversations) {
    if (conv.folderId) {
      const list = folderMap.get(conv.folderId) ?? [];
      list.push(conv);
      folderMap.set(conv.folderId, list);
    }
  }

  const sortableIds = [
    ...localFolders.map((f) => f.id),
    ...localConversations.map((c) => c.id)
  ];
  const { setNodeRef: setUnfiledDropRef, isOver: isOverUnfiled } = useDroppable({
    id: UNFILED_DROP_ID
  });
  const dragEnabled = mounted && !searchResults;

  function renderConversationSections(enableDrag: boolean) {
    return (
      <>
        {localFolders.map((folder) => {
          const folderConvos = folderMap.get(folder.id) ?? [];
          return (
            <div key={folder.id} className="mb-2">
              <FolderItem
                folder={folder}
                conversations={folderConvos}
                activeConversationId={activeConversationId}
                allFolders={localFolders}
                onClose={onClose}
                onCreateInFolder={(fId) => handleCreate(fId)}
                dragEnabled={enableDrag}
              />
            </div>
          );
        })}

        <div>
          <h3 className="px-2 pb-2 text-xs font-semibold text-white/40">Your chats</h3>
          <div
            ref={enableDrag ? setUnfiledDropRef : undefined}
            className={`flex flex-col rounded-lg transition ${
              enableDrag && isOverUnfiled ? "bg-white/5" : ""
            }`}
          >
            {unfiled.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                active={activeConversationId === conversation.id}
                onClose={onClose}
                allFolders={localFolders}
                dragEnabled={enableDrag}
              />
            ))}
            {!unfiled.length && !localFolders.length ? (
              <div className="px-2 py-3 text-xs text-white/40 italic">
                No conversations
              </div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <aside className="no-scrollbar flex h-full w-full flex-col bg-[var(--sidebar)] text-gray-300">
      <div className="flex h-full flex-col px-3 py-3">
        {/* Top Header */}
        <div className="flex items-center justify-between mb-2 mt-1">
          <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 transition font-semibold text-white/90 text-sm">
            <img src="/logo.png" alt="Logo" width={24} height={24} className="h-6 w-auto object-contain" />
            <span>Hermes</span>
          </button>

          <div className="flex gap-1">
             <button
               onClick={() => handleCreate()}
               className="p-1.5 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition"
               title="New chat"
             >
               <Plus className="h-5 w-5" />
             </button>
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1 mb-4">
          {searchQuery || searchResults ? (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults?.length) {
                    router.push(`/chat/${searchResults[0].id}`);
                    setSearchQuery("");
                    setSearchResults(null);
                    if (onClose) onClose();
                  }
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setSearchResults(null);
                  }
                }}
                placeholder="Search chats..."
                className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-8 pr-8 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
              />
              <button
                onClick={() => { setSearchQuery(""); setSearchResults(null); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleSearch("")}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition"
            >
               <Search className="h-4 w-4" />
               <span>Search chats</span>
            </button>
          )}
        </div>

        {/* Scrollable Nav Area */}
        <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden pr-2 -mr-2 space-y-6">
          {/* Folders Section */}
          <div>
            <h3 className="px-2 pb-2 text-xs font-semibold text-white/40">Folders</h3>
            <div className="flex flex-col gap-1">
              {showNewFolder ? (
                <div className="flex items-center gap-2 px-2">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                    }}
                    placeholder="Folder name..."
                    className="flex-1 bg-transparent border-b border-white/20 text-sm text-white outline-none py-2 placeholder:text-white/40"
                  />
                  <button onClick={handleCreateFolder} className="text-white/50 hover:text-white transition">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-white/50 hover:text-white transition">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white transition"
                >
                  <div className="h-4 w-4 border border-dashed border-white/50 rounded-sm flex items-center justify-center">
                    <Plus className="h-3 w-3" />
                  </div>
                  <span>New folder</span>
                </button>
              )}
            </div>
          </div>

          {dragEnabled ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {renderConversationSections(true)}
              </SortableContext>
            </DndContext>
          ) : (
            renderConversationSections(false)
          )}
        </div>

        {/* Bottom Settings */}
        <div className="mt-2 flex items-center border-t border-white/10 pt-3 mb-1">
          <Link
             href="/settings"
             onClick={onClose}
             aria-label="Open settings"
             className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-white/80 hover:bg-white/5 transition"
          >
             <Settings className="h-4 w-4" />
             <span>Settings</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
