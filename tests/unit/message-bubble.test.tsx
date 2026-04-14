// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";

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

function createUserMessage(): Message {
  return {
    id: "msg_user",
    conversationId: "conv_test",
    role: "user",
    content: "Edit me",
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

  it("shows the edit action for user messages only", () => {
    const { rerender } = render(
      React.createElement(MessageBubble, {
        message: createUserMessage()
      })
    );

    expect(screen.getByRole("button", { name: "Edit message" })).toBeInTheDocument();

    rerender(
      React.createElement(MessageBubble, {
        message: createAssistantMessage()
      })
    );

    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
  });
});
