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

  it("accepts message content up to the shared limit and rejects anything longer", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");
    const { MAX_CHAT_MESSAGE_CHARS } = await import("@/lib/constants");
    const base = { type: "message" as const, conversationId: "conv-1" };

    expect(
      parseClientMessage(JSON.stringify({ ...base, content: "a".repeat(MAX_CHAT_MESSAGE_CHARS) }))
    ).toEqual({ ...base, content: "a".repeat(MAX_CHAT_MESSAGE_CHARS) });
    expect(
      parseClientMessage(JSON.stringify({ ...base, content: "a".repeat(MAX_CHAT_MESSAGE_CHARS + 1) }))
    ).toBeNull();
  });

  it("serializes and parses queue client messages", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const message = { type: "queue_message", conversationId: "conv-1", content: "Queued follow-up" } as const;

    expect(parseClientMessage(serializeClientMessage(message))).toEqual(message);
  });

  it("serializes and parses snapshot recovery and queue reorder messages", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const snapshot = { type: "request_snapshot", conversationId: "conv-1" } as const;
    const reorder: import("@/lib/ws-protocol").ClientMessage = {
      type: "reorder_queued_messages",
      conversationId: "conv-1",
      queuedMessageIds: ["queue-2", "queue-1"]
    };

    expect(parseClientMessage(serializeClientMessage(snapshot))).toEqual(snapshot);
    expect(parseClientMessage(serializeClientMessage(reorder))).toEqual(reorder);
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

  it.each([
    { type: "subscribe" },
    { type: "subscribe", conversationId: "   " },
    { type: "stop", conversationId: {} },
    { type: "message", conversationId: "conv-1", content: {} },
    { type: "message", conversationId: "conv-1", content: "   ", attachmentIds: [] },
    { type: "message", conversationId: "conv-1", content: "", attachmentIds: ["   "] },
    { type: "message", conversationId: "conv-1", content: "hello", attachmentIds: [null] },
    { type: "queue_message", conversationId: "conv-1", content: "   " },
    { type: "update_queued_message", conversationId: "conv-1", queuedMessageId: "queue-1" },
    { type: "update_queued_message", conversationId: "conv-1", queuedMessageId: "queue-1", content: "\t" },
    { type: "reorder_queued_messages", conversationId: "conv-1", queuedMessageIds: "queue-1" },
    { type: "reorder_queued_messages", conversationId: "conv-1", queuedMessageIds: ["queue-1", "queue-1"] },
    { type: "reorder_queued_messages", conversationId: "conv-1", queuedMessageIds: [" "] },
    { type: "reorder_queued_messages", conversationId: "conv-1", queuedMessageIds: Array(101).fill("queue") }
  ])("returns null for malformed client message fields", async (message) => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");
    expect(parseClientMessage(JSON.stringify(message))).toBeNull();
  });

  it("accepts an attachment-only chat message", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");

    expect(parseClientMessage(JSON.stringify({
      type: "message",
      conversationId: "conv-1",
      content: "",
      attachmentIds: ["att-1"]
    }))).toEqual({
      type: "message",
      conversationId: "conv-1",
      content: "",
      attachmentIds: ["att-1"]
    });
  });

  it("serializes and parses a client stop message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "stop" as const, conversationId: "conv-1" };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("round-trips message with personaId through the websocket protocol", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");

    const parsed = parseClientMessage(
      JSON.stringify({
        type: "message",
        conversationId: "conv-1",
        content: "same idea but darker",
        personaId: "persona-1"
      })
    );

    expect(parsed).toEqual({
      type: "message",
      conversationId: "conv-1",
      content: "same idea but darker",
      personaId: "persona-1"
    });
  });
});

describe("ws-protocol research payloads", () => {
  const base = { type: "message", conversationId: "conv-1", content: "Research heat pumps" };

  it("round-trips a research request with and without a plan", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");

    expect(parseClientMessage(JSON.stringify({ ...base, research: { plan: [" Compare prices ", "Read reviews"] } }))).toEqual({
      ...base,
      research: { plan: ["Compare prices", "Read reviews"] }
    });
    expect(parseClientMessage(JSON.stringify({ ...base, research: {} }))).toEqual({ ...base, research: {} });
    expect(parseClientMessage(JSON.stringify(base))).toEqual(base);
  });

  it.each([
    ["13 steps", { plan: Array.from({ length: 13 }, (_, index) => `step ${index}`) }],
    ["an oversized step", { plan: ["x".repeat(10_000)] }],
    ["a non-string step", { plan: ["ok", { text: "nested" }] }],
    ["an empty plan", { plan: [] }],
    ["a non-object payload", "yes"],
    ["an array payload", ["plan"]],
    ["unknown keys", { plan: ["ok"], deadlineMs: 5 }]
  ])("rejects a research payload with %s", async (_label, research) => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");

    expect(parseClientMessage(JSON.stringify({ ...base, research }))).toBeNull();
  });
});
