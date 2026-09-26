import { describe, expect, it, vi } from "vitest";

import { broadcastActionUpdate } from "@/lib/action-broadcast";
import { getChatEmitter } from "@/lib/chat-turn";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";
import { getConversationManager } from "@/lib/ws-singleton";

describe("broadcastActionUpdate", () => {
  it("sends a resolved card to WebSocket viewers and to the turn's event stream", async () => {
    const conversation = createConversation("Chat");
    const message = createMessage({ conversationId: conversation.id, role: "assistant", content: "" });
    const action = createMessageAction({
      messageId: message.id,
      kind: "tool_approval",
      label: "Approve command",
      status: "completed"
    });

    const manager = getConversationManager();
    const sent: unknown[] = [];
    const originalBroadcast = manager.broadcast;
    manager.broadcast = (conversationId: string, payload: Parameters<typeof originalBroadcast>[1]) => {
      sent.push({ conversationId, payload });
    };
    const emitted: unknown[] = [];
    const unsubscribe = getChatEmitter().on("delta", (conversationId, event) => {
      emitted.push({ conversationId, event });
    });

    try {
      broadcastActionUpdate(action);
      await vi.waitFor(() => expect(emitted).toHaveLength(1));
    } finally {
      manager.broadcast = originalBroadcast;
      unsubscribe();
    }

    const event = { type: "action_complete", action };
    expect(sent).toEqual([{ conversationId: conversation.id, payload: { type: "delta", conversationId: conversation.id, event } }]);
    expect(emitted).toEqual([{ conversationId: conversation.id, event }]);
  });

  it("does nothing when the card's message is gone", () => {
    const manager = getConversationManager();
    const sent: unknown[] = [];
    const originalBroadcast = manager.broadcast;
    manager.broadcast = (...args: Parameters<typeof originalBroadcast>) => {
      sent.push(args);
    };
    try {
      broadcastActionUpdate({
        id: "act_missing",
        messageId: "msg_missing",
        kind: "tool_approval",
        status: "completed",
        serverId: null,
        skillId: null,
        toolName: null,
        label: "",
        detail: "",
        arguments: null,
        resultSummary: "",
        sortOrder: 0,
        startedAt: "2026-09-26T00:00:00.000Z",
        completedAt: null,
        proposalState: null,
        proposalPayload: null,
        proposalUpdatedAt: null
      });
    } finally {
      manager.broadcast = originalBroadcast;
    }
    expect(sent).toEqual([]);
  });
});
