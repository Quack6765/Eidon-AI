// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageBubble, StreamingPlaceholder } from "@/components/message-bubble";
import type { Message, MessageAction, MessageTimelineItem } from "@/lib/types";

const originalFetch = global.fetch;
const OriginalImage = global.Image;

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

function createMemoryProposalAction(
  overrides: Partial<Extract<MessageTimelineItem, { timelineKind: "action" }>> = {}
) {
  return {
    id: "act_memory",
    messageId: "msg_assistant",
    timelineKind: "action" as const,
    kind: "create_memory" as const,
    status: "pending" as const,
    serverId: null,
    skillId: null,
    toolName: "create_memory",
    label: "Create memory proposal",
    detail: "TypeScript preference",
    arguments: {
      content: "TypeScript preference",
      category: "preference"
    },
    resultSummary: "",
    sortOrder: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    proposalState: "pending" as const,
    proposalPayload: {
      operation: "create" as const,
      targetMemoryId: null,
      proposedMemory: {
        content: "TypeScript preference",
        category: "preference" as const
      }
    },
    proposalUpdatedAt: new Date().toISOString(),
    ...overrides
  };
}

function createToolAction(
  overrides: Partial<MessageAction> &
    Pick<MessageAction, "id" | "messageId" | "label" | "detail" | "resultSummary">
): MessageAction {
  return {
    kind: "mcp_tool_call",
    status: "completed",
    serverId: null,
    skillId: null,
    toolName: "search_docs",
    arguments: { query: "MCP" },
    sortOrder: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null,
    ...overrides
  };
}

function createMemoryProposalMessage(
  overrides: Partial<Message> = {},
  actionOverrides: Partial<Extract<MessageTimelineItem, { timelineKind: "action" }>> = {}
): Message {
  return {
    ...createAssistantMessage(),
    content: "I can remember that.",
    timeline: [createMemoryProposalAction(actionOverrides)],
    ...overrides
  };
}

