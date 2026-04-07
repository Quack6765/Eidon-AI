"use client";

import { useState, useRef, useEffect, useCallback, type MouseEvent as ReactMouseEvent } from "react";
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
  X,
  MessageSquare,
  LoaderCircle
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection
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
import {
  CONVERSATION_ACTIVITY_UPDATED_EVENT,
  CONVERSATION_REMOVED_EVENT,
  CONVERSATION_TITLE_UPDATED_EVENT,
  dispatchConversationRemoved,
  type ConversationActivityUpdatedDetail,
  type ConversationRemovedDetail,
  type ConversationTitleUpdatedDetail
} from "@/lib/conversation-events";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { addGlobalWsListener } from "@/lib/ws-client";
import type { ServerMessage } from "@/lib/ws-protocol";
import type { Conversation, ConversationListPage, Folder } from "@/lib/types";

type SidebarConversation = Conversation & { matchSnippet?: string };

type ConversationSection = {
  label: string;
  conversations: SidebarConversation[];
};

function compareConversations(left: Conversation, right: Conversation) {
  if (left.updatedAt === right.updatedAt) {
    return right.id.localeCompare(left.id);
  }
  return left.updatedAt > right.updatedAt ? -1 : 1;
}

function mergeConversations(current: Conversation[], incoming: Conversation[]) {
  const merged = new Map(current.map((conversation) => [conversation.id, conversation]));
  incoming.forEach((conversation) => {
    merged.set(conversation.id, conversation);
  });
  return [...merged.values()].sort(compareConversations);
}

function getConversationSectionLabel(timestamp: string, now: Date) {
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);

  const updatedAt = new Date(timestamp);
  const updatedDay = new Date(updatedAt);
  updatedDay.setHours(0, 0, 0, 0);

  if (updatedDay.getTime() === current.getTime()) {
    return "Today";
  }

  const yesterday = new Date(current);
  yesterday.setDate(yesterday.getDate() - 1);
  if (updatedDay.getTime() === yesterday.getTime()) {
    return "Yesterday";
  }

  const weekStart = new Date(current);
  const offset = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - offset);
  if (updatedDay >= weekStart) {
    return "This Week";
  }

  const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
  if (updatedDay >= monthStart) {
    return "This Month";
  }

  return "Older";
}

function buildConversationSections(conversations: SidebarConversation[]) {
  const sections = new Map<string, SidebarConversation[]>();
  const now = new Date();

  conversations.forEach((conversation) => {
    const label = getConversationSectionLabel(conversation.updatedAt, now);
    const list = sections.get(label) ?? [];
    list.push(conversation);
    sections.set(label, list);
  });

  return ["Today", "Yesterday", "This Week", "This Month", "Older"]
    .map((label) => ({
      label,
      conversations: sections.get(label) ?? []
    }))
    .filter((section) => section.conversations.length > 0);
}

