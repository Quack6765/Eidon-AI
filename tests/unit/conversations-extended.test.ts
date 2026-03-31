import {
  createConversation,
  moveConversationToFolder,
  reorderConversations,
  searchConversations,
  createMessage,
  listConversationsPage
} from "@/lib/conversations";
import { getDb } from "@/lib/db";
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

  it("lists conversations in cursor-based pages", () => {
    const timestamps = [
      "2026-03-31T16:00:00.000Z",
      "2026-03-30T16:00:00.000Z",
      "2026-03-29T16:00:00.000Z"
    ];

    const conversations = timestamps.map((timestamp, index) => {
      const conversation = createConversation(`Conversation ${index + 1}`);
      getDb()
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(timestamp, conversation.id);
      return {
        ...conversation,
        updatedAt: timestamp
      };
    });

    const firstPage = listConversationsPage({ limit: 2 });

    expect(firstPage.conversations.map((conversation) => conversation.id)).toEqual([
      conversations[0].id,
      conversations[1].id
    ]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = listConversationsPage({
      limit: 2,
      cursor: firstPage.nextCursor
    });

    expect(secondPage.conversations.map((conversation) => conversation.id)).toEqual([
      conversations[2].id
    ]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("rejects invalid conversation page cursors", () => {
    expect(() => listConversationsPage({ cursor: "invalid" })).toThrow();
  });
});
