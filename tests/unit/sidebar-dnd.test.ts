import {
  FOLDER_DROP_PREFIX,
  moveConversationForSidebarDrop,
  reorderSidebarFolders,
  UNFILED_DROP_ID
} from "@/lib/sidebar-dnd";

describe("sidebar dnd helpers", () => {
  it("moves a conversation into a folder when dropped on the folder row", () => {
    const conversations = [
      { id: "conv-1", folderId: null },
      { id: "conv-2", folderId: "folder-2" }
    ];

    const reordered = moveConversationForSidebarDrop(
      conversations,
      "conv-1",
      `${FOLDER_DROP_PREFIX}folder-1`,
      new Set(["folder-1", "folder-2"])
    );

    expect(reordered).not.toBeNull();
    expect(reordered?.find((conversation) => conversation.id === "conv-1")?.folderId).toBe("folder-1");
    expect(reordered?.find((conversation) => conversation.id === "conv-2")?.folderId).toBe("folder-2");
  });

  it("moves a conversation into the hovered conversation folder", () => {
    const conversations = [
      { id: "conv-1", folderId: null },
      { id: "conv-2", folderId: "folder-1" },
      { id: "conv-3", folderId: "folder-1" }
    ];

    const reordered = moveConversationForSidebarDrop(
      conversations,
      "conv-1",
      "conv-3",
      new Set(["folder-1"])
    );

    expect(reordered).toEqual([
      { id: "conv-2", folderId: "folder-1" },
      { id: "conv-3", folderId: "folder-1" },
      { id: "conv-1", folderId: "folder-1" }
    ]);
  });

  it("moves a conversation back to the unfiled list", () => {
    const conversations = [
      { id: "conv-1", folderId: "folder-1" },
      { id: "conv-2", folderId: null },
      { id: "conv-3", folderId: null }
    ];

    const reordered = moveConversationForSidebarDrop(
      conversations,
      "conv-1",
      UNFILED_DROP_ID,
      new Set(["folder-1"])
    );

    expect(reordered).toEqual([
      { id: "conv-2", folderId: null },
      { id: "conv-3", folderId: null },
      { id: "conv-1", folderId: null }
    ]);
  });

  it("returns null when the active conversation is not found", () => {
    const conversations = [{ id: "conv-1", folderId: null }];

    const reordered = moveConversationForSidebarDrop(
      conversations,
      "conv-missing",
      "conv-1",
      new Set()
    );

    expect(reordered).toBeNull();
  });

  it("returns null when dropping onto an invalid folder id that is not a known folder", () => {
    const conversations = [{ id: "conv-1", folderId: null }];

    const reordered = moveConversationForSidebarDrop(
      conversations,
      "conv-1",
      "unknown-folder",
      new Set(["folder-1"])
    );

    expect(reordered).toBeNull();
  });

  it("returns null when reordering folders with a missing active id", () => {
    const folders = [{ id: "folder-1" }, { id: "folder-2" }];

    expect(reorderSidebarFolders(folders, "folder-missing", "folder-1")).toBeNull();
  });

  it("returns null when reordering folders with a missing over id", () => {
    const folders = [{ id: "folder-1" }, { id: "folder-2" }];

    expect(reorderSidebarFolders(folders, "folder-1", "folder-missing")).toBeNull();
  });

  it("reorders folders when a folder is dropped over another folder", () => {
    const folders = [{ id: "folder-1" }, { id: "folder-2" }, { id: "folder-3" }];

    expect(reorderSidebarFolders(folders, "folder-3", "folder-1")).toEqual([
      { id: "folder-3" },
      { id: "folder-1" },
      { id: "folder-2" }
    ]);
  });
});