function ConversationItem({
  conversation,
  active,
  onNavigate,
  onDeleteConversation,
  onMoveConversation,
  allFolders,
  dragEnabled
}: {
  conversation: SidebarConversation;
  active: boolean;
  onNavigate?: (conversationId: string, href: string) => void | Promise<void>;
  onDeleteConversation: (conversationId: string) => void;
  onMoveConversation: (conversationId: string, folderId: string | null) => void;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(dragEnabled ? attributes : {})}
      {...(dragEnabled ? listeners : {})}
    >
      <Link
        href={`/chat/${conversation.id}`}
        onClick={handleNavigate}
        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
          active
            ? "bg-[var(--accent-soft)] text-white font-medium"
            : "text-white/60 hover:bg-white/[0.04] hover:text-white/90"
        }`}
      >
        {conversation.isActive ? (
          <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-white/45 transition-opacity duration-200" />
        ) : (
          <MessageSquare className="h-4 w-4 shrink-0 opacity-40 transition-opacity duration-200" />
        )}

        <div className="relative min-w-0 flex-1 overflow-hidden">
          {conversation.matchSnippet ? (
            <div className="truncate" dangerouslySetInnerHTML={{ __html: conversation.matchSnippet }} />
          ) : (
            <div className={`truncate ${active ? "pr-8" : "group-hover:pr-8"}`}>
              {conversation.title}
            </div>
          )}

          <div
            className={`absolute right-0 top-0 bottom-0 flex items-center bg-gradient-to-l from-[var(--sidebar)] via-[var(--sidebar)] to-transparent pl-4 pr-1 transition-opacity duration-200 ${
              active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            onClick={(e) => e.preventDefault()}
          >
            <button
              className="text-white/40 hover:text-white transition-colors duration-200 p-1 rounded-md hover:bg-white/5"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(!menuOpen);
                setConfirmDelete(false);
              }}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Link>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-4 z-50 mt-1 w-52 rounded-xl border border-white/8 bg-[#1e1e22] p-1.5 shadow-xl animate-fade-in"
        >
          {confirmDelete ? (
            <div className="px-2 py-1.5">
              <p className="text-xs text-white/60 mb-2.5 px-1">Delete this conversation?</p>
              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  className="flex-1 rounded-lg bg-red-500/15 text-red-400 text-xs py-2 hover:bg-red-500/25 transition-colors duration-200 font-medium"
                >
                  Delete
                </button>
                <button
                  onClick={() => { setConfirmDelete(false); setMenuOpen(false); }}
                  className="flex-1 rounded-lg bg-white/5 text-white/60 text-xs py-2 hover:bg-white/10 transition-colors duration-200"
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
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
                  >
                    <FolderInput className="h-3.5 w-3.5" />
                    No folder
                  </button>
                  {allFolders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleMoveToFolder(f.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
                    >
                      <FolderIcon className="h-3.5 w-3.5" />
                      {f.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-white/5" />
                </>
              )}
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/8 transition-colors duration-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
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
  onNavigate,
  onDeleteConversation,
  onMoveConversation,
  onCreateInFolder,
  dragEnabled,
  showCount,
  isDraggingConversation
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
  isDraggingConversation: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
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
  } = useSortable({ id: folder.id, disabled: isDraggingConversation });
  const {
    setNodeRef: setFolderDropRef,
    isOver: isOverFolderDrop
  } = useDroppable({
    id: `${FOLDER_DROP_PREFIX}${folder.id}`
  });

  const style = isDraggingConversation ? undefined : {
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
        className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/60 hover:bg-white/[0.04] transition-all duration-200 cursor-pointer ${
          dragEnabled && isOverFolderDrop
            ? "bg-[var(--accent-soft)] border border-[var(--accent)]/30 shadow-[0_0_12px_var(--accent-glow)]"
            : "border border-transparent"
        }`}
        data-folder-drop-id={folder.id}
        data-folder-name={folder.name}
        aria-label={`${folder.name} folder`}
        {...(dragEnabled ? listeners : {})}
      >
        <button onClick={() => setCollapsed(!collapsed)} className="p-0.5 opacity-50">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {collapsed ? (
          <FolderIcon className="h-4 w-4 opacity-40" />
        ) : (
          <FolderOpen className="h-4 w-4 text-amber-400/50" />
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
        {showCount ? (
          <span className="text-[11px] text-white/25 mr-1 tabular-nums">{conversations.length}</span>
        ) : null}
        <div
          className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onCreateInFolder(folder.id)}
            className="p-0.5 text-white/30 hover:text-white transition-colors duration-200"
            title="New chat in folder"
          >
            <Plus className="h-3 w-3" />
          </button>
          <div className="relative">
            <button
              onClick={() => { setFolderMenuOpen(!folderMenuOpen); setConfirmDeleteFolder(false); }}
              className="p-0.5 text-white/30 hover:text-white transition-colors duration-200"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
            {folderMenuOpen && (
              <div
                ref={menuRef}
                className="absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-white/8 bg-[#1e1e22] p-1.5 shadow-xl animate-fade-in"
              >
                {confirmDeleteFolder ? (
                  <div className="px-2 py-1.5">
                    <p className="text-xs text-white/60 mb-2 px-1">Delete folder?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleDeleteFolder}
                        className="flex-1 rounded-lg bg-red-500/15 text-red-400 text-xs py-1.5 hover:bg-red-500/25 transition-colors duration-200"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => { setConfirmDeleteFolder(false); setFolderMenuOpen(false); }}
                        className="flex-1 rounded-lg bg-white/5 text-white/60 text-xs py-1.5 hover:bg-white/10 transition-colors duration-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setRenaming(true); setFolderMenuOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/60 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button
                      onClick={handleDeleteFolder}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/8 transition-colors duration-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
        <div className="ml-5 flex flex-col border-l border-white/6">
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  conversationPage,
  folders: initialFolders,
  onClose
}: {
  conversationPage: ConversationListPage;
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
  const [showSearch, setShowSearch] = useState(false);
  const [localFolders, setLocalFolders] = useState<Folder[]>(initialFolders ?? []);
  const [localConversations, setLocalConversations] = useState(conversationPage.conversations);
  const [hasMoreConversations, setHasMoreConversations] = useState(conversationPage.hasMore);
  const [nextCursor, setNextCursor] = useState(conversationPage.nextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [mounted, setMounted] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const navigateToHref = useCallback(
    async (href: string, nextConversationId?: string) => {
      if (href === pathname) {
        if (onClose) {
          onClose();
        }
        return;
      }

      if (activeConversationId && activeConversationId !== nextConversationId) {
        await deleteConversationIfStillEmpty(activeConversationId);
      }

      router.push(href);
      if (onClose) {
        onClose();
      }
    },
    [activeConversationId, onClose, pathname, router]
  );

  useEffect(() => {
    setLocalConversations((current) => {
      if (!current.length) {
        return conversationPage.conversations;
      }

      const incomingIds = new Set(conversationPage.conversations.map((conversation) => conversation.id));
      const retained = current.filter((conversation) => !incomingIds.has(conversation.id));
      return mergeConversations(retained, conversationPage.conversations);
    });
    setHasMoreConversations(conversationPage.hasMore);
    setNextCursor((current) => current ?? conversationPage.nextCursor);
  }, [conversationPage]);

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

  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);

    if (pointerCollisions.length > 0) {
      const folderDropCollision = pointerCollisions.find((collision) =>
        String(collision.id).startsWith(FOLDER_DROP_PREFIX)
      );
      if (folderDropCollision) {
        return [folderDropCollision];
      }
      return pointerCollisions;
    }

    return closestCenter(args);
  };

  const removeConversationFromState = useCallback((conversationId: string) => {
    setLocalConversations((current) =>
      current.filter((conversation) => conversation.id !== conversationId)
    );
    setSearchResults((current) =>
      current
        ? current.filter((conversation) => conversation.id !== conversationId)
        : current
    );
  }, []);

  const moveConversationInState = useCallback(
    (conversationId: string, folderId: string | null) => {
      const updatedAt = new Date().toISOString();

      setLocalConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, folderId, updatedAt }
            : conversation
        )
      );
      setSearchResults((current) =>
        current
          ? current.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, folderId, updatedAt }
                : conversation
            )
          : current
      );
    },
    []
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
      const data = (await res.json()) as { conversations: Conversation[] };

      const highlighted = data.conversations.map((c) => ({
        ...c,
        matchSnippet: highlightMatch(c.title, query)
      }));
      setSearchResults(highlighted);
    }, 200);
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (isLoadingMore || !hasMoreConversations || !nextCursor || searchResults) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const params = new URLSearchParams({ cursor: nextCursor });
      const response = await fetch(`/api/conversations?${params.toString()}`);
      const data = (await response.json()) as ConversationListPage;
      setLocalConversations((current) => mergeConversations(current, data.conversations));
      setHasMoreConversations(data.hasMore);
      setNextCursor(data.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMoreConversations, isLoadingMore, nextCursor, searchResults]);

  useEffect(() => {
    function handleConversationTitleUpdated(
      event: Event
    ) {
      const detail = (event as CustomEvent<ConversationTitleUpdatedDetail>).detail;

      setLocalConversations((current) =>
        current.map((conversation) =>
          conversation.id === detail.conversationId
            ? { ...conversation, title: detail.title }
            : conversation
        )
      );
      setSearchResults((current) =>
        current
          ? current.map((conversation) =>
              conversation.id === detail.conversationId
                ? {
                    ...conversation,
                    title: detail.title,
                    matchSnippet: searchQuery.trim()
                      ? highlightMatch(detail.title, searchQuery)
                      : conversation.matchSnippet
                  }
                : conversation
            )
          : current
      );
    }

    window.addEventListener(
      CONVERSATION_TITLE_UPDATED_EVENT,
      handleConversationTitleUpdated as EventListener
    );

    return () => {
      window.removeEventListener(
        CONVERSATION_TITLE_UPDATED_EVENT,
        handleConversationTitleUpdated as EventListener
      );
    };
  }, [searchQuery]);

  useEffect(() => {
    function handleConversationRemoved(event: Event) {
      const detail = (event as CustomEvent<ConversationRemovedDetail>).detail;

      setLocalConversations((current) =>
        current.filter((conversation) => conversation.id !== detail.conversationId)
      );
      setSearchResults((current) =>
        current
          ? current.filter((conversation) => conversation.id !== detail.conversationId)
          : current
      );
    }

    window.addEventListener(
      CONVERSATION_REMOVED_EVENT,
      handleConversationRemoved as EventListener
    );

    return () => {
      window.removeEventListener(
        CONVERSATION_REMOVED_EVENT,
        handleConversationRemoved as EventListener
      );
    };
  }, []);

  useEffect(() => {
    function handleConversationActivityUpdated(event: Event) {
      const detail = (event as CustomEvent<ConversationActivityUpdatedDetail>).detail;

      setLocalConversations((current) =>
        current.map((conversation) =>
          conversation.id === detail.conversationId
            ? { ...conversation, isActive: detail.isActive }
            : conversation
        )
      );
    }

    window.addEventListener(
      CONVERSATION_ACTIVITY_UPDATED_EVENT,
      handleConversationActivityUpdated as EventListener
    );

    return () => {
      window.removeEventListener(
        CONVERSATION_ACTIVITY_UPDATED_EVENT,
        handleConversationActivityUpdated as EventListener
      );
    };
  }, []);

  useEffect(() => {
    return addGlobalWsListener((msg: ServerMessage) => {
      switch (msg.type) {
        case "conversation_created": {
          setLocalConversations((current) =>
            mergeConversations([msg.conversation as Conversation], current)
          );
          break;
        }
        case "conversation_deleted": {
          const conversationId = msg.conversationId;
          setLocalConversations((current) =>
            current.filter((c) => c.id !== conversationId)
          );
          setSearchResults((current) =>
            current ? current.filter((c) => c.id !== conversationId) : current
          );
          break;
        }
        case "conversation_updated": {
          setLocalConversations((current) =>
            mergeConversations([msg.conversation as Conversation], current)
          );
          break;
        }
      }
    });
  }, []);

  function highlightMatch(text: string, query: string): string {
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(regex, '<mark class="bg-[var(--accent)]/30 text-white rounded px-0.5">$1</mark>');
  }

  async function handleCreate(folderId?: string) {
    await deleteConversationIfStillEmpty(activeConversationId);
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
    const data = (await res.json()) as { folder: Folder };
    setLocalFolders((prev) => [...prev, data.folder]);
    setNewFolderName("");
    setShowNewFolder(false);
    router.refresh();
  }

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragId(null);
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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const displayedConversations = searchResults ?? localConversations;
  const unfiled = displayedConversations.filter((c) => !c.folderId);
  const unfiledSections = buildConversationSections(unfiled);

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
  const showFolderCounts = !hasMoreConversations && !searchResults;
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const isDraggingConversation = activeDragId ? !localFolders.some((f) => f.id === activeDragId) : false;
  const activeDragConversation = activeDragId
    ? localConversations.find((c) => c.id === activeDragId)
    : null;

  function renderConversationSections(enableDrag: boolean, draggingConversation: boolean) {
    return (
      <>
        {localFolders.map((folder) => {
          const folderConvos = folderMap.get(folder.id) ?? [];
          return (
            <div key={folder.id} className="mb-1">
              <FolderItem
                folder={folder}
                conversations={folderConvos}
                activeConversationId={activeConversationId}
                allFolders={localFolders}
                onNavigate={navigateToHref}
                onDeleteConversation={removeConversationFromState}
                onMoveConversation={moveConversationInState}
                onCreateInFolder={(fId) => handleCreate(fId)}
                dragEnabled={enableDrag}
                showCount={showFolderCounts}
                isDraggingConversation={draggingConversation}
              />
            </div>
          );
        })}

        <div>
          <div
            ref={enableDrag ? setUnfiledDropRef : undefined}
            className={`flex flex-col rounded-xl transition-colors duration-200 ${
              enableDrag && isOverUnfiled ? "bg-white/[0.03]" : ""
            }`}
          >
            {unfiledSections.map((section) => (
              <div key={section.label}>
                <div className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/25">
                  {section.label}
                </div>
                {section.conversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    active={activeConversationId === conversation.id}
                    onNavigate={navigateToHref}
                    onDeleteConversation={removeConversationFromState}
                    onMoveConversation={moveConversationInState}
                    allFolders={localFolders}
                    dragEnabled={enableDrag}
                  />
                ))}
              </div>
            ))}
            {!unfiled.length && !localFolders.length ? (
              <div className="px-3 py-4 text-xs text-white/20 italic text-center">
                No conversations yet
              </div>
            ) : null}
            {isLoadingMore ? (
              <div className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/20">
                Loading older chats
              </div>
            ) : null}
            {hasMoreConversations && !searchResults ? (
              <div className="flex justify-center px-3 py-1">
                <button
                  type="button"
                  onClick={() => void loadMoreConversations()}
                  className="inline-flex h-6 items-center rounded-md px-2 text-[10px] font-medium tracking-[0.08em] text-white/24 transition-colors duration-150 hover:bg-white/[0.03] hover:text-white/48"
                >
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <aside className="no-scrollbar flex h-full w-full flex-col bg-[var(--sidebar)] text-gray-300">
      <div className="flex h-full flex-col px-3 py-4">
        <div className="mb-4 px-1">
          <Link
            href="/"
            onClick={(event) => {
              if (
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
              void navigateToHref("/");
            }}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors duration-200"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-white text-xs font-bold shadow-[0_0_12px_var(--accent-glow)]">
              E
            </div>
            <span className="font-semibold text-white/90 text-sm tracking-wide">Eidon</span>
          </Link>
        </div>

        <div className="flex flex-col gap-1 mb-4">
          {showSearch || searchQuery || searchResults ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchResults?.length) {
                    void navigateToHref(`/chat/${searchResults[0].id}`, searchResults[0].id);
                    setShowSearch(false);
                    setSearchQuery("");
                    setSearchResults(null);
                  }
                  if (e.key === "Escape") {
                    setShowSearch(false);
                    setSearchQuery("");
                    setSearchResults(null);
                  }
                }}
                placeholder="Search chats..."
                className="w-full rounded-xl border border-white/6 bg-white/[0.03] py-2.5 pl-9 pr-8 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--accent)]/30 transition-all duration-200"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                  setSearchResults(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white transition-colors duration-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSearch(true)}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-all duration-200"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search chats</span>
            </button>
          )}

          <button
            onClick={() => handleCreate()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent-soft)] px-3 py-3 text-sm font-medium text-white shadow-[0_0_18px_rgba(139,92,246,0.12)] transition-all duration-200 hover:border-[var(--accent)]/35 hover:bg-[var(--accent)]/16 hover:shadow-[0_0_22px_rgba(139,92,246,0.18)]"
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
            <span>New chat</span>
          </button>
        </div>

        <div
          ref={scrollContainerRef}
          className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden pr-1 -mr-1 space-y-4"
        >
          <div>
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/25">
              Folders
            </div>
            <div className="flex flex-col gap-0.5">
              {showNewFolder ? (
                <div className="flex items-center gap-2 px-3">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                    }}
                    placeholder="Folder name..."
                    className="flex-1 bg-transparent border-b border-white/15 text-sm text-white outline-none py-2 placeholder:text-white/25"
                  />
                  <button onClick={handleCreateFolder} className="text-white/40 hover:text-white transition-colors duration-200">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-white/40 hover:text-white transition-colors duration-200">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-all duration-200"
                >
                  <div className="h-4 w-4 border border-dashed border-white/20 rounded flex items-center justify-center">
                    <Plus className="h-2.5 w-2.5" />
                  </div>
                  <span>New folder</span>
                </button>
              )}
            </div>
          </div>

          {dragEnabled ? (
            <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {renderConversationSections(true, isDraggingConversation)}
              </SortableContext>
              <DragOverlay>
                {activeDragConversation ? (
                  <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm bg-[var(--accent-soft)] text-white font-medium shadow-lg opacity-90">
                    <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                    <span className="truncate max-w-[200px]">{activeDragConversation.title}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            renderConversationSections(false, false)
          )}
        </div>

        <div className="mt-3 flex items-center border-t border-white/6 pt-3">
          <Link
            href="/settings"
            onClick={(event) => {
              if (
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
              void navigateToHref("/settings");
            }}
            aria-label="Open settings"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/50 hover:bg-white/[0.04] hover:text-white/80 transition-all duration-200"
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
