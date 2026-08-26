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

  it("delivers to nobody when broadcastAll has a null userId", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: socketA, sent: sentA } = createMockWs();
    const { ws: socketB, sent: sentB } = createMockWs();

    expect(manager.addConnection(socketA, "user-a")).toBe(true);
    expect(manager.addConnection(socketB, "user-b")).toBe(true);
    manager.broadcastAll(
      { type: "conversation_activity", conversationId: "conv-1", isActive: true },
      null
    );

    expect(sentA).toHaveLength(0);
    expect(sentB).toHaveLength(0);
  });

  it("delivers broadcastAll only to sockets of the target user across multiple connections", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ownerSocketA, sent: ownerSentA } = createMockWs();
    const { ws: ownerSocketB, sent: ownerSentB } = createMockWs();
    const { ws: otherSocketA, sent: otherSentA } = createMockWs();
    const { ws: otherSocketB, sent: otherSentB } = createMockWs();

    manager.addConnection(ownerSocketA, "user-owner");
    manager.addConnection(ownerSocketB, "user-owner", "mobile");
    manager.addConnection(otherSocketA, "user-other");
    manager.addConnection(otherSocketB, "user-other", "mobile");
    manager.broadcastAll(
      { type: "conversation_activity", conversationId: "conv-1", isActive: true },
      "user-owner"
    );

    expect(ownerSentA).toHaveLength(1);
    expect(ownerSentB).toHaveLength(1);
    expect(otherSentA).toHaveLength(0);
    expect(otherSentB).toHaveLength(0);
  });

  it("sanitizes room and global broadcasts only for mobile connections", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: browserSocket, sent: browserSent } = createMockWs();
    const { ws: mobileSocket, sent: mobileSent } = createMockWs();

    manager.addConnection(browserSocket, "shared-user", "browser");
    manager.addConnection(mobileSocket, "shared-user", "mobile");
    manager.subscribe("conv-1", browserSocket);
    manager.subscribe("conv-1", mobileSocket);
    const message = {
      type: "user_message_persisted" as const,
      conversationId: "conv-1",
      message: {
        id: "message-1",
        conversationId: "conv-1",
        role: "user" as const,
        content: "hello",
        thinkingContent: "",
        status: "completed" as const,
        estimatedTokens: 1,
        systemKind: null,
        compactedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        attachments: [{
          id: "attachment-1",
          conversationId: "conv-1",
          messageId: "message-1",
          filename: "safe.txt",
          mimeType: "text/plain",
          byteSize: 4,
          sha256: "hash",
          relativePath: "private/file.txt",
          kind: "text" as const,
          extractedText: "private text",
          createdAt: "2026-01-01T00:00:00.000Z"
        }]
      }
    };

    manager.broadcast("conv-1", message);
    manager.broadcastAll(message, "shared-user");

    expect(JSON.stringify(browserSent)).toContain("relativePath");
    expect(JSON.stringify(browserSent)).toContain("extractedText");
    expect(JSON.stringify(mobileSent)).not.toContain("relativePath");
    expect(JSON.stringify(mobileSent)).not.toContain("extractedText");
  });

  it("adds a stable code to legacy errors sent to mobile connections", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: browserSocket, sent: browserSent } = createMockWs();
    const { ws: mobileSocket, sent: mobileSent } = createMockWs();

    manager.addConnection(browserSocket, "shared-user", "browser");
    manager.addConnection(mobileSocket, "shared-user", "mobile");
    manager.subscribe("conv-1", browserSocket);
    manager.subscribe("conv-1", mobileSocket);
    manager.broadcast("conv-1", { type: "error", message: "Unable to complete the turn" });

    expect(browserSent[0]).toEqual({ type: "error", message: "Unable to complete the turn" });
    expect(mobileSent[0]).toEqual({
      type: "error",
      code: "request_failed",
      message: "Unable to complete the turn"
    });
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

  it("delivers a single payload larger than the backlog limit when the client keeps up", async () => {
    const { sendWebSocketData, MAX_WS_BUFFERED_BYTES } = await import("@/lib/ws-send");
    const ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn()
    } as unknown as WebSocket;

    expect(sendWebSocketData(ws, "x".repeat(MAX_WS_BUFFERED_BYTES + 1))).toBe(true);
    expect(ws.send).toHaveBeenCalled();
    expect(ws.close).not.toHaveBeenCalled();
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
