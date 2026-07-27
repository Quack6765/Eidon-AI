import type WebSocket from "ws";
import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockWs(): { ws: WebSocket; sent: unknown[] } {
  const sent: unknown[] = [];
  const ws = {
    readyState: 1,
    send: vi.fn((data: string) => sent.push(JSON.parse(data)))
  } as unknown as WebSocket;
  return { ws, sent };
}

describe("conversation-manager", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("tracks subscriptions and broadcasts to room members", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ws1, sent: sent1 } = createMockWs();
    const { ws: ws2, sent: sent2 } = createMockWs();

    manager.subscribe("conv-1", ws1);
    manager.subscribe("conv-1", ws2);
    manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hi" } });

    expect(sent1).toHaveLength(1);
    expect(sent2).toHaveLength(1);
    expect((sent1[0] as { type: string }).type).toBe("delta");
  });

  it("does not broadcast to unsubscribed clients", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ws1, sent: sent1 } = createMockWs();
    const { ws: ws2 } = createMockWs();

    manager.subscribe("conv-1", ws1);
    manager.subscribe("conv-2", ws2);
    manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hi" } });

    expect(sent1).toHaveLength(1);
  });

  it("broadcast is a no-op when room has no subscribers", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    expect(() => manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hi" } })).not.toThrow();
  });

  it("removes client from all rooms on disconnect", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ws1, sent: sent1 } = createMockWs();
    const { ws: ws2, sent: sent2 } = createMockWs();

    manager.subscribe("conv-1", ws1);
    manager.subscribe("conv-2", ws1);
    manager.subscribe("conv-1", ws2);

    manager.disconnect(ws1);
    manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "after" } });
    manager.broadcast("conv-2", { type: "delta", conversationId: "conv-2", event: { type: "answer_delta", text: "after" } });

    expect(sent1).toHaveLength(0);
    expect(sent2).toHaveLength(1);
  });

  it("tracks and reports active turns", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();

    expect(manager.isActive("conv-1")).toBe(false);
    manager.setActive("conv-1", true);
    expect(manager.isActive("conv-1")).toBe(true);
    manager.setActive("conv-1", false);
    expect(manager.isActive("conv-1")).toBe(false);
  });

  it("does not deliver user-targeted broadcasts to another user", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ownerSocket, sent: ownerSent } = createMockWs();
    const { ws: otherSocket, sent: otherSent } = createMockWs();

    expect(manager.addConnection(ownerSocket, "user-owner")).toBe(true);
    expect(manager.addConnection(otherSocket, "user-other")).toBe(true);
    manager.broadcastAll(
      { type: "conversation_activity", conversationId: "conv-1", isActive: true },
      "user-owner"
    );

    expect(ownerSent).toHaveLength(1);
    expect(otherSent).toHaveLength(0);
  });

  it("closes slow consumers instead of growing their send buffer", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { MAX_WS_BUFFERED_BYTES } = await import("@/lib/ws-send");
    const manager = createConversationManager();
    const ws = {
      readyState: 1,
      bufferedAmount: MAX_WS_BUFFERED_BYTES + 1,
      send: vi.fn(),
      close: vi.fn()
    } as unknown as WebSocket;

    manager.subscribe("conv-1", ws);
    manager.broadcast("conv-1", {
      type: "delta",
      conversationId: "conv-1",
      event: { type: "answer_delta", text: "data" }
    });

    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(1013, "WebSocket client is too slow");
  });

  it("includes the pending payload bytes in the backpressure limit", async () => {
    const { sendWebSocketData, MAX_WS_BUFFERED_BYTES } = await import("@/lib/ws-send");
    const ws = {
      readyState: 1,
      bufferedAmount: MAX_WS_BUFFERED_BYTES - 3,
      send: vi.fn(),
      close: vi.fn()
    } as unknown as WebSocket;

    expect(sendWebSocketData(ws, "four")).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(1013, "WebSocket client is too slow");
  });

  it("enforces a process-wide manager connection cap", async () => {
    const { createConversationManager, MAX_WS_CONNECTIONS } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();

    for (let index = 0; index < MAX_WS_CONNECTIONS; index += 1) {
      const ws = { readyState: 1 } as unknown as WebSocket;
      expect(manager.addConnection(ws, `user-${index}`)).toBe(true);
    }

    expect(manager.addConnection({ readyState: 1 } as unknown as WebSocket, "overflow-user")).toBe(false);
  });
});
