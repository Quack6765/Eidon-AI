import { describe, it, expect, vi, beforeEach } from "vitest";
import type WebSocket from "ws";

vi.mock("@/lib/auth", () => ({
  verifySessionToken: vi.fn()
}));

vi.mock("@/lib/conversations", () => ({
  getConversationSnapshot: vi.fn(),
  getMessage: vi.fn(),
  listActiveConversations: vi.fn(),
  createQueuedMessage: vi.fn(),
  listQueuedMessages: vi.fn(),
  updateQueuedMessage: vi.fn(),
  deleteQueuedMessage: vi.fn(),
  moveQueuedMessageToFront: vi.fn()
}));

vi.mock("@/lib/chat-turn", () => ({
  startChatTurn: vi.fn()
}));

describe("ws-handler", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("sends an error and closes the connection when auth fails", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, "session=invalid");

    expect(ws.close).toHaveBeenCalled();
    const error = sent.find(s => JSON.parse(s).type === "error");
    expect(error).toBeDefined();
    expect(JSON.parse(error!).type).toBe("error");
  });

  it("sends ready and handles subscribe", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const { getConversationSnapshot, listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    const queuedMessages = [
      {
        id: "queue-1",
        conversationId: "conv-1",
        content: "Queued follow-up",
        status: "pending",
        sortOrder: 0,
        failureMessage: null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        processingStartedAt: null
      }
    ];
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: [],
      queuedMessages
    });

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    const ready = sent.find(s => JSON.parse(s).type === "ready");
    expect(ready).toBeDefined();
    expect(JSON.parse(ready!).type).toBe("ready");
    expect(listActiveConversations).toHaveBeenCalledWith("user-1");

    const subscribeMsg = JSON.stringify({ type: "subscribe", conversationId: "conv-1" });
    for (const handler of messageHandlers) handler(subscribeMsg);

    const snapshot = sent.find(s => JSON.parse(s).type === "snapshot");
    expect(snapshot).toBeDefined();
    expect(JSON.parse(snapshot!).conversationId).toBe("conv-1");
    expect(JSON.parse(snapshot!).queuedMessages).toEqual(queuedMessages);
    expect(getConversationSnapshot).toHaveBeenCalledWith("conv-1", "user-1");
  });

  it("routes client stop messages to the turn registry", async () => {
    const requestStop = vi.fn();
    vi.doMock("@/lib/chat-turn-control", () => ({ requestStop }));
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const { handleConnection } = await import("@/lib/ws-handler");
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");
    messageHandlers.forEach((handler) => handler(JSON.stringify({ type: "stop", conversationId: "conv-1" })));

    expect(requestStop).toHaveBeenCalledWith("conv-1");
  });

  it("creates queued messages and broadcasts queue updates", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const {
      createQueuedMessage,
      getConversationSnapshot,
      listActiveConversations,
      listQueuedMessages
    } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: [],
      queuedMessages: []
    });
    const queuedMessages = [
      {
        id: "queue-1",
        conversationId: "conv-1",
        content: "Queued follow-up",
        status: "pending",
        sortOrder: 0,
        failureMessage: null,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        processingStartedAt: null
      }
    ];
    (listQueuedMessages as ReturnType<typeof vi.fn>).mockReturnValue(queuedMessages);

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    messageHandlers.forEach((handler) => handler(JSON.stringify({ type: "subscribe", conversationId: "conv-1" })));
    messageHandlers.forEach((handler) =>
      handler(JSON.stringify({ type: "queue_message", conversationId: "conv-1", content: "Queued follow-up" }))
    );

    expect(createQueuedMessage).toHaveBeenCalledWith({
      conversationId: "conv-1",
      content: "Queued follow-up"
    });

    const queueUpdated = sent
      .map((raw) => JSON.parse(raw))
      .find((message) => message.type === "queue_updated");

    expect(queueUpdated).toEqual({
      type: "queue_updated",
      conversationId: "conv-1",
      queuedMessages
    });
    expect(listQueuedMessages).toHaveBeenCalledWith("conv-1");
  });

  it("sends an error when deleting a queued message fails", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const {
      deleteQueuedMessage,
      getConversationSnapshot,
      listActiveConversations,
      listQueuedMessages
    } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: [],
      queuedMessages: []
    });
    (deleteQueuedMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    messageHandlers.forEach((handler) => handler(JSON.stringify({ type: "subscribe", conversationId: "conv-1" })));
    (listQueuedMessages as ReturnType<typeof vi.fn>).mockClear();
    messageHandlers.forEach((handler) =>
      handler(JSON.stringify({ type: "delete_queued_message", conversationId: "conv-1", queuedMessageId: "queue-404" }))
    );

    expect(deleteQueuedMessage).toHaveBeenCalledWith({
      conversationId: "conv-1",
      queuedMessageId: "queue-404"
    });
    expect(listQueuedMessages).not.toHaveBeenCalled();

    const parsed = sent.map((raw) => JSON.parse(raw));
    expect(parsed.some((message) => message.type === "queue_updated")).toBe(false);
    expect(parsed.find((message) => message.type === "error")).toEqual({
      type: "error",
      message: "Queued message not found"
    });
  });

  it("sends an error when reprioritizing a queued message fails", async () => {
    const requestStop = vi.fn();
    vi.doMock("@/lib/chat-turn-control", () => ({ requestStop }));

    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const {
      getConversationSnapshot,
      listActiveConversations,
      listQueuedMessages,
      moveQueuedMessageToFront
    } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: [],
      queuedMessages: []
    });
    (moveQueuedMessageToFront as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    messageHandlers.forEach((handler) => handler(JSON.stringify({ type: "subscribe", conversationId: "conv-1" })));
    (listQueuedMessages as ReturnType<typeof vi.fn>).mockClear();
    requestStop.mockClear();
    messageHandlers.forEach((handler) =>
      handler(JSON.stringify({ type: "send_queued_message_now", conversationId: "conv-1", queuedMessageId: "queue-404" }))
    );

    expect(moveQueuedMessageToFront).toHaveBeenCalledWith({
      conversationId: "conv-1",
      queuedMessageId: "queue-404"
    });
    expect(requestStop).not.toHaveBeenCalled();
    expect(listQueuedMessages).not.toHaveBeenCalled();

    const parsed = sent.map((raw) => JSON.parse(raw));
    expect(parsed.some((message) => message.type === "queue_updated")).toBe(false);
    expect(parsed.find((message) => message.type === "error")).toEqual({
      type: "error",
      message: "Queued message not found"
    });
  });

  it("sends error and closes when no token provided", async () => {
    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, null);

    expect(ws.close).toHaveBeenCalled();
    const error = sent.find(s => JSON.parse(s).type === "error");
    expect(error).toBeDefined();
  });

  it("broadcasts user_message_persisted when startChatTurn fires onMessagesCreated and snapshot contains the message", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const { getConversationSnapshot, getMessage, listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const userMessage = { id: "msg-user-1", role: "user", content: "hello" };

    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: [],
      queuedMessages: []
    });
    (getMessage as ReturnType<typeof vi.fn>).mockReturnValue(userMessage);

    const { startChatTurn } = await import("@/lib/chat-turn");
    (startChatTurn as ReturnType<typeof vi.fn>).mockImplementation(
      async (_mgr: unknown, _conversationId: unknown, _content: unknown, _attachmentIds: unknown, _personaId: unknown, options?: { onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void }) => {
        options?.onMessagesCreated?.({ userMessageId: "msg-user-1", assistantMessageId: "msg-asst-1" });
        return { status: "completed" };
      }
    );

    const broadcast: unknown[] = [];
    const mockMgr = {
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn((_conversationId: string, msg: unknown) => { broadcast.push(msg); }),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn().mockReturnValue(false),
      setActive: vi.fn(),
      isActive: vi.fn().mockReturnValue(false),
      getActiveConversationIds: vi.fn().mockReturnValue([])
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { handleConnection } = await import("@/lib/ws-handler");
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    messageHandlers.forEach((handler) =>
      handler(JSON.stringify({ type: "message", conversationId: "conv-1", content: "hello" }))
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getMessage).toHaveBeenCalledWith("msg-user-1", "user-1");
    const persisted = broadcast.filter((m) => (m as { type: string }).type === "user_message_persisted");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual({
      type: "user_message_persisted",
      conversationId: "conv-1",
      message: userMessage
    });
  });

  it("does not broadcast user_message_persisted when the persisted message lookup returns null", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const { getConversationSnapshot, getMessage, listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);

    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: [],
      queuedMessages: []
    });
    (getMessage as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { startChatTurn } = await import("@/lib/chat-turn");
    (startChatTurn as ReturnType<typeof vi.fn>).mockImplementation(
      async (_mgr: unknown, _conversationId: unknown, _content: unknown, _attachmentIds: unknown, _personaId: unknown, options?: { onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void }) => {
        options?.onMessagesCreated?.({ userMessageId: "msg-user-missing", assistantMessageId: "msg-asst-1" });
        return { status: "completed" };
      }
    );

    const broadcast: unknown[] = [];
    const mockMgr = {
      addConnection: vi.fn(),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn((_conversationId: string, msg: unknown) => { broadcast.push(msg); }),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn().mockReturnValue(false),
      setActive: vi.fn(),
      isActive: vi.fn().mockReturnValue(false),
      getActiveConversationIds: vi.fn().mockReturnValue([])
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { handleConnection } = await import("@/lib/ws-handler");
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((d: string) => handler(d));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    messageHandlers.forEach((handler) =>
      handler(JSON.stringify({ type: "message", conversationId: "conv-1", content: "hello" }))
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getMessage).toHaveBeenCalledWith("msg-user-missing", "user-1");
    const persisted = broadcast.filter((m) => (m as { type: string }).type === "user_message_persisted");
    expect(persisted).toHaveLength(0);
  });
});
