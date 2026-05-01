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

  it("renders assistant-imported local screenshots and files as attachment tiles without markdown output", () => {
    const rawContent = [
      "Here is the exported report.",
      "",
      "![Screenshot](screenshot.png)",
      "",
      "[Report](report.txt)"
    ].join("\n");
    const attachments = [
      {
        id: "att_image",
        conversationId: "conv_test",
        messageId: "msg_assistant",
        filename: "screenshot.png",
        mimeType: "image/png",
        byteSize: 10,
        sha256: "hash-image",
        relativePath: "conv_test/att_image_screenshot.png",
        kind: "image" as const,
        extractedText: "",
        createdAt: new Date().toISOString()
      },
      {
        id: "att_report",
        conversationId: "conv_test",
        messageId: "msg_assistant",
        filename: "report.txt",
        mimeType: "text/plain",
        byteSize: 10,
        sha256: "hash-report",
        relativePath: "conv_test/att_report_report.txt",
        kind: "text" as const,
        extractedText: "report body",
        createdAt: new Date().toISOString()
      }
    ];

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: rawContent,
          attachments
        }
      })
    );

    expect(screen.getByText("Here is the exported report.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview screenshot.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview report.txt" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^Preview / })).toHaveLength(2);
    expect(screen.queryByText("![Screenshot]")).toBeNull();
    expect(screen.queryByText("[Report]")).toBeNull();
    expect(screen.queryByRole("link", { name: "Report" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Screenshot" })).toBeNull();
  });
});

describe("data-message-id attribute", () => {
  it("renders data-message-id on user message root element", () => {
    const message = {
      ...createUserMessage(),
      id: "msg_user_1"
    };
    const { container } = render(
      React.createElement(MessageBubble, { message })
    );
    const userBubble = container.querySelector('[data-message-id="msg_user_1"]');
    expect(userBubble).toBeInTheDocument();
  });

  it("renders data-message-id on assistant message root element", () => {
    const message = {
      ...createAssistantMessage(),
      id: "msg_asst_1"
    };
    const { container } = render(
      React.createElement(MessageBubble, { message })
    );
    const asstBubble = container.querySelector('[data-message-id="msg_asst_1"]');
    expect(asstBubble).toBeInTheDocument();
  });
});