function installMockImage({ fail = false }: { fail?: boolean } = {}) {
  class MockImage {
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    set src(_value: string) {
      window.setTimeout(() => {
        if (fail) {
          this.onerror?.();
          return;
        }

        this.onload?.();
      }, 0);
    }
  }

  global.Image = MockImage as unknown as typeof Image;
}

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  global.Image = OriginalImage;
});

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
            ...createToolAction({
              id: "act_running",
              messageId: "msg_assistant",
              label: "Search docs",
              detail: "query=MCP",
              resultSummary: "",
              status: "running",
              serverId: "mcp_docs",
              toolName: "search_docs",
              completedAt: null
            }),
            timelineKind: "action",
          }
        ]
      })
    );

    expect(screen.getByText("Search docs")).toBeInTheDocument();
    expect(screen.queryByText(/query=MCP/)).toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders persisted completed actions with their summaries", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          actions: [
            createToolAction({
              id: "act_done",
              messageId: "msg_assistant",
              serverId: "mcp_docs",
              toolName: "search_docs",
              label: "Search docs",
              detail: "query=MCP",
              resultSummary: "Found MCP documentation"
            })
          ]
        }
      })
    );

    const toggle = screen.getByRole("button", { name: /Search docs/i });

    expect(toggle).toBeInTheDocument();
    expect(screen.queryByText("Found MCP documentation")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByText("query=MCP")).toBeInTheDocument();
    expect(screen.getByText("Found MCP documentation")).toBeInTheDocument();
  });

  it("renders pending create proposals with operation-specific copy", () => {
    render(
      React.createElement(MessageBubble, {
        message: createMemoryProposalMessage()
      })
    );

    expect(screen.getByText("Save memory")).toBeInTheDocument();
    expect(screen.getByText("TypeScript preference")).toBeInTheDocument();
    expect(screen.getByText("preference")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByText("Create memory proposal")).toBeNull();
    expect(screen.queryByText(/query=MCP/)).toBeNull();
  });

  it("renders pending update proposals with before and after details", () => {
    render(
      React.createElement(MessageBubble, {
        message: createMemoryProposalMessage(
          {},
          {
            kind: "update_memory",
            toolName: "update_memory",
            label: "Update memory proposal",
            detail: "Prefers strict TypeScript",
            arguments: {
              id: "mem_1",
              content: "Prefers strict TypeScript",
              category: "work"
            },
            proposalPayload: {
              operation: "update",
              targetMemoryId: "mem_1",
              currentMemory: {
                id: "mem_1",
                content: "TypeScript preference",
                category: "preference"
              },
              proposedMemory: {
                content: "Prefers strict TypeScript",
                category: "work"
              }
            }
          }
        )
      })
    );

    expect(screen.getByText("Update memory")).toBeInTheDocument();
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("TypeScript preference")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText("Prefers strict TypeScript")).toBeInTheDocument();
    expect(screen.getByText("work")).toBeInTheDocument();
    expect(screen.queryByText("Update memory proposal")).toBeNull();
  });

  it("lets the user edit a create proposal and cancel without mutating it", async () => {
    const onApproveMemoryProposal = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(MessageBubble, {
        message: createMemoryProposalMessage(),
        onApproveMemoryProposal
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Prefers strict TypeScript" }
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "work" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("TypeScript preference")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Prefers strict TypeScript")).toBeNull();
    expect(onApproveMemoryProposal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Prefers strict TypeScript" }
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "work" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onApproveMemoryProposal).toHaveBeenCalledWith("act_memory", {
        content: "Prefers strict TypeScript",
        category: "work"
      });
    });
  });

  it("renders delete proposals as confirmation cards with delete and cancel actions", async () => {
    const onDismissMemoryProposal = vi.fn().mockResolvedValue(undefined);
    const onApproveMemoryProposal = vi.fn().mockResolvedValue(undefined);

    render(
      React.createElement(MessageBubble, {
        message: createMemoryProposalMessage(
          {},
          {
            id: "act_memory_delete",
            kind: "delete_memory",
            toolName: "delete_memory",
            label: "Delete memory proposal",
            detail: "Loves TypeScript",
            arguments: { id: "mem_1" },
            proposalPayload: {
              operation: "delete",
              targetMemoryId: "mem_1",
              currentMemory: {
                id: "mem_1",
                content: "Loves TypeScript",
                category: "preference"
              }
            }
          }
        ),
        onApproveMemoryProposal,
        onDismissMemoryProposal
      })
    );

    expect(screen.getAllByText("Delete memory").length).toBeGreaterThan(0);
    expect(screen.getByText("Remove this memory from saved context.")).toBeInTheDocument();
    expect(screen.getByText("Loves TypeScript")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete memory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByText("Delete memory proposal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete memory" }));

    await waitFor(() => {
      expect(onApproveMemoryProposal).toHaveBeenCalledWith("act_memory_delete", undefined);
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(onDismissMemoryProposal).toHaveBeenCalledWith("act_memory_delete");
    });
  });

  it("keeps resolved memory proposals on the specialized card path", () => {
    render(
      React.createElement(MessageBubble, {
        message: createMemoryProposalMessage(
          {},
          {
            kind: "update_memory",
            toolName: "update_memory",
            label: "Update memory proposal",
            status: "completed",
            proposalState: "approved",
            detail: "Prefers strict TypeScript",
            proposalPayload: {
              operation: "update",
              targetMemoryId: "mem_1",
              currentMemory: {
                id: "mem_1",
                content: "TypeScript preference",
                category: "preference"
              },
              proposedMemory: {
                content: "Prefers strict TypeScript",
                category: "work"
              }
            }
          }
        )
      })
    );

    expect(screen.getByText("Memory updated")).toBeInTheDocument();
    expect(screen.getByText("Prefers strict TypeScript")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update memory proposal" })).toBeNull();
  });

  it("renders specialized error cards for failed proposal approvals", () => {
    render(
      React.createElement(MessageBubble, {
        message: createMemoryProposalMessage(
          {},
          {
            label: "Create memory proposal",
            status: "error",
            proposalState: "pending",
            resultSummary: "Memory limit reached"
          }
        )
      })
    );

    expect(screen.getByText("Memory not saved")).toBeInTheDocument();
    expect(screen.getByText("Memory limit reached")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create memory proposal" })).toBeNull();
  });

  it("keeps the thought shell above action rows", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          thinkingContent: "Reasoning summary",
          actions: [
            createToolAction({
              id: "act_done",
              messageId: "msg_assistant",
              serverId: "mcp_docs",
              toolName: "search_docs",
              label: "Search docs",
              detail: "query=MCP",
              resultSummary: "Found MCP documentation"
            })
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
              ...createToolAction({
                id: "act_done",
                messageId: "msg_assistant",
                serverId: "mcp_docs",
                toolName: "search_docs",
                label: "Search docs",
                detail: "query=MCP",
                resultSummary: "Found MCP documentation",
                sortOrder: 1
              }),
              timelineKind: "action",
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

  it("collapses adjacent assistant text segments into a single bubble", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "Hello there",
          timeline: [
            {
              id: "txt_1",
              timelineKind: "text",
              sortOrder: 0,
              createdAt: new Date().toISOString(),
              content: "Hello"
            },
            {
              id: "txt_2",
              timelineKind: "text",
              sortOrder: 1,
              createdAt: new Date().toISOString(),
              content: " there"
            }
          ]
        }
      })
    );

    const bubbles = container.querySelectorAll('[data-testid="assistant-message-bubble"]');

    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.textContent).toContain("Hello there");
  });

  it("renders memory proposal cards after the full assistant answer", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "Got it, Charles. I'll remember that you prefer Celsius over Fahrenheit.",
          timeline: [
            {
              id: "txt_before_memory",
              timelineKind: "text",
              sortOrder: 0,
              createdAt: new Date().toISOString(),
              content: "Got it, Charles. "
            },
            createMemoryProposalAction(),
            {
              id: "txt_after_memory",
              timelineKind: "text",
              sortOrder: 2,
              createdAt: new Date().toISOString(),
              content: "I'll remember that you prefer Celsius over Fahrenheit."
            }
          ]
        }
      })
    );

    const blocks = Array.from(
      container.querySelectorAll(
        '[data-testid="assistant-message-bubble"], [data-testid="assistant-actions-shell"]'
      )
    );
    const bubbles = container.querySelectorAll('[data-testid="assistant-message-bubble"]');

    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]?.textContent).toContain(
      "Got it, Charles. I'll remember that you prefer Celsius over Fahrenheit."
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.getAttribute("data-testid")).toBe("assistant-message-bubble");
    expect(blocks[1]?.getAttribute("data-testid")).toBe("assistant-actions-shell");
    expect(blocks[1]?.textContent).toContain("Save memory");
  });

  it("collapses consecutive retries of the same tool into a single visible action row", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "Done",
          timeline: [
            {
              ...createToolAction({
                id: "act_error",
                messageId: "msg_assistant",
                serverId: "mcp_exa",
                toolName: "web_search_exa",
                label: "web_search_exa",
                detail: "query=weather",
                resultSummary: "validation failed",
                status: "error"
              }),
              timelineKind: "action",
            },
            {
              ...createToolAction({
                id: "act_done",
                messageId: "msg_assistant",
                serverId: "mcp_exa",
                toolName: "web_search_exa",
                label: "web_search_exa",
                detail: "query=weather",
                resultSummary: "Found weather",
                sortOrder: 1
              }),
              timelineKind: "action",
            }
          ]
        }
      })
    );

    const toolButtons = screen.getAllByRole("button", { name: "web_search_exa" });

    expect(toolButtons).toHaveLength(1);
  });

  it("renders a compact loading shell while awaiting the first token", () => {
    const { container } = render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "",
        awaitingFirstToken: true,
        thinkingInProgress: false,
        timeline: []
      })
    );

    const loadingShell = screen.getByTestId("assistant-loading-shell");

    expect(loadingShell).toBeInTheDocument();
    expect(loadingShell.className).toContain("rounded-lg");
    expect(loadingShell.className).toContain("overflow-hidden");
    expect(loadingShell.className).toContain("mt-[6px]");
    expect(loadingShell.className).not.toContain("rounded-2xl");
    expect(screen.queryByTestId("assistant-message-bubble")).toBeNull();
    expect(container.querySelectorAll(".typing-dot")).toHaveLength(3);
    expect(container.querySelector(".typing-dot")).toHaveStyle("--typing-dot-lift: 2px");
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

  it("renders expanded thinking content with the compact thinking markdown wrapper", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          thinkingContent: [
            "## Reasoning",
            "",
            "- First check",
            "- Second check",
            "",
            "Final detail"
          ].join("\n")
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Thought/i }));

    const thinkingMarkdown = container.querySelector(".thinking-markdown-body");
    const assistantMarkdown = container.querySelector(
      '[data-testid="assistant-message-bubble"] .markdown-body'
    );

    expect(thinkingMarkdown).not.toBeNull();
    expect(thinkingMarkdown?.textContent).toContain("Reasoning");
    expect(thinkingMarkdown?.textContent).toContain("First check");
    expect(thinkingMarkdown?.textContent).toContain("Second check");
    expect(thinkingMarkdown?.textContent).toContain("Final detail");
    expect(assistantMarkdown).not.toBeNull();
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

    const thinkingMarkdown = container.querySelector(".thinking-markdown-body");
    const answerMarkdown = container.querySelector(
      '[data-testid="assistant-message-bubble"] .markdown-body'
    );

    expect(thinkingMarkdown?.textContent).toContain("Thought one");
    expect(thinkingMarkdown?.textContent).toContain("Thought two");
    expect(thinkingMarkdown?.textContent).toContain("Thought three");
    expect(thinkingMarkdown?.textContent).toContain("Thought four");
    expect(thinkingMarkdown?.textContent).not.toContain("\\\\n");
    expect(answerMarkdown?.textContent).toContain("First line");
    expect(answerMarkdown?.textContent).toContain("Second line");
    expect(answerMarkdown?.textContent).toContain("Third paragraph");
    expect(answerMarkdown?.textContent).toContain("Fourth paragraph");
    expect(answerMarkdown?.textContent).not.toContain("\\\\n");
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

  it("renders a fork action for completed assistant messages", () => {
    render(
      React.createElement(MessageBubble as React.ComponentType<any>, {
        message: {
          ...createAssistantMessage(),
          content: "Ready to fork"
        },
        onForkAssistantMessage: vi.fn()
      })
    );

    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fork conversation from message" })
    ).toBeInTheDocument();
  });

  it("keeps the copy action visible for non-completed assistant messages while hiding fork", () => {
    render(
      React.createElement(MessageBubble as React.ComponentType<any>, {
        message: {
          ...createAssistantMessage(),
          status: "streaming",
          content: "Still composing"
        },
        onForkAssistantMessage: vi.fn()
      })
    );

    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Fork conversation from message" })
    ).toBeNull();
  });

  it("does not render a fork action for user messages", () => {
    render(
      React.createElement(MessageBubble as React.ComponentType<any>, {
        message: createUserMessage(),
        onForkAssistantMessage: vi.fn()
      })
    );

    expect(
      screen.queryByRole("button", { name: "Fork conversation from message" })
    ).toBeNull();
  });

  it("does not render a fork action for streaming placeholders", () => {
    render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "Still streaming",
        awaitingFirstToken: false,
        thinkingInProgress: false,
        timeline: [],
        onForkAssistantMessage: vi.fn()
      } as any)
    );

    expect(
      screen.queryByRole("button", { name: "Fork conversation from message" })
    ).toBeNull();
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

    expect(screen.getByRole("button", { name: "Preview photo.png" })).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("opens image attachments in a centered modal and closes with the X button", async () => {
    installMockImage();

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
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
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));

    expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
    expect(screen.getByText("Loading preview…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "photo.png" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close attachment preview" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });
  });

  it("loads text attachments into a read-only preview surface", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "att_text",
        filename: "notes.txt",
        mimeType: "text/plain",
        content: "hello from the preview route"
      })
    } as Response);

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
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

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(screen.getByText("hello from the preview route")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/attachments/att_text?format=text");
    expect(screen.getByRole("link", { name: "Open raw attachment" })).toHaveAttribute(
      "href",
      "/api/attachments/att_text"
    );
  });

  it("reuses cached text previews when the content is an empty string", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "att_text",
        filename: "notes.txt",
        mimeType: "text/plain",
        content: ""
      })
    } as Response);

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
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
              extractedText: "",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Close attachment preview" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
    });
  });

  it("closes the attachment modal when Escape is pressed", async () => {
    installMockImage();

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
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
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });
  });

  it("closes the attachment modal when the backdrop is clicked", async () => {
    installMockImage();

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
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
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("dialog", { name: "Attachment preview" }).parentElement!);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    });
  });

  it("shows the unsupported preview fallback when the route rejects inline text preview", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 415
    } as Response);

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
            {
              id: "att_binary",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "archive.bin",
              mimeType: "application/octet-stream",
              byteSize: 10,
              sha256: "hash-binary",
              relativePath: "conv_test/att_binary_archive.bin",
              kind: "text",
              extractedText: "",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview archive.bin" }));

    await waitFor(() => {
      expect(
        screen.getByText("Preview unavailable for this attachment type.")
      ).toBeInTheDocument();
    });
  });

  it("keeps seeded extracted text visible when the refresh route responds with unsupported", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 415
    } as Response);

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
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
              extractedText: "seeded preview content",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(screen.getByText("seeded preview content")).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Preview unavailable for this attachment type.")
    ).toBeNull();
  });

  it("uses stored extracted text when refreshing a text preview fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network down"));

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
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
              extractedText: "hello from extracted text",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview notes.txt" }));

    await waitFor(() => {
      expect(screen.getByText("hello from extracted text")).toBeInTheDocument();
    });

    expect(screen.queryByText("Network down")).toBeNull();
  });

  it("ignores stale text preview responses when a newer attachment is selected", async () => {
    let resolveFirst:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;
    let resolveSecond:
      | ((value: Response | PromiseLike<Response>) => void)
      | undefined;

    global.fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecond = resolve;
          })
      );

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
          attachments: [
            {
              id: "att_first",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "first.txt",
              mimeType: "text/plain",
              byteSize: 10,
              sha256: "hash-first",
              relativePath: "conv_test/att_first_first.txt",
              kind: "text",
              extractedText: "first",
              createdAt: new Date().toISOString()
            },
            {
              id: "att_second",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "second.txt",
              mimeType: "text/plain",
              byteSize: 10,
              sha256: "hash-second",
              relativePath: "conv_test/att_second_second.txt",
              kind: "text",
              extractedText: "second",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview second.txt" }));

    resolveSecond?.({
      ok: true,
      json: async () => ({
        id: "att_second",
        filename: "second.txt",
        mimeType: "text/plain",
        content: "second attachment content"
      })
    } as Response);

    await waitFor(() => {
      expect(screen.getByText("second attachment content")).toBeInTheDocument();
    });

    resolveFirst?.({
      ok: true,
      json: async () => ({
        id: "att_first",
        filename: "first.txt",
        mimeType: "text/plain",
        content: "stale attachment content"
      })
    } as Response);

    await waitFor(() => {
      expect(screen.getByText("second attachment content")).toBeInTheDocument();
      expect(screen.queryByText("stale attachment content")).toBeNull();
    });
  });

  it("shows an error state when an image preview fails to load", async () => {
    installMockImage({ fail: true });

    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          content: "See attached",
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
            }
          ]
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview photo.png" }));

    expect(screen.getByText("Loading preview…")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Unable to load attachment preview.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Retry preview" })).toBeInTheDocument();
  });

  it("renders streaming actions before the streaming answer text", () => {
    render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "Here are the results.",
        awaitingFirstToken: false,
        thinkingInProgress: false,
        timeline: [
          {
            ...createToolAction({
              id: "act_done",
              messageId: "msg_streaming",
              serverId: "mcp_exa",
              toolName: "web_search_exa",
              label: "Web search",
              detail: "query=test",
              resultSummary: "Found results"
            }),
            timelineKind: "action",
          }
        ]
      })
    );

    expect(screen.getByText("Web search")).toBeInTheDocument();
    expect(screen.getByText("Here are the results.")).toBeInTheDocument();
  });

  it("renders a stopped badge for interrupted assistant messages", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          status: "stopped",
          content: "Partial answer"
        }
      })
    );

    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Partial answer")).toBeInTheDocument();
  });

  it("renders a compaction separator instead of typing dots while compaction is active", () => {
    const { container } = render(
      React.createElement(StreamingPlaceholder, {
        createdAt: new Date().toISOString(),
        thinking: "",
        answer: "",
        awaitingFirstToken: true,
        thinkingInProgress: false,
        compactionInProgress: true,
        timeline: []
      })
    );

    expect(screen.getByText("Compacting")).toBeInTheDocument();
    expect(container.querySelector(".compaction-indicator")).not.toBeNull();
    expect(container.querySelector(".typing-dot")).toBeNull();
  });
});
