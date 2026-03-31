import { arrayMove } from "@dnd-kit/sortable";

export const UNFILED_DROP_ID = "__unfiled_drop__";
export const FOLDER_DROP_PREFIX = "__folder_drop__:";

type SidebarConversationLike = {
  id: string;
  folderId: string | null;
};

type SidebarFolderLike = {
  id: string;
};

export function moveConversationForSidebarDrop<T extends SidebarConversationLike>(
  conversations: T[],
  activeId: string,
  overId: string,
  folderIds: Set<string>
) {
  const activeIndex = conversations.findIndex((conversation) => conversation.id === activeId);
  if (activeIndex === -1) {
    return null;
  }

  const overConversationIndex = conversations.findIndex((conversation) => conversation.id === overId);
  if (overConversationIndex !== -1) {
    const targetFolderId = conversations[overConversationIndex].folderId;
    return arrayMove(conversations, activeIndex, overConversationIndex).map((conversation) =>
      conversation.id === activeId ? { ...conversation, folderId: targetFolderId } : conversation
    );
  }

  const targetFolderIdFromDrop =
    overId.startsWith(FOLDER_DROP_PREFIX) ? overId.slice(FOLDER_DROP_PREFIX.length) : overId;

  if (targetFolderIdFromDrop !== UNFILED_DROP_ID && !folderIds.has(targetFolderIdFromDrop)) {
    return null;
  }

  const targetFolderId = targetFolderIdFromDrop === UNFILED_DROP_ID ? null : targetFolderIdFromDrop;
  const activeConversation = conversations[activeIndex];
  const remaining = conversations.filter((conversation) => conversation.id !== activeId);
  const insertAfterIndex = remaining.reduce(
    (index, conversation, currentIndex) =>
      conversation.folderId === targetFolderId ? currentIndex : index,
    -1
  );
  const nextConversations = [...remaining];
  nextConversations.splice(insertAfterIndex + 1, 0, {
    ...activeConversation,
    folderId: targetFolderId
  });

  return nextConversations;
}

export function reorderSidebarFolders<T extends SidebarFolderLike>(folders: T[], activeId: string, overId: string) {
  const activeIndex = folders.findIndex((folder) => folder.id === activeId);
  const overIndex = folders.findIndex((folder) => folder.id === overId);

  if (activeIndex === -1 || overIndex === -1) {
    return null;
  }

  return arrayMove(folders, activeIndex, overIndex);
}
