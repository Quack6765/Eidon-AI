// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageBubble, parseDelegationWakeMessage } from "@/components/message-bubble";
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
  it("renders assistant prose without an avatar or chat bubble frame", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createAssistantMessage()
      })
    );

    const assistantContent = screen.getByTestId("assistant-message-content");

    expect(container.querySelector('img[src="/agent-icon.png"]')).toBeNull();
    expect(container.querySelector('img[src="/chat-icon.png"]')).toBeNull();
    expect(container.querySelector('[data-testid="assistant-message-bubble"]')).toBeNull();
    expect(assistantContent).toHaveTextContent("Final answer");
    expect(assistantContent.className).toContain("w-full");
    expect(assistantContent.className).not.toContain("rounded-2xl");
    expect(assistantContent.className).not.toContain("bg-white");
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

  it("uses a 4px gap between user text and attachments", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          attachments: [
            {
              id: "att_image",
              conversationId: "conv_test",
              messageId: "msg_user",
              filename: "screenshot.png",
              mimeType: "image/png",
              byteSize: 10,
              sha256: "hash-image",
              relativePath: "conv_test/att_image_screenshot.png",
              kind: "image",
              extractedText: "",
              createdAt: new Date().toISOString()
            }
          ]
        }
      })
    );

    const previewButton = screen.getByRole("button", { name: "Preview screenshot.png" });
    const attachmentWrapper = previewButton.parentElement?.parentElement?.parentElement;

    expect(attachmentWrapper).not.toHaveClass("mt-3");
    expect(attachmentWrapper?.parentElement).toHaveClass("gap-1");
  });

  it("renders buffered streaming text without a second word animation queue", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createAssistantMessage(),
          content: "",
          status: "streaming"
        },
        streamingTimeline: [],
        streamingAnswer: "The paragraph appears progressively from its first character."
      })
    );

    expect(screen.getByTestId("assistant-message-content")).toHaveTextContent(
      "The paragraph appears progressively from its first character."
    );
    expect(container.querySelector("[data-sd-animate]")).toBeNull();
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

describe("message bubble bot action cards", () => {
  function createTimelineMessage(
    actions: Array<{
      id: string;
      kind: "delegate_task" | "create_bot" | "update_bot";
      status: "running" | "completed" | "error";
      label: string;
      detail: string;
    }>
  ): Message {
    return {
      ...createAssistantMessage(),
      content: "",
      timeline: actions.map((action, index) => ({
        id: action.id,
        messageId: "msg_assistant",
        timelineKind: "action" as const,
        kind: action.kind,
        status: action.status,
        serverId: null,
        skillId: null,
        toolName: null,
        label: action.label,
        detail: action.detail,
        arguments: null,
        resultSummary: "",
        sortOrder: index,
        startedAt: new Date().toISOString(),
        completedAt: action.status === "running" ? null : new Date().toISOString(),
        proposalState: null,
        proposalPayload: null,
        proposalUpdatedAt: null
      }))
    };
  }

  it("renders a running delegate_task action as a centered static muted line", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_delegate",
            kind: "delegate_task",
            status: "running",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox"
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    expect(line).toHaveTextContent("Messaged Inbox Bot");
    expect(line.dataset.actionStatus).toBe("running");
    expect(line.querySelector(".animate-spin")).toBeNull();
    expect(container.querySelector('[data-testid="assistant-actions-shell"]')).toBeNull();
  });

  it("renders a completed delegate_task action as a muted line while other actions stay cards", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_delegate_done",
            kind: "delegate_task",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox"
          },
          {
            id: "action_create_bot",
            kind: "create_bot",
            status: "completed",
            label: "Create bot",
            detail: "Research Bot"
          }
        ])
      })
    );

    expect(screen.getByTestId("delegate-action-line")).toHaveTextContent("Messaged Inbox Bot");
    expect(screen.getByText("Create bot")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="assistant-actions-shell"]')).toHaveLength(1);
  });

  it("renders a failed create_bot action with error styling", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_create_bot_error",
            kind: "create_bot",
            status: "error",
            label: "Create bot",
            detail: "Research Bot"
          }
        ])
      })
    );

    expect(screen.getByText("Create bot")).toBeInTheDocument();
    const shell = container.querySelector('[data-testid="assistant-actions-shell"]');
    expect(shell?.querySelector(".text-red-400")).not.toBeNull();
  });

  it("renders a running update_bot action with the edit icon", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_update_bot",
            kind: "update_bot",
            status: "running",
            label: "Rename Scout to Lookout",
            detail: "Lookout"
          }
        ])
      })
    );

    expect(screen.getByText("Rename Scout to Lookout")).toBeInTheDocument();
    const shell = container.querySelector('[data-testid="assistant-actions-shell"]');
    expect(shell).toHaveTextContent("Rename Scout to Lookout");
    expect(shell?.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders a completed update_bot action with the amber kind icon", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_update_bot_done",
            kind: "update_bot",
            status: "completed",
            label: "Update Scout",
            detail: "Lookout"
          }
        ])
      })
    );

    expect(screen.getByText("Update Scout")).toBeInTheDocument();
    const shell = container.querySelector('[data-testid="assistant-actions-shell"]');
    expect(shell?.querySelector(".text-amber-300")).not.toBeNull();
  });

  it("renders a failed update_bot action with error styling", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_update_bot_error",
            kind: "update_bot",
            status: "error",
            label: "Update Scout",
            detail: "Lookout"
          }
        ])
      })
    );

    expect(screen.getByText("Update Scout")).toBeInTheDocument();
    const shell = container.querySelector('[data-testid="assistant-actions-shell"]');
    expect(shell?.querySelector(".text-red-400")).not.toBeNull();
  });
});

