import { describe, it, expect, vi, beforeEach } from "vitest";
import type WebSocket from "ws";

vi.mock("@/lib/auth", () => ({
  verifySessionToken: vi.fn()
}));

vi.mock("@/lib/conversations", () => ({
  getConversationSnapshot: vi.fn(),
  listActiveConversations: vi.fn(),
  createQueuedMessage: vi.fn(),
  listQueuedMessages: vi.fn(),
  updateQueuedMessage: vi.fn(),
  deleteQueuedMessage: vi.fn(),
  moveQueuedMessageToFront: vi.fn()
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
});
