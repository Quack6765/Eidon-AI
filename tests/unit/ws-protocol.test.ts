import { describe, it, expect } from "vitest";

describe("ws-protocol", () => {
  it("serializes and parses a client subscribe message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "subscribe", conversationId: "conv-1" };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("serializes and parses a client message message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "message", conversationId: "conv-1", content: "hello", attachmentIds: ["att-1"] };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("serializes a server ready message", async () => {
    const { serializeServerMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "ready", activeConversations: [{ id: "conv-1", title: "Test", status: "streaming" as const }] };
    const raw = serializeServerMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("ready");
    expect(parsed.activeConversations).toHaveLength(1);
  });

  it("serializes a server delta message", async () => {
    const { serializeServerMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hello" } };
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
});
