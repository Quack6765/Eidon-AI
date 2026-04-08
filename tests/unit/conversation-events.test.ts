// @vitest-environment jsdom

import {
  dispatchConversationActivityUpdated,
  dispatchConversationRemoved,
  dispatchConversationTitleUpdated,
  CONVERSATION_ACTIVITY_UPDATED_EVENT,
  CONVERSATION_REMOVED_EVENT,
  CONVERSATION_TITLE_UPDATED_EVENT
} from "@/lib/conversation-events";

describe("conversation-events", () => {
  it("dispatches a conversation title updated event", () => {
    const handler = vi.fn();
    window.addEventListener(CONVERSATION_TITLE_UPDATED_EVENT, handler);

    dispatchConversationTitleUpdated({ conversationId: "conv_1", title: "New Title" });

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ conversationId: "conv_1", title: "New Title" });

    window.removeEventListener(CONVERSATION_TITLE_UPDATED_EVENT, handler);
  });

  it("dispatches a conversation removed event", () => {
    const handler = vi.fn();
    window.addEventListener(CONVERSATION_REMOVED_EVENT, handler);

    dispatchConversationRemoved({ conversationId: "conv_2" });

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ conversationId: "conv_2" });

    window.removeEventListener(CONVERSATION_REMOVED_EVENT, handler);
  });

  it("dispatches a conversation activity updated event with active status", () => {
    const handler = vi.fn();
    window.addEventListener(CONVERSATION_ACTIVITY_UPDATED_EVENT, handler);

    dispatchConversationActivityUpdated({ conversationId: "conv_3", isActive: true });

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ conversationId: "conv_3", isActive: true });

    window.removeEventListener(CONVERSATION_ACTIVITY_UPDATED_EVENT, handler);
  });

  it("dispatches a conversation activity updated event with inactive status", () => {
    const handler = vi.fn();
    window.addEventListener(CONVERSATION_ACTIVITY_UPDATED_EVENT, handler);

    dispatchConversationActivityUpdated({ conversationId: "conv_4", isActive: false });

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ conversationId: "conv_4", isActive: false });

    window.removeEventListener(CONVERSATION_ACTIVITY_UPDATED_EVENT, handler);
  });
});