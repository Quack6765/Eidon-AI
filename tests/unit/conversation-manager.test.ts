import { describe, it, expect, vi, beforeEach } from "vitest";
import type WebSocket from "ws";

function createMockWs(): { ws: WebSocket; sent: unknown[] } {
  const sent: unknown[] = [];
  const ws = { readyState: 1, send: vi.fn((data: string) => sent.push(JSON.parse(data))) } as unknown as WebSocket;
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
});
