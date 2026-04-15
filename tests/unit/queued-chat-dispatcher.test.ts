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
    const { createConversation, createQueuedMessage, listQueuedMessages, setConversationActive } =
      await import("@/lib/conversations");
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
      manager.setActive(conversation.id, true);
      setConversationActive(conversation.id, true);
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
    expect(startChatTurn).toHaveBeenCalledTimes(1);
    expect(listQueuedMessages(conversation.id)).toEqual([
      expect.objectContaining({
        id: second.id,
        content: "Second queued follow-up",
        status: "pending"
      })
    ]);
    expect(listQueuedMessages(conversation.id).some((item) => item.id === first.id)).toBe(false);
  });

  it("broadcasts queue updates when queued items are consumed by automatic dispatch", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage, listQueuedMessages } =
      await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const broadcastSpy = vi.spyOn(manager, "broadcast");
    const conversation = createConversation();
    createQueuedMessage({ conversationId: conversation.id, content: "First queued follow-up" });
    createQueuedMessage({ conversationId: conversation.id, content: "Second queued follow-up" });

    const startChatTurn = vi.fn(
      async (_manager, _conversationId, content, _attachmentIds, _personaId, options) => {
        options?.onMessagesCreated?.({
          userMessageId: `user-${content}`,
          assistantMessageId: `assistant-${content}`
        });
        return { status: "completed" as const };
      }
    );

    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });

    const queueUpdatedEvents = broadcastSpy.mock.calls
      .filter(([, event]) => event.type === "queue_updated")
      .map(([, event]) => event);

    expect(queueUpdatedEvents).toEqual([
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "First queued follow-up",
            status: "processing"
          }),
          expect.objectContaining({
            content: "Second queued follow-up",
            status: "pending"
          })
        ]
      },
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "Second queued follow-up",
            status: "pending"
          })
        ]
      },
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "Second queued follow-up",
            status: "processing"
          })
        ]
      },
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: []
      }
    ]);
    expect(listQueuedMessages(conversation.id)).toEqual([]);
  });

  it("broadcasts queue updates when automatic dispatch fails before creating messages", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const broadcastSpy = vi.spyOn(manager, "broadcast");
    const conversation = createConversation();
    createQueuedMessage({ conversationId: conversation.id, content: "Queued follow-up" });

    const startChatTurn = vi.fn(async () => ({
      status: "failed" as const,
      errorMessage: "Provider rejected the queued follow-up"
    }));

    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });

    const queueUpdatedEvents = broadcastSpy.mock.calls
      .filter(([, event]) => event.type === "queue_updated")
      .map(([, event]) => event);

    expect(queueUpdatedEvents).toEqual([
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "Queued follow-up",
            status: "processing",
            failureMessage: null
          })
        ]
      },
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "Queued follow-up",
            status: "failed",
            failureMessage: "Provider rejected the queued follow-up"
          })
        ]
      }
    ]);
  });

  it("broadcasts queue updates when orphaned processing rows are recovered", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const broadcastSpy = vi.spyOn(manager, "broadcast");
    const conversation = createConversation();

    createQueuedMessage({ conversationId: conversation.id, content: "Recovered follow-up" });

    const stalledStartChatTurn = vi.fn(async () => ({ status: "completed" as const }));
    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn: stalledStartChatTurn
    });

    const recoveryStartChatTurn = vi.fn(async () => ({ status: "completed" as const }));
    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn: recoveryStartChatTurn
    });

    const queueUpdatedEvents = broadcastSpy.mock.calls
      .filter(([, event]) => event.type === "queue_updated")
      .map(([, event]) => event);

    expect(queueUpdatedEvents).toEqual([
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "Recovered follow-up",
            status: "processing",
            failureMessage: null
          })
        ]
      },
      {
        type: "queue_updated",
        conversationId: conversation.id,
        queuedMessages: [
          expect.objectContaining({
            content: "Recovered follow-up",
            status: "failed",
            failureMessage: "Queued follow-up was abandoned before dispatch completed"
          })
        ]
      }
    ]);
    expect(recoveryStartChatTurn).not.toHaveBeenCalled();
  });

  it("drains multiple queued items from a single dispatcher kick", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage, listQueuedMessages } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const conversation = createConversation();
    createQueuedMessage({ conversationId: conversation.id, content: "First queued follow-up" });
    createQueuedMessage({ conversationId: conversation.id, content: "Second queued follow-up" });
    createQueuedMessage({ conversationId: conversation.id, content: "Third queued follow-up" });

    const startChatTurn = vi.fn(async (_manager, _conversationId, content, _attachmentIds, _personaId, options) => {
      options?.onMessagesCreated?.({
        userMessageId: `user-${content}`,
        assistantMessageId: `assistant-${content}`
      });
      return { status: "completed" as const };
    });

    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });

    expect(startChatTurn).toHaveBeenCalledTimes(3);
    expect(startChatTurn.mock.calls.map((call) => call[2])).toEqual([
      "First queued follow-up",
      "Second queued follow-up",
      "Third queued follow-up"
    ]);
    expect(listQueuedMessages(conversation.id)).toEqual([]);
  });

  it("dispatches queued image-mode messages with their original mode", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createConversation, createQueuedMessage } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const manager = createConversationManager();
    const conversation = createConversation();
    createQueuedMessage({
      conversationId: conversation.id,
      content: "make it noir",
      mode: "image"
    });

    const startChatTurn = vi.fn(async () => ({ status: "completed" as const }));

    await ensureQueuedDispatch({
      manager,
      conversationId: conversation.id,
      startChatTurn
    });

    expect(startChatTurn).toHaveBeenCalledWith(
      manager,
      conversation.id,
      "make it noir",
      [],
      undefined,
      expect.objectContaining({ mode: "image" })
    );
  });
});
