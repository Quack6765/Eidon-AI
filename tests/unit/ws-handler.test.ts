import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";

import {
  assertWebSocketMessage
} from "@/tests/fixtures/mobile-contract-validator";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
  verifyMobileSessionToken: vi.fn(),
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
  moveQueuedMessageToFront: vi.fn(),
  reorderQueuedMessages: vi.fn()
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

  it("terminates sockets on errors and runs the registered connection cleanup", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1"
    });
    const { listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);

    const mockMgr = {
      addConnection: vi.fn().mockReturnValue(true),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn(),
      setActive: vi.fn(),
      isActive: vi.fn(),
      getActiveConversationIds: vi.fn()
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { setupWebSocketHandler } = await import("@/lib/ws-handler");
    const serverHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const socketHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      ping: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        const handlers = socketHandlers.get(event) ?? [];
        handlers.push(handler);
        socketHandlers.set(event, handlers);
      }),
      terminate: vi.fn(() => {
        socket.readyState = 3;
        for (const handler of socketHandlers.get("close") ?? []) {
          handler();
        }
      })
    };
    const ws = socket as unknown as WebSocket;
    const wss = {
      clients: new Set([ws]),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        serverHandlers.set(event, handler);
      })
    } as unknown as WebSocketServer;

    try {
      setupWebSocketHandler(wss);
      await serverHandlers.get("connection")?.(
        ws,
        { headers: { cookie: "eidon_session=valid-token" } } as IncomingMessage
      );

      expect(mockMgr.addConnection).toHaveBeenCalledWith(ws, "user-1");
      expect(socketHandlers.get("error")).toHaveLength(1);

      socketHandlers.get("error")?.[0]?.(new Error("socket failed"));

      expect(socket.terminate).toHaveBeenCalledTimes(1);
      expect(mockMgr.removeConnection).toHaveBeenCalledWith(ws);
      expect(mockMgr.disconnect).toHaveBeenCalledWith(ws);
    } finally {
      serverHandlers.get("close")?.();
      vi.doUnmock("@/lib/ws-singleton");
    }
  });

  it("does not ping sockets that are already closing", async () => {
    vi.useFakeTimers();
    const { setupWebSocketHandler } = await import("@/lib/ws-handler");
    const serverHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const socket = {
      readyState: 2,
      ping: vi.fn(),
      terminate: vi.fn()
    } as unknown as WebSocket;
    const wss = {
      clients: new Set([socket]),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        serverHandlers.set(event, handler);
      })
    } as unknown as WebSocketServer;

    try {
      setupWebSocketHandler(wss);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(socket.ping).not.toHaveBeenCalled();
      expect(socket.terminate).not.toHaveBeenCalled();
    } finally {
      serverHandlers.get("close")?.();
      vi.useRealTimers();
    }
  });

  it("contains synchronous message dispatch failures", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: "session-1",
      userId: "user-1"
    });
    const { getConversationSnapshot, listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const mockMgr = {
      addConnection: vi.fn().mockReturnValue(true),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn(),
      setActive: vi.fn(),
      isActive: vi.fn(),
      getActiveConversationIds: vi.fn()
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      terminate: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((data: string) => handler(data));
      })
    } as unknown as WebSocket;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await handleConnection(ws, "valid-token");

      expect(() => {
        messageHandlers[0]?.(JSON.stringify({
          type: "queue_message",
          conversationId: "conv-1",
          content: "queued"
        }));
      }).not.toThrow();

      expect(sent.map((raw) => JSON.parse(raw))).toContainEqual({
        type: "error",
        message: "Unable to process WebSocket message"
      });
      expect(ws.close).toHaveBeenCalledWith(1011, "WebSocket message failed");
    } finally {
      consoleError.mockRestore();
      vi.doUnmock("@/lib/ws-singleton");
    }
  });

  it("does not register a socket that closes while authentication is pending", async () => {
    let resolveSession!: (value: { sessionId: string; userId: string }) => void;
    const pendingSession = new Promise<{ sessionId: string; userId: string }>((resolve) => {
      resolveSession = resolve;
    });
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockReturnValue(pendingSession);

    const mockMgr = {
      addConnection: vi.fn().mockReturnValue(true),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn(),
      setActive: vi.fn(),
      isActive: vi.fn(),
      getActiveConversationIds: vi.fn()
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { handleConnection } = await import("@/lib/ws-handler");
    const closeHandlers: Array<() => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === "close") closeHandlers.push(handler);
      })
    } as unknown as WebSocket;

    const connection = handleConnection(ws, "valid-token");
    await Promise.resolve();
    closeHandlers.forEach((handler) => handler());
    resolveSession({ sessionId: "session-1", userId: "user-1" });
    await connection;

    expect(mockMgr.addConnection).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/ws-singleton");
  });

  it("scopes login-disabled sockets to the bootstrap user", async () => {
    const previous = process.env.EIDON_PASSWORD_LOGIN_ENABLED;
    process.env.EIDON_PASSWORD_LOGIN_ENABLED = "false";
    vi.resetModules();

    try {
      const { getCurrentUser } = await import("@/lib/auth");
      (getCurrentUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "bootstrap-user" });
      const { listActiveConversations } = await import("@/lib/conversations");
      (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const mockMgr = {
        addConnection: vi.fn().mockReturnValue(true),
        removeConnection: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        disconnect: vi.fn(),
        broadcast: vi.fn(),
        broadcastAll: vi.fn(),
        hasSubscribers: vi.fn(),
        setActive: vi.fn(),
        isActive: vi.fn(),
        getActiveConversationIds: vi.fn()
      };
      vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

      const { handleConnection } = await import("@/lib/ws-handler");
      const ws = {
        readyState: 1,
        bufferedAmount: 0,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn()
      } as unknown as WebSocket;

      await handleConnection(ws, null);

      expect(mockMgr.addConnection).toHaveBeenCalledWith(ws, "bootstrap-user");
      expect(listActiveConversations).toHaveBeenCalledWith("bootstrap-user");
    } finally {
      if (previous === undefined) {
        delete process.env.EIDON_PASSWORD_LOGIN_ENABLED;
      } else {
        process.env.EIDON_PASSWORD_LOGIN_ENABLED = previous;
      }
      vi.doUnmock("@/lib/ws-singleton");
      vi.resetModules();
    }
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
      addConnection: vi.fn().mockReturnValue(true),
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
      addConnection: vi.fn().mockReturnValue(true),
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

  it("authenticates mobile bearers and sends sanitized versioned snapshots without subscribing", async () => {
    const { verifyMobileSessionToken } = await import("@/lib/auth");
    vi.mocked(verifyMobileSessionToken).mockResolvedValue({
      sessionId: "mobile-session-1",
      userId: "mobile-user-1"
    });
    const { getConversationSnapshot, listActiveConversations } = await import("@/lib/conversations");
    vi.mocked(listActiveConversations).mockReturnValue([]);
    vi.mocked(getConversationSnapshot).mockReturnValue({
      conversation: { id: "conv-mobile" },
      messages: [{
        id: "message-1",
        conversationId: "conv-mobile",
        role: "user",
        content: "hello",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 1,
        systemKind: null,
        compactedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        actions: [{
          id: "action-1",
          messageId: "message-1",
          kind: "mcp_tool_call",
          status: "completed",
          serverId: null,
          skillId: null,
          toolName: "lookup",
          label: "Lookup",
          detail: "Looked up the contract",
          arguments: { query: "contract" },
          resultSummary: "Found",
          sortOrder: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          proposalState: null,
          proposalPayload: null,
          proposalUpdatedAt: null
        }],
        textSegments: [{
          id: "segment-1",
          messageId: "message-1",
          content: "hello",
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00.000Z"
        }],
        timeline: [{
          id: "segment-1",
          timelineKind: "text",
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          content: "hello"
        }, {
          id: "thinking-1",
          messageId: "message-1",
          timelineKind: "thinking",
          status: "completed",
          sortOrder: 1,
          startOffset: 0,
          endOffset: 4,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z"
        }, {
          id: "action-1",
          messageId: "message-1",
          timelineKind: "action",
          kind: "mcp_tool_call",
          status: "completed",
          serverId: null,
          skillId: null,
          toolName: "lookup",
          label: "Lookup",
          detail: "Looked up the contract",
          arguments: { query: "contract" },
          resultSummary: "Found",
          sortOrder: 2,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:01.000Z",
          proposalState: null,
          proposalPayload: null,
          proposalUpdatedAt: null
        }],
        attachments: [{
          id: "attachment-1",
          conversationId: "conv-mobile",
          messageId: "message-1",
          filename: "safe.txt",
          mimeType: "text/plain",
          byteSize: 8,
          sha256: "hash",
          relativePath: "private/attachment.txt",
          kind: "text",
          extractedText: "private body",
          createdAt: "2026-01-01T00:00:00.000Z"
        }]
      }],
      queuedMessages: []
    } as never);

    const mockMgr = {
      addConnection: vi.fn().mockReturnValue(true),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn(),
      setActive: vi.fn(),
      isActive: vi.fn(),
      getActiveConversationIds: vi.fn()
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: Array<Record<string, unknown>> = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn((data: string) => sent.push(JSON.parse(data))),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((data: string) => handler(data));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "mobile-bearer", { authMode: "mobile" });
    messageHandlers[0]?.(JSON.stringify({
      type: "request_snapshot",
      conversationId: "conv-mobile"
    }));

    expect(verifyMobileSessionToken).toHaveBeenCalledWith("mobile-bearer");
    expect(mockMgr.addConnection).toHaveBeenCalledWith(ws, "mobile-user-1", "mobile");
    expect(mockMgr.subscribe).not.toHaveBeenCalled();
    expect(sent[0]).toEqual({
      type: "ready",
      protocolVersion: "v1",
      activeConversations: []
    });
    expect(sent[1]).toMatchObject({ type: "snapshot", conversationId: "conv-mobile" });
    expect(JSON.stringify(sent[1])).not.toContain("relativePath");
    expect(JSON.stringify(sent[1])).not.toContain("extractedText");
    sent.forEach((message) => assertWebSocketMessage("ServerMessage", message));
    assertWebSocketMessage("ClientMessage", {
      type: "request_snapshot",
      conversationId: "conv-mobile"
    });
    vi.doUnmock("@/lib/ws-singleton");
  });

  it("closes rejected mobile authentication with a stable non-retryable error", async () => {
    const { verifyMobileSessionToken } = await import("@/lib/auth");
    vi.mocked(verifyMobileSessionToken).mockResolvedValue(null);
    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      on: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, "wrong-purpose", { authMode: "mobile" });

    expect(sent.map((value) => JSON.parse(value))).toContainEqual({
      type: "error",
      code: "authentication_required",
      message: "Invalid or expired mobile session"
    });
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid mobile session");
  });

  it("reorders a mobile queue only after checking conversation ownership", async () => {
    const { verifyMobileSessionToken } = await import("@/lib/auth");
    vi.mocked(verifyMobileSessionToken).mockResolvedValue({
      sessionId: "mobile-session-1",
      userId: "mobile-user-1"
    });
    const {
      getConversationSnapshot,
      listActiveConversations,
      listQueuedMessages,
      reorderQueuedMessages
    } = await import("@/lib/conversations");
    vi.mocked(listActiveConversations).mockReturnValue([]);
    vi.mocked(getConversationSnapshot).mockReturnValue({
      conversation: { id: "conv-mobile" },
      messages: [],
      queuedMessages: []
    } as never);
    vi.mocked(reorderQueuedMessages).mockReturnValue(true);
    vi.mocked(listQueuedMessages).mockReturnValue([]);

    const mockMgr = {
      addConnection: vi.fn().mockReturnValue(true),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn(),
      setActive: vi.fn(),
      isActive: vi.fn(),
      getActiveConversationIds: vi.fn()
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { handleConnection } = await import("@/lib/ws-handler");
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") messageHandlers.push((data: string) => handler(data));
      })
    } as unknown as WebSocket;

    await handleConnection(ws, "mobile-bearer", { authMode: "mobile" });
    messageHandlers[0]?.(JSON.stringify({
      type: "reorder_queued_messages",
      conversationId: "conv-mobile",
      queuedMessageIds: ["queue-2", "queue-1"]
    }));

    expect(getConversationSnapshot).toHaveBeenCalledWith("conv-mobile", "mobile-user-1");
    expect(reorderQueuedMessages).toHaveBeenCalledWith({
      conversationId: "conv-mobile",
      queuedMessageIds: ["queue-2", "queue-1"]
    });
    expect(mockMgr.broadcast).toHaveBeenCalledWith("conv-mobile", {
      type: "queue_updated",
      conversationId: "conv-mobile",
      queuedMessages: []
    });
    vi.doUnmock("@/lib/ws-singleton");
  });

  it("accepts only an Authorization bearer on the versioned upgrade path", async () => {
    const { verifyMobileSessionToken } = await import("@/lib/auth");
    vi.mocked(verifyMobileSessionToken).mockResolvedValue({
      sessionId: "mobile-session-1",
      userId: "mobile-user-1"
    });
    const { listActiveConversations } = await import("@/lib/conversations");
    vi.mocked(listActiveConversations).mockReturnValue([]);
    const mockMgr = {
      addConnection: vi.fn().mockReturnValue(true),
      removeConnection: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
      broadcast: vi.fn(),
      broadcastAll: vi.fn(),
      hasSubscribers: vi.fn(),
      setActive: vi.fn(),
      isActive: vi.fn(),
      getActiveConversationIds: vi.fn()
    };
    vi.doMock("@/lib/ws-singleton", () => ({ getConversationManager: () => mockMgr }));

    const { setupWebSocketHandler } = await import("@/lib/ws-handler");
    const serverHandlers = new Map<string, (...args: unknown[]) => unknown>();
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      ping: vi.fn(),
      on: vi.fn()
    } as unknown as WebSocket;
    const wss = {
      clients: new Set([ws]),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        serverHandlers.set(event, handler);
      })
    } as unknown as WebSocketServer;

    setupWebSocketHandler(wss, { authMode: "mobile" });
    await serverHandlers.get("connection")?.(ws, {
      headers: {
        authorization: "Bearer mobile-upgrade-token",
        cookie: "eidon_session=browser-cookie-must-not-be-used"
      }
    } as IncomingMessage);

    expect(verifyMobileSessionToken).toHaveBeenCalledWith("mobile-upgrade-token");
    expect(mockMgr.addConnection).toHaveBeenCalledWith(ws, "mobile-user-1", "mobile");
    serverHandlers.get("close")?.();
    vi.doUnmock("@/lib/ws-singleton");
  });
});
