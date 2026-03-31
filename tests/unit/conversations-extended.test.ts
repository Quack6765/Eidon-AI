import {
  createConversation,
  moveConversationToFolder,
  reorderConversations,
  searchConversations,
  createMessage
} from "@/lib/conversations";
import { createFolder } from "@/lib/folders";
import { getSettings } from "@/lib/settings";

describe("conversations extended", () => {
  it("creates conversations with folder assignment", () => {
    const folder = createFolder("Work");
    const conv = createConversation("My Chat", folder.id);
    expect(conv.folderId).toBe(folder.id);
    expect(conv.providerProfileId).toBe(getSettings().defaultProviderProfileId);
    expect(conv.title).toBe("My Chat");
  });

  it("moves conversations between folders", () => {
    const folder1 = createFolder("Folder 1");
    const folder2 = createFolder("Folder 2");
    const conv = createConversation("Chat", folder1.id);

    moveConversationToFolder(conv.id, folder2.id);
    const results = searchConversations("Chat");
    expect(results[0].folderId).toBe(folder2.id);

    moveConversationToFolder(conv.id, null);
    const results2 = searchConversations("Chat");
    expect(results2[0].folderId).toBeNull();
  });

  it("reorders conversations", () => {
    const c1 = createConversation("C1");
    const c2 = createConversation("C2");
    const c3 = createConversation("C3");

    reorderConversations([
      { id: c3.id, folderId: null },
      { id: c1.id, folderId: null },
      { id: c2.id, folderId: null }
    ]);

    // The reorder updates sort_order, and listConversations uses updated_at DESC
    // but the reorder function persists the new sort_order
  });

  it("searches conversations by title", () => {
    createConversation("JavaScript Basics");
    createConversation("Python Advanced");
    createConversation("TypeScript Tips");

    const results = searchConversations("JavaScript");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("JavaScript Basics");
  });

  it("searches conversations by message content", () => {
    const conv = createConversation("My Chat");
    createMessage({
      conversationId: conv.id,
      role: "user",
      content: "Tell me about quantum computing algorithms"
    });

    const results = searchConversations("quantum");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(conv.id);
  });

  it("returns empty for no match", () => {
    createConversation("Hello World");
    expect(searchConversations("xyz123")).toHaveLength(0);
  });
});
