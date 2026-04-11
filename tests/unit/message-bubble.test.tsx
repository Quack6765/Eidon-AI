// @vitest-environment jsdom

import React from "react";
import { render } from "@testing-library/react";

import { MessageBubble } from "@/components/message-bubble";
import type { Message } from "@/lib/types";

function createAssistantMessage(): Message {
  return {
    id: "msg_assistant",
    conversationId: "conv_test",
    role: "assistant",
    content: "Final answer",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0,
    systemKind: null,
    compactedAt: null,
    createdAt: new Date().toISOString(),
    actions: []
  };
}

describe("message bubble avatar", () => {
  it("renders the assistant avatar from agent-icon.png", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createAssistantMessage()
      })
    );

    expect(container.querySelector('img[src="/agent-icon.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="/chat-icon.png"]')).toBeNull();
  });
});
