import { describe, it, expect, vi, beforeEach } from "vitest";
import type WebSocket from "ws";

type ConversationManager = ReturnType<typeof import("@/lib/conversation-manager")["createConversationManager"]>;

function createMockSocket(send = vi.fn()) {
  return {
    readyState: 1,
    send,
    close: vi.fn()
  } as unknown as WebSocket;
}

function sentEvents(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("conversation event bus", () => {
  let manager: ConversationManager;

  beforeEach(async () => {
    vi.resetModules();
    manager = (await import("@/lib/conversation-manager")).createConversationManager();
  });

  it("delivers one delta publish to the ws room, the sse emitter, and keyed subscribers", async () => {
    const { publishConversationEvent, subscribeConversationEvents, getChatEmitter } =
      await import("@/lib/conversation-event-bus");

    const send = vi.fn();
    manager.subscribe("conv-bus-1", createMockSocket(send));

    const emitterEvents: Array<{ conversationId: string; event: unknown }> = [];
    getChatEmitter().on("delta", (conversationId, event) => emitterEvents.push({ conversationId, event }));

    const subscriberEvents: unknown[] = [];
    subscribeConversationEvents("conv-bus-1", (event) => subscriberEvents.push(event));

    const delta = { type: "answer_delta", text: "hi" } as const;
    publishConversationEvent({ kind: "delta", conversationId: "conv-bus-1", event: delta }, manager);

    expect(sentEvents(send)).toEqual([
      { type: "delta", conversationId: "conv-bus-1", event: delta }
    ]);
    expect(emitterEvents).toEqual([{ conversationId: "conv-bus-1", event: delta }]);
    expect(subscriberEvents).toEqual([{ kind: "delta", conversationId: "conv-bus-1", event: delta }]);
  });

  it("keeps a throwing subscriber from breaking other subscribers or the publisher", async () => {
    const { publishConversationEvent, subscribeConversationEvents } = await import("@/lib/conversation-event-bus");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const received: string[] = [];
    subscribeConversationEvents("conv-bus-2", () => {
      throw new Error("subscriber exploded");
    });
    subscribeConversationEvents("conv-bus-2", (event) => {
      if (event.kind === "delta") received.push(event.event.type);
    });

    expect(() =>
      publishConversationEvent(
        { kind: "delta", conversationId: "conv-bus-2", event: { type: "answer_delta", text: "ok" } },
        manager
      )
    ).not.toThrow();
    expect(received).toEqual(["answer_delta"]);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("isolates subscriptions per conversation", async () => {
    const { publishConversationEvent, subscribeConversationEvents } = await import("@/lib/conversation-event-bus");

    const receivedA: string[] = [];
    subscribeConversationEvents("conv-a", (event) => {
      if (event.kind === "delta") receivedA.push(event.conversationId);
    });

    publishConversationEvent(
      { kind: "delta", conversationId: "conv-b", event: { type: "answer_delta", text: "other" } },
      manager
    );
    expect(receivedA).toEqual([]);

    publishConversationEvent(
      { kind: "delta", conversationId: "conv-a", event: { type: "answer_delta", text: "mine" } },
      manager
    );
    expect(receivedA).toEqual(["conv-a"]);
  });

  it("stops delivery to a subscriber after it unsubscribes", async () => {
    const { publishConversationEvent, subscribeConversationEvents } = await import("@/lib/conversation-event-bus");

    const received: number[] = [];
    const unsubscribe = subscribeConversationEvents("conv-bus-3", () => received.push(1));

    publishConversationEvent(
      { kind: "delta", conversationId: "conv-bus-3", event: { type: "answer_delta", text: "x" } },
      manager
    );
    unsubscribe();
    publishConversationEvent(
      { kind: "delta", conversationId: "conv-bus-3", event: { type: "answer_delta", text: "y" } },
      manager
    );

    expect(received).toEqual([1]);
  });

  it("delivers room events to the ws room only", async () => {
    const { publishConversationEvent, getChatEmitter } = await import("@/lib/conversation-event-bus");

    const send = vi.fn();
    manager.subscribe("conv-bus-4", createMockSocket(send));
    const emitterDeltas: string[] = [];
    getChatEmitter().on("delta", (conversationId) => emitterDeltas.push(conversationId));

    publishConversationEvent(
      {
        kind: "room",
        conversationId: "conv-bus-4",
        message: { type: "queue_updated", conversationId: "conv-bus-4", queuedMessages: [] }
      },
      manager
    );

    expect(sentEvents(send)).toEqual([
      { type: "queue_updated", conversationId: "conv-bus-4", queuedMessages: [] }
    ]);
    expect(emitterDeltas).toEqual([]);
  });

  it("delivers user events via broadcastAll only", async () => {
    const { publishConversationEvent, getChatEmitter } = await import("@/lib/conversation-event-bus");

    const ownerSend = vi.fn();
    const otherSend = vi.fn();
    const ownerSocket = createMockSocket(ownerSend);
    const otherSocket = createMockSocket(otherSend);
    manager.addConnection(ownerSocket, "user-1");
    manager.addConnection(otherSocket, "user-2");
    const emitterDeltas: string[] = [];
    getChatEmitter().on("delta", (conversationId) => emitterDeltas.push(conversationId));

    publishConversationEvent(
      { kind: "user", userId: "user-1", message: { type: "conversation_deleted", conversationId: "conv-bus-5" } },
      manager
    );

    expect(sentEvents(ownerSend)).toEqual([
      { type: "conversation_deleted", conversationId: "conv-bus-5" }
    ]);
    expect(sentEvents(otherSend)).toEqual([]);
    expect(emitterDeltas).toEqual([]);
  });

  it("delivers status events to the sse emitter only", async () => {
    const { publishConversationEvent, getChatEmitter } = await import("@/lib/conversation-event-bus");

    const send = vi.fn();
    manager.subscribe("conv-bus-6", createMockSocket(send));
    const statuses: Array<{ conversationId: string; status: string }> = [];
    getChatEmitter().on("status", (conversationId, status) => statuses.push({ conversationId, status }));

    publishConversationEvent({ kind: "status", conversationId: "conv-bus-6", status: "streaming" }, manager);

    expect(statuses).toEqual([{ conversationId: "conv-bus-6", status: "streaming" }]);
    expect(send).not.toHaveBeenCalled();
  });

  it("still notifies keyed subscribers and the sse emitter when no manager is wired", async () => {
    const { publishConversationEvent, subscribeConversationEvents, getChatEmitter } =
      await import("@/lib/conversation-event-bus");

    const emitterEvents: unknown[] = [];
    getChatEmitter().on("delta", (conversationId, event) => emitterEvents.push({ conversationId, event }));
    const subscriberEvents: string[] = [];
    subscribeConversationEvents("conv-bus-7", (event) => {
      if (event.kind === "delta") subscriberEvents.push(event.conversationId);
    });

    const delta = { type: "answer_delta", text: "no manager" } as const;
    publishConversationEvent({ kind: "delta", conversationId: "conv-bus-7", event: delta }, null);

    expect(emitterEvents).toEqual([{ conversationId: "conv-bus-7", event: delta }]);
    expect(subscriberEvents).toEqual(["conv-bus-7"]);
  });
});
