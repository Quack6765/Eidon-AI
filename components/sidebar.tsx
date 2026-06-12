"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  X,
  MessageSquare
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  MouseSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type CollisionDetection
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";

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
  type ConversationActivityUpdatedDetail,
  type ConversationRemovedDetail,
  type ConversationTitleUpdatedDetail
} from "@/lib/conversation-events";
import { deleteConversationIfStillEmpty } from "@/lib/conversation-drafts";
import { addGlobalWsListener } from "@/lib/ws-client";
import type { ServerMessage } from "@/lib/ws-protocol";
import type { Conversation, ConversationListPage, ConversationSearchResult, Folder } from "@/lib/types";
import {
  mergeConversations,
  buildConversationSections,
  type SidebarConversation
} from "@/lib/sidebar-helpers";
import { ConversationItem } from "@/components/conversation-item";
import { FolderItem } from "@/components/folder-item";
import { SidebarFooterNav } from "@/components/sidebar-footer-nav";

export { highlightMatch } from "@/lib/sidebar-helpers";

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
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

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
    useSensor(MouseSensor, {
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
      const data = (await res.json()) as { conversations: ConversationSearchResult[] };
      setSearchResults(data.conversations);
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
    const sentinel = loadMoreSentinelRef.current;
    const scrollRoot = scrollContainerRef.current;
    if (!sentinel || !scrollRoot || !hasMoreConversations) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreConversations();
        }
      },
      { root: scrollRoot, rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreConversations, loadMoreConversations, mounted]);

  useEffect(() => {
    function handleConversationTitleUpdated(
      event: Event
    ) {
      const detail = (event as CustomEvent<ConversationTitleUpdatedDetail>).detail;

      setLocalConversations((current) =>
        current.map((conversation) =>
          conversation.id === detail.conversationId
            ? { ...conversation, title: detail.title, titleGenerationStatus: "completed" as const }
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
                    titleGenerationStatus: "completed" as const
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
  }, []);

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
          const newConv = msg.conversation as Conversation;
          if (newConv.isTemporary) {
            break;
          }
          setLocalConversations((current) =>
            mergeConversations([newConv], current)
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
        case "conversation_activity": {
          setLocalConversations((current) =>
            current.map((conversation) =>
              conversation.id === msg.conversationId
                ? { ...conversation, isActive: msg.isActive }
                : conversation
            )
          );
          break;
        }
        case "conversation_title_updated": {
          setLocalConversations((current) =>
            current.map((conversation) =>
              conversation.id === msg.conversationId
                ? { ...conversation, title: msg.title, titleGenerationStatus: "completed" }
                : conversation
            )
          );
          break;
        }
      }
    });
  }, []);

  async function handleCreate(folderId?: string) {
    await deleteConversationIfStillEmpty(activeConversationId);
    const body = folderId ? { folderId } : {};
    const response = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as { conversation: Conversation };
    const href = `/chat/${payload.conversation.id}`;
    if (onClose) onClose();
    router.push(href);
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
    const { active, over } = event;
    const activeId = String(active.id);
    const isConversationDrag = localConversations.some((conversation) => conversation.id === activeId);
    const dragPointer = dragPointerRef.current;
    const fallbackFolderId =
      isConversationDrag && dragPointer && (!over || active.id === over.id)
        ? document
            .elementFromPoint(dragPointer.x, dragPointer.y)
            ?.closest<HTMLElement>("[data-folder-drop-id]")
            ?.dataset.folderDropId ?? null
        : null;
    const rawOverId = fallbackFolderId
      ? `${FOLDER_DROP_PREFIX}${fallbackFolderId}`
      : over && active.id !== over.id
        ? String(over.id)
        : null;
    const isRawFolderDrop =
      isConversationDrag &&
      rawOverId &&
      localFolders.some((folder) => folder.id === rawOverId);
    const overId = isRawFolderDrop ? `${FOLDER_DROP_PREFIX}${rawOverId}` : rawOverId;

    setActiveDragId(null);
    dragPointerRef.current = null;

    if (!overId || searchResults) return;

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

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const rect = event.active.rect.current.translated ?? event.active.rect.current.initial;

    if (!rect) {
      return;
    }

    dragPointerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, []);

  useEffect(() => {
    if (!activeDragId) {
      dragPointerRef.current = null;
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      dragPointerRef.current = {
        x: event.clientX,
        y: event.clientY
      };
    }

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [activeDragId]);

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
  const activeDragConversation = activeDragId
    ? localConversations.find((c) => c.id === activeDragId)
    : null;

  function renderConversationSections(enableDrag: boolean) {
    return (
      <>
        <div>
          <div
            ref={enableDrag ? setUnfiledDropRef : undefined}
            className={`flex flex-col rounded-xl transition-colors duration-200 ${
              enableDrag && isOverUnfiled ? "bg-white/[0.03]" : ""
            }`}
          >
            {unfiledSections.map((section) => (
              <div key={section.label} className="mb-4">
                <div className="px-2 mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">
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
                    searchQuery={searchQuery}
                  />
                ))}
              </div>
            ))}
            {!unfiled.length && !localFolders.length ? (
              <div className="px-3 py-4 text-xs text-white/20 italic text-center">
                No conversations yet
              </div>
            ) : null}
            {hasMoreConversations && !searchResults ? (
              <div ref={loadMoreSentinelRef} className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/20">
                {isLoadingMore ? "Loading older chats" : ""}
              </div>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <aside className="no-scrollbar flex h-full w-full flex-col bg-transparent text-gray-300">
      <div className="flex h-full min-h-0 flex-col px-4 py-6">
        <div className="mb-4 px-2 flex items-center justify-between">
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
            className="flex items-center transition-opacity hover:opacity-80"
          >
            <span
              style={{
                filter: "drop-shadow(0 0 8px rgba(139,92,246,0.5)) drop-shadow(0 0 20px rgba(139,92,246,0.25)) drop-shadow(0 0 36px rgba(139,92,246,0.12))",
              }}
            >
              <span
                className="font-bold tracking-[0.12em] leading-none inline-block text-[24px]"
                style={{
                  fontFamily: "var(--font-wordmark), 'Eurostile', 'Space Grotesk', sans-serif",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundImage: "linear-gradient(to bottom, #FFFFFF 0%, #D4C8FF 40%, #8b5cf6 100%)",
                }}
              >
                Eidon
              </span>
            </span>
          </Link>
          <button
            onClick={() => handleCreate()}
            disabled={!mounted}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 ${
              mounted
                ? "bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)] hover:opacity-90 hover:scale-[0.98] active:scale-[0.96]"
                : "cursor-not-allowed bg-white/[0.04] text-white/30"
            }`}
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 mb-4">
          {showSearch || searchQuery || searchResults ? (
            <div className="relative group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20 transition-colors group-focus-within:text-[var(--accent)]/50" />
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
                placeholder="Search"
                className="w-full rounded-2xl border border-white/5 bg-white/[0.02] py-2.5 pl-10 pr-9 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[var(--accent)]/20 focus:bg-white/[0.04] transition-all duration-300"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                  setSearchResults(null);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white transition-colors p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSearch(true)}
              disabled={!mounted}
              className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm transition-all duration-300 group ${
                mounted
                  ? "text-white/30 hover:bg-white/[0.03] hover:text-white/50"
                  : "cursor-not-allowed text-white/15"
              }`}
            >
              <Search className="h-4 w-4 opacity-50 group-hover:opacity-100" />
              <span>Search</span>
            </button>
          )}
        </div>

        <div
          ref={scrollContainerRef}
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 -mr-1"
        >
          {dragEnabled ? (
            <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <div>
                  <div className="flex items-center justify-between px-2 mb-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">
                      Folders
                    </div>
                    {!showNewFolder && (
                      <button
                        onClick={() => setShowNewFolder(true)}
                        aria-label="New folder"
                        title="New folder"
                        className="p-1 text-white/20 hover:text-white/50 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {showNewFolder && (
                    <div className="flex items-center gap-2 px-2 py-1 mb-2 animate-fade-in">
                      <input
                        autoFocus
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateFolder();
                          if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                        }}
                        placeholder="Folder name"
                        className="flex-1 bg-transparent border-b border-white/10 text-sm text-white outline-none py-1 placeholder:text-white/20"
                      />
                      <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-white/20 hover:text-white transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
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
                          dragEnabled
                          showCount={showFolderCounts}
                          searchQuery={searchQuery}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4">
                  {renderConversationSections(true)}
                </div>
              </SortableContext>
              <DragOverlay>
                {activeDragConversation ? (
                  <div className="pointer-events-none flex items-center gap-3 rounded-2xl px-4 py-3 text-sm bg-white/[0.08] text-white font-medium shadow-2xl backdrop-blur-xl border border-white/10 opacity-90">
                    <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                    <span className="truncate max-w-[200px]">{activeDragConversation.title}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <>
              <div>
                <div className="flex items-center justify-between px-2 mb-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/20">
                    Folders
                  </div>
                  {!showNewFolder && (
                    <button
                      onClick={() => setShowNewFolder(true)}
                      aria-label="New folder"
                      title="New folder"
                      className="p-1 text-white/20 hover:text-white/50 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {showNewFolder && (
                  <div className="flex items-center gap-2 px-2 py-1 mb-2 animate-fade-in">
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateFolder();
                        if (e.key === "Escape") { setShowNewFolder(false); setNewFolderName(""); }
                      }}
                      placeholder="Folder name"
                      className="flex-1 bg-transparent border-b border-white/10 text-sm text-white outline-none py-1 placeholder:text-white/20"
                    />
                    <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-white/20 hover:text-white transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
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
                        dragEnabled={false}
                        showCount={showFolderCounts}
                        searchQuery={searchQuery}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-4">
                {renderConversationSections(false)}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 mt-auto bg-white/[0.02] -mx-4 px-4 border-t border-white/[0.12]">
          <SidebarFooterNav onNavigateAction={navigateToHref} />
        </div>
      </div>
    </aside>
  );
}
