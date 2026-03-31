// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";

import { MessageBubble, StreamingPlaceholder } from "@/components/message-bubble";
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

describe("message bubble", () => {
  it("renders running tool actions with a spinner while streaming", () => {
    const { container } = render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "",
        awaitingFirstToken: false,
        thinkingInProgress: false,
        actions: [
          {
            id: "act_running",
            messageId: "msg_assistant",
            kind: "mcp_tool_call",
            status: "running",
            serverId: "mcp_docs",
            skillId: null,
            toolName: "search_docs",
            label: "Search docs",
            detail: "query=MCP",
            arguments: { query: "MCP" },
            resultSummary: "",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: null
          }
        ]
      })
    );

    expect(screen.getByText("Search docs")).toBeInTheDocument();
    expect(screen.getByText(/query=MCP/)).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders persisted completed actions with their summaries", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          actions: [
            {
              id: "act_done",
              messageId: "msg_assistant",
              kind: "mcp_tool_call",
              status: "completed",
              serverId: "mcp_docs",
              skillId: null,
              toolName: "search_docs",
              label: "Search docs",
              detail: "query=MCP",
              arguments: { query: "MCP" },
              resultSummary: "Found MCP documentation",
              sortOrder: 0,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    expect(screen.getByText("Search docs")).toBeInTheDocument();
    expect(screen.getByText("Found MCP documentation")).toBeInTheDocument();
  });
});
