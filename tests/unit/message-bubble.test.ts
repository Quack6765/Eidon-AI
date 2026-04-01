// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

function createUserMessage(): Message {
  return {
    id: "msg_user",
    conversationId: "conv_test",
    role: "user",
    content: "User draft",
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
        timeline: [
          {
            id: "act_running",
            messageId: "msg_assistant",
            timelineKind: "action",
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

  it("keeps the thought shell above action rows", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          thinkingContent: "Reasoning summary",
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

    const thinkingShell = screen.getByTestId("assistant-thinking-shell");
    const actionsShell = screen.getByTestId("assistant-actions-shell");

    expect(thinkingShell.compareDocumentPosition(actionsShell)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("renders assistant text and tool actions in timeline order", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "First segmentSecond segment",
          timeline: [
            {
              id: "txt_1",
              timelineKind: "text",
              sortOrder: 0,
              createdAt: new Date().toISOString(),
              content: "First segment"
            },
            {
              id: "act_done",
              messageId: "msg_assistant",
              timelineKind: "action",
              kind: "mcp_tool_call",
              status: "completed",
              serverId: "mcp_docs",
              skillId: null,
              toolName: "search_docs",
              label: "Search docs",
              detail: "query=MCP",
              arguments: { query: "MCP" },
              resultSummary: "Found MCP documentation",
              sortOrder: 1,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            },
            {
              id: "txt_2",
              timelineKind: "text",
              sortOrder: 2,
              createdAt: new Date().toISOString(),
              content: "Second segment"
            }
          ]
        }
      })
    );

    const blocks = Array.from(container.querySelectorAll('[data-testid="assistant-message-bubble"], [data-testid="assistant-actions-shell"]'));

    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.textContent).toContain("First segment");
    expect(blocks[1]?.textContent).toContain("Search docs");
    expect(blocks[2]?.textContent).toContain("Second segment");
  });

  it("keeps the thinking shell visible while streamed reasoning is buffered", () => {
    render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "Answer started",
        awaitingFirstToken: false,
        thinkingInProgress: false,
        hasThinking: true,
        timeline: []
      })
    );

    expect(screen.getByText("Thought")).toBeInTheDocument();
    expect(screen.getByText("Answer started")).toBeInTheDocument();
  });

  it("reveals streamed thinking content after the user expands the panel", () => {
    render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "Working through the prompt",
        answer: "",
        awaitingFirstToken: false,
        thinkingInProgress: true,
        hasThinking: true,
        timeline: []
      })
    );

    const toggle = screen.getByRole("button", { name: /Thinking/i });

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("...")).toBeInTheDocument();
    expect(screen.queryByText("Working through the prompt")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByText("Working through the prompt")).toBeInTheDocument();
  });

  it("keeps persisted thinking content collapsed by default", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          thinkingContent: "Reasoning summary"
        }
      })
    );

    expect(screen.getByText("Thought")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning summary")).toBeNull();
  });

  it("renders double-escaped assistant and thinking line breaks as markdown paragraphs", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "First line\\\\nSecond line\\\\n\\\\nThird paragraph\\\\n\\\\n\\\\nFourth paragraph",
          thinkingContent: "Thought one\\\\nThought two\\\\n\\\\nThought three\\\\n\\\\n\\\\nThought four"
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Thought/i }));

    const markdownBlocks = Array.from(container.querySelectorAll(".markdown-body"));

    expect(markdownBlocks).toHaveLength(2);
    expect(markdownBlocks[0]?.innerHTML).toContain("<p>Thought one<br>");
    expect(markdownBlocks[0]?.innerHTML).toContain("<p>Thought three</p>");
    expect(markdownBlocks[0]?.innerHTML).toContain("<p>&nbsp;</p>");
    expect(markdownBlocks[0]?.innerHTML).toContain("<p>Thought four</p>");
    expect(markdownBlocks[1]?.innerHTML).toContain("<p>First line<br>");
    expect(markdownBlocks[1]?.innerHTML).toContain("<p>Third paragraph</p>");
    expect(markdownBlocks[1]?.innerHTML).toContain("<p>&nbsp;</p>");
    expect(markdownBlocks[1]?.innerHTML).toContain("<p>Fourth paragraph</p>");
  });

  it("renders markdown elements inside a compact assistant bubble", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: [
            "# Markdown Test Report",
            "",
            "This is a **diagnostic document** with _inline emphasis_.",
            "",
            "## Lists",
            "",
            "- Alpha",
            "- Beta",
            "  - Nested bullet",
            "",
            "1. First item",
            "2. Second item",
            "",
            "- [x] Completed task",
            "- [ ] Incomplete task",
            "",
            "> Single line quote.",
            "",
            "```py",
            "def verify_rendering():",
            '    return "Syntax highlighting works"',
            "```",
            "",
            "| Feature | Rendered |",
            "| --- | --- |",
            "| Bold | Yes |",
            "",
            "[Test Link](https://example.com)",
            "",
            "![Placeholder Image](https://example.com/image.png)",
            "",
            "---"
          ].join("\n")
        }
      })
    );

    expect(screen.getByTestId("assistant-message-bubble").className).toContain("w-fit");
    expect(screen.getByRole("heading", { level: 1, name: "Markdown Test Report" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Lists" })).toBeInTheDocument();
    expect(screen.getAllByRole("list").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector("blockquote")).not.toBeNull();
    expect(container.querySelector("pre code")).not.toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Test Link" })).toHaveAttribute("href", "https://example.com");
    expect(screen.getByRole("img", { name: "Placeholder Image" })).toHaveAttribute(
      "src",
      "https://example.com/image.png"
    );
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("copies assistant output through the clipboard fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
    vi.stubGlobal("ClipboardItem", undefined);

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "## Copied heading\n\nLine two"
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it("allows editing user messages through the inline controls", async () => {
    const onUpdateUserMessage = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(MessageBubble, {
        message: createUserMessage(),
        onUpdateUserMessage
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit message" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Updated user draft" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

    await waitFor(() => {
      expect(onUpdateUserMessage).toHaveBeenCalledWith("msg_user", "Updated user draft");
    });
  });

  it("renders user attachments alongside the message body", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          id: "msg_user",
          conversationId: "conv_test",
          role: "user",
          content: "See attached",
          thinkingContent: "",
          status: "completed",
          estimatedTokens: 0,
          systemKind: null,
          compactedAt: null,
          createdAt: new Date().toISOString(),
          attachments: [
            {
              id: "att_image",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "photo.png",
              mimeType: "image/png",
              byteSize: 10,
              sha256: "hash",
              relativePath: "conv_test/att_image_photo.png",
              kind: "image",
              extractedText: "",
              createdAt: new Date().toISOString()
            },
            {
              id: "att_text",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "notes.txt",
              mimeType: "text/plain",
              byteSize: 10,
              sha256: "hash2",
              relativePath: "conv_test/att_text_notes.txt",
              kind: "text",
              extractedText: "hello",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    expect(screen.getByAltText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });
});
