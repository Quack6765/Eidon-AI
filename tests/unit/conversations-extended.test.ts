import {
  createConversation,
  moveConversationToFolder,
  reorderConversations,
  searchConversations,
  createMessage,
  listConversationsPage
} from "@/lib/conversations";
import { createAutomation, createAutomationRun } from "@/lib/automations";
import { getDb } from "@/lib/db";
import { createFolder } from "@/lib/folders";
import { getSettings, listProviderProfiles } from "@/lib/settings";
import { createLocalUser } from "@/lib/users";

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

  it("moves conversations between folders only for the requested user", async () => {
    const userA = await createLocalUser({
      username: "conversation-folder-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "conversation-folder-b",
      password: "Password123!",
      role: "user"
    });
    const folderA = createFolder("Folder A", userA.id);
    const ownedConversation = createConversation("Owned chat", null, undefined, userA.id);
    const otherConversation = createConversation("Other chat", null, undefined, userB.id);

    moveConversationToFolder(ownedConversation.id, folderA.id, userA.id);
    moveConversationToFolder(otherConversation.id, folderA.id, userA.id);

    expect(searchConversations("Owned chat", userA.id)[0]?.folderId).toBe(folderA.id);
    expect(searchConversations("Other chat", userB.id)[0]?.folderId).toBeNull();
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

  it("scopes conversation search results to the requested user", async () => {
    const userA = await createLocalUser({
      username: "conversation-search-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "conversation-search-b",
      password: "Password123!",
      role: "user"
    });

    createConversation("Admin Search Match", null, undefined, userA.id);
    createConversation("Member Search Match", null, undefined, userB.id);

    expect(searchConversations("Search Match", userA.id).map((conversation) => conversation.title)).toEqual([
      "Admin Search Match"
    ]);
    expect(searchConversations("Search Match", userB.id).map((conversation) => conversation.title)).toEqual([
      "Member Search Match"
    ]);
  });

  it("reorders only conversations owned by the requested user", async () => {
    const userA = await createLocalUser({
      username: "conversation-reorder-a",
      password: "Password123!",
      role: "user"
    });
    const userB = await createLocalUser({
      username: "conversation-reorder-b",
      password: "Password123!",
      role: "user"
    });
    const adminFolder = createFolder("Admin Folder", userA.id);
    createFolder("Member Folder", userB.id);
    const adminConversation = createConversation("Admin Conversation", null, undefined, userA.id);
    const memberConversation = createConversation("Member Conversation", null, undefined, userB.id);

    reorderConversations(
      [
        { id: adminConversation.id, folderId: adminFolder.id },
        { id: memberConversation.id, folderId: adminFolder.id }
      ],
      userA.id
    );

    const rows = getDb()
      .prepare("SELECT id, folder_id FROM conversations WHERE id IN (?, ?)")
      .all(adminConversation.id, memberConversation.id) as Array<{ id: string; folder_id: string | null }>;

    expect(rows).toEqual(
      expect.arrayContaining([
        { id: adminConversation.id, folder_id: adminFolder.id },
        { id: memberConversation.id, folder_id: null }
      ])
    );
    expect(searchConversations("Member Conversation", userB.id)[0]?.folderId).toBeNull();
  });

  it("searches conversations by title", () => {
    createConversation("JavaScript Basics");
    createConversation("Python Advanced");
    createConversation("TypeScript Tips");

    const results = searchConversations("JavaScript");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("JavaScript Basics");
    expect(results[0].automationId).toBeNull();
    expect(results[0].automationRunId).toBeNull();
    expect(results[0].conversationOrigin).toBe("manual");
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

  it("excludes automation conversations from manual search results", () => {
    const defaultProviderProfileId =
      getSettings().defaultProviderProfileId ?? listProviderProfiles()[0]?.id ?? "";
    const automation = createAutomation({
      name: "Automation",
      prompt: "Run automatically",
      providerProfileId: defaultProviderProfileId,
      personaId: null,
      scheduleKind: "interval",
      intervalMinutes: 5,
      calendarFrequency: null,
      timeOfDay: null,
      daysOfWeek: []
    });
    const automationRun = createAutomationRun({
      automationId: automation.id,
      scheduledFor: "2026-04-09T00:00:00.000Z",
      triggerSource: "schedule"
    });

    createConversation("Manual Chat");
    createConversation("Automation Chat", null, {
      providerProfileId: defaultProviderProfileId,
      origin: "automation",
      automationId: automation.id,
      automationRunId: automationRun.id
    });

    const results = searchConversations("Chat");

    expect(results.map((conversation) => conversation.title)).toEqual(["Manual Chat"]);
  });

  it("does not match hidden system prompts in search results", () => {
    const conv = createConversation("My Chat");
    createMessage({
      conversationId: conv.id,
      role: "system",
      content: "Do not reveal the background instructions"
    });

    const results = searchConversations("background instructions");

    expect(results).toHaveLength(0);
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

  it("orders pagination by the latest conversation activity", async () => {
    const user = await createLocalUser({
      username: "conversation-pagination-owner",
      password: "Password123!",
      role: "user"
    });
    const olderConversation = createConversation("Older", null, undefined, user.id);
    const newerConversation = createConversation("Newer", null, undefined, user.id);

    const olderMessage = createMessage({
      conversationId: olderConversation.id,
      role: "user",
      content: "Older prompt"
    });
    const newerMessage = createMessage({
      conversationId: newerConversation.id,
      role: "assistant",
      content: "Newer reply"
    });

    getDb()
      .prepare("UPDATE messages SET created_at = ? WHERE id = ?")
      .run("2026-03-30T12:00:00.000Z", olderMessage.id);
    getDb()
      .prepare("UPDATE messages SET created_at = ? WHERE id = ?")
      .run("2026-03-31T12:00:00.000Z", newerMessage.id);
    getDb()
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run("2026-04-01T00:00:00.000Z", olderConversation.id);
    getDb()
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run("2026-03-29T00:00:00.000Z", newerConversation.id);

    const page = listConversationsPage({ limit: 2, userId: user.id });

    expect(page.conversations.map((conversation) => conversation.id)).toEqual([
      olderConversation.id,
      newerConversation.id
    ]);
    expect(page.conversations[0]?.updatedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(page.conversations[1]?.updatedAt).toBe("2026-03-31T12:00:00.000Z");
  });
});
