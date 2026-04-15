import { describe, it, expect } from "vitest";

describe("ws-protocol", () => {
  it("serializes and parses a client subscribe message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "subscribe" as const, conversationId: "conv-1" };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("serializes and parses a client message message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "message" as const, conversationId: "conv-1", content: "hello", attachmentIds: ["att-1"] };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("serializes and parses queue client messages", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const message = { type: "queue_message", conversationId: "conv-1", content: "Queued follow-up" } as const;

    expect(parseClientMessage(serializeClientMessage(message))).toEqual(message);
  });

  it("serializes a server ready message", async () => {
    const { serializeServerMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "ready" as const, activeConversations: [{ id: "conv-1", title: "Test", status: "streaming" as const }] };
    const raw = serializeServerMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("ready");
    expect(parsed.activeConversations).toHaveLength(1);
  });

  it("serializes a server delta message", async () => {
    const { serializeServerMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "delta" as const, conversationId: "conv-1", event: { type: "answer_delta" as const, text: "hello" } };
    const raw = serializeServerMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("delta");
    expect(parsed.event.type).toBe("answer_delta");
  });

  it("returns null for invalid client message JSON", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");
    expect(parseClientMessage("not json")).toBeNull();
  });

  it("returns null for unknown client message type", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");
    expect(parseClientMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
  });

  it("serializes and parses a client stop message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "stop" as const, conversationId: "conv-1" };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("round-trips message mode through the websocket protocol", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");

    const parsed = parseClientMessage(
      JSON.stringify({
        type: "message",
        conversationId: "conv-1",
        content: "same idea but darker",
        mode: "image"
      })
    );

    expect(parsed).toEqual({
      type: "message",
      conversationId: "conv-1",
      content: "same idea but darker",
      mode: "image"
    });
  });

  it("round-trips queue_message mode through the websocket protocol", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");

    const parsed = parseClientMessage(
      JSON.stringify({
        type: "queue_message",
        conversationId: "conv-1",
        content: "make it noir later",
        mode: "image"
      })
    );

    expect(parsed).toEqual({
      type: "queue_message",
      conversationId: "conv-1",
      content: "make it noir later",
      mode: "image"
    });
  });
});