describe("delegation event lines", () => {
  type TimelineAction = {
    id: string;
    kind: "delegate_task" | "create_bot" | "update_bot";
    status: "running" | "pending" | "completed" | "error" | "stopped";
    label: string;
    detail: string;
    resultSummary?: string;
    arguments?: Record<string, unknown> | null;
  };

  function createDelegationMessage(actions: TimelineAction[]): Message {
    return {
      ...createAssistantMessage(),
      content: "",
      timeline: actions.map((action, index) => ({
        id: action.id,
        messageId: "msg_assistant",
        timelineKind: "action" as const,
        kind: action.kind,
        status: action.status,
        serverId: null,
        skillId: null,
        toolName: action.kind === "delegate_task" ? "delegate_task" : null,
        label: action.label,
        detail: action.detail,
        arguments: action.arguments ?? null,
        resultSummary: action.resultSummary ?? "",
        sortOrder: index,
        startedAt: new Date().toISOString(),
        completedAt: action.status === "running" || action.status === "pending" ? null : new Date().toISOString(),
        proposalState: null,
        proposalPayload: null,
        proposalUpdatedAt: null
      }))
    };
  }

  beforeAll(() => {
    global.fetch = vi.fn(async (input: unknown) => {
      if (String(input).includes("/api/bots")) {
        return {
          ok: true,
          json: async () => ({
            bots: [
              { id: "bot_inbox", name: "Inbox Bot", avatarSeed: "inbox-seed" },
              { id: "bot_research", name: "Research Bot", avatarSeed: "research-seed" }
            ]
          })
        };
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }) as unknown as typeof fetch;
  });

  it("renders a pending delegate_task action as a static line without a spinner", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_pending",
            kind: "delegate_task",
            status: "pending",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox"
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    expect(line).toHaveTextContent("Messaged Inbox Bot");
    expect(line.querySelector(".animate-spin")).toBeNull();
  });

  it("renders a failed delegate_task action with the error tint and icon", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_error",
            kind: "delegate_task",
            status: "error",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox"
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    const lineText = line.querySelector("span");
    expect(lineText?.className).toContain("text-red-300/70");
    expect(line.querySelector(".text-red-400")).not.toBeNull();
    expect(line.querySelector(".animate-spin")).toBeNull();
  });

  it("toggles the completed delegate_task result summary from the event line", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_summary",
            kind: "delegate_task",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox",
            resultSummary: "Triaged 12 emails and filed 3 replies."
          }
        ])
      })
    );

    const toggle = screen.getByRole("button", { name: /Messaged Inbox Bot/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Triaged 12 emails and filed 3 replies.")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Triaged 12 emails and filed 3 replies.")).toBeInTheDocument();
  });

  it("renders the roster avatar inline on the delegate event line", async () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_avatar",
            kind: "delegate_task",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox"
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    await waitFor(() => {
      expect(line.querySelector("[data-inline-avatar]")).not.toBeNull();
    });
    expect(line.querySelector("[data-inline-avatar] svg rect")).not.toBeNull();
    expect(line.querySelector("[data-inline-avatar]")?.className).toContain("mr-2");
    expect(line).toHaveTextContent("Messaged Inbox Bot");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("falls back to a muted bot glyph when the name is not in the roster", async () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_ghost",
            kind: "delegate_task",
            status: "completed",
            label: "Messaged Ghost Bot",
            detail: "→ Ghost Bot: Vanish"
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    await waitFor(() => {
      expect(line.querySelector("[data-inline-avatar]")).toBeNull();
    });
    expect(line.querySelector("svg path")).not.toBeNull();
    expect(line).toHaveTextContent("Messaged Ghost Bot");
  });

  it("renders delegated bot replies as an arrival indicator without the message content", async () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_wake",
          content: "[Message from Research Bot]\nHere is the relayed answer with **bold** text."
        }
      })
    );

    const wake = screen.getByTestId("delegation-wake-message");
    expect(wake).toHaveTextContent("Message from Research Bot");
    expect(wake).not.toHaveTextContent("Here is the relayed answer");
    await waitFor(() => {
      expect(wake.querySelector("[data-inline-avatar]")).not.toBeNull();
    });
    expect(wake.querySelector("[data-inline-avatar] svg rect")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
    expect(container.querySelector(".rounded-2xl")).toBeNull();
    expect(wake.querySelector(".markdown-body")).toBeNull();
  });

  it("keeps normal user messages as bubbles when the marker pattern does not match", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_plain",
          content: "[Message from Research Bot] without a closing bracket on the first line"
        }
      })
    );

    expect(screen.queryByTestId("delegation-wake-message")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit message" })).toBeInTheDocument();
  });

  it("only treats a leading bracketed first line as a delegation wake marker", () => {
    expect(parseDelegationWakeMessage("[Message from Research Bot]\nAnswer")).toEqual({
      botName: "Research Bot",
      content: "Answer"
    });
    expect(parseDelegationWakeMessage("[Message from Research Bot]")).toEqual({
      botName: "Research Bot",
      content: ""
    });
    expect(parseDelegationWakeMessage("Hello [Message from Research Bot]\nAnswer")).toBeNull();
    expect(parseDelegationWakeMessage("[Message from ]\nAnswer")).toBeNull();
  });
});
