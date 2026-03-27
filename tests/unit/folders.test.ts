import {
  createFolder,
  deleteFolder,
  getFolder,
  getFolderConversationCount,
  listFolders,
  renameFolder,
  reorderFolders
} from "@/lib/folders";
import { createConversation, moveConversationToFolder } from "@/lib/conversations";

describe("folders", () => {
  it("creates, lists, renames, and deletes folders", () => {
    const folder = createFolder("Work");
    expect(folder.name).toBe("Work");
    expect(folder.sortOrder).toBe(0);

    const folder2 = createFolder("Personal");
    expect(folder2.sortOrder).toBe(1);

    const all = listFolders();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe("Work");
    expect(all[1].name).toBe("Personal");

    renameFolder(folder.id, "Work Projects");
    expect(getFolder(folder.id)?.name).toBe("Work Projects");

    deleteFolder(folder2.id);
    expect(listFolders()).toHaveLength(1);
    expect(getFolder(folder2.id)).toBeNull();
  });

  it("reorders folders", () => {
    const f1 = createFolder("A");
    const f2 = createFolder("B");
    const f3 = createFolder("C");

    reorderFolders([f3.id, f1.id, f2.id]);

    const reordered = listFolders();
    expect(reordered[0].id).toBe(f3.id);
    expect(reordered[1].id).toBe(f1.id);
    expect(reordered[2].id).toBe(f2.id);
  });

  it("counts conversations in a folder", () => {
    const folder = createFolder("Test");
    expect(getFolderConversationCount(folder.id)).toBe(0);

    const conv = createConversation("Chat 1", folder.id);
    expect(getFolderConversationCount(folder.id)).toBe(1);
  });
});
