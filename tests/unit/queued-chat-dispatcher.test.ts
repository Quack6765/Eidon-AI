import { beforeEach, describe, expect, it, vi } from "vitest";

describe("queued-chat-dispatcher", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("claims only one queued message per conversation at a time", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage, listQueuedMessages } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const conversation = createConversation();
    createQueuedMessage({ conversationId: conversation.id, content: "First queued follow-up" });
    createQueuedMessage({ conversationId: conversation.id, content: "Second queued follow-up" });

    let releaseDispatch!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });
    const startChatTurn = vi.fn(async () => {
      await dispatchStarted;
      return { status: "completed" as const };
    });

    const firstDispatch = ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });
    const secondDispatch = ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });

    await Promise.resolve();

    expect(startChatTurn).toHaveBeenCalledTimes(1);
    expect(listQueuedMessages(conversation.id)).toEqual([
      expect.objectContaining({ content: "First queued follow-up", status: "processing" }),
      expect.objectContaining({ content: "Second queued follow-up", status: "pending" })
    ]);

    releaseDispatch();
    await Promise.all([firstDispatch, secondDispatch]);
  });

  it("consumes only the claimed queue row after a successful dispatch", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage, listQueuedMessages } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const conversation = createConversation();
    const first = createQueuedMessage({ conversationId: conversation.id, content: "First queued follow-up" });
    const second = createQueuedMessage({ conversationId: conversation.id, content: "Second queued follow-up" });

    const startChatTurn = vi.fn(async (_manager, _conversationId, _content, _attachmentIds, _personaId, options) => {
      options?.onMessagesCreated?.({
        userMessageId: "msg_user_1",
        assistantMessageId: "msg_assistant_1"
      });
      return { status: "completed" as const };
    });

    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });

    expect(startChatTurn).toHaveBeenCalledWith(
      manager,
      conversation.id,
      "First queued follow-up",
      [],
      undefined,
      expect.objectContaining({ source: "queue", onMessagesCreated: expect.any(Function) })
    );
    expect(listQueuedMessages(conversation.id)).toEqual([
      expect.objectContaining({
        id: second.id,
        content: "Second queued follow-up",
        status: "pending"
      })
    ]);
    expect(listQueuedMessages(conversation.id).some((item) => item.id === first.id)).toBe(false);
  });
});
