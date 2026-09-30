// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MessageBubble, parseDelegationWakeMessage } from "@/components/message-bubble";
import { ingestBotsPayload, resetDelegationStatusForTests } from "@/hooks/use-delegation-status";
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

  it("centers a failed assistant message instead of anchoring it to the left", () => {
    render(
      React.createElement(MessageBubble, {
        message: { ...createAssistantMessage(), status: "error", content: "401 Incorrect API key provided." }
      })
    );

    const bubble = screen.getByTestId("assistant-error-bubble");
    expect(bubble).toHaveTextContent("401 Incorrect API key provided.");
    expect(bubble.className).toContain("text-center");
    expect(bubble.parentElement?.className).toContain("items-center");
    expect(bubble.parentElement?.parentElement?.className).toContain("items-center");
  });

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

  it("shows live progress under a pending message_bot line and highlights stalls", () => {
    const startedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    ingestBotsPayload({
      bots: [
        {
          id: "bot_inbox",
          name: "Inbox Bot",
          title: "",
          description: "",
          avatarSeed: "seed",
          isChief: false,
          homeConversationId: "conv_inbox",
          providerProfileId: null,
          status: "running",
          waitingForInput: false,
          unread: false,
          lastRunAt: startedAt,
          createdAt: startedAt,
          updatedAt: startedAt
        }
      ],
      runs: [
        {
          id: "run_inbox",
          botId: "bot_inbox",
          conversationId: "conv_inbox",
          triggerSource: "delegated",
          status: "running",
          startedAt,
          finishedAt: null,
          parentMessageId: "msg_assistant",
          requestedByBotId: null,
          errorMessage: null,
          createdAt: startedAt
        }
      ],
      activities: {
        conv_inbox: {
          startedAt,
          lastActivityAt: new Date(Date.now() - 4 * 60_000).toISOString(),
          currentAction: null,
          stalled: true
        }
      }
    });

    try {
      render(
        React.createElement(MessageBubble, {
          message: createTimelineMessage([
            {
              id: "action_delegate_live",
              kind: "message_bot",
              status: "pending",
              label: "Messaged Inbox Bot",
              detail: "→ Inbox Bot: Triage the inbox"
            }
          ])
        })
      );

      const status = screen.getByTestId("delegate-action-status");
      expect(status).toHaveTextContent("working 6m · no activity for 4m");
      expect(status.className).toContain("text-amber-300/80");
    } finally {
      resetDelegationStatusForTests();
    }
  });

  it("shows no progress line for a pending message_bot action with no known run", () => {
    render(
      React.createElement(MessageBubble, {
        message: createTimelineMessage([
          {
            id: "action_delegate_unknown",
            kind: "message_bot",
            status: "pending",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox"
          }
        ])
      })
    );

    expect(screen.queryByTestId("delegate-action-status")).toBeNull();
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
    kind: "message_bot" | "delegate_task" | "create_bot" | "update_bot";
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
        toolName:
          action.kind === "delegate_task" || action.kind === "message_bot" ? action.kind : null,
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

  it("renders an errored delegation neutrally because the reply chip carries the failure", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_error",
            kind: "message_bot",
            status: "error",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox",
            arguments: { bot: "Inbox Bot", message: "Triage the inbox" }
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    expect(line.dataset.actionStatus).toBe("error");
    expect(line.querySelector('[class*="text-red-300"]')).toBeNull();
    expect(line.querySelector(".text-red-400")).toBeNull();
    expect(line.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps the red treatment on a delegation the user stopped", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_stopped",
            kind: "message_bot",
            status: "stopped",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox",
            arguments: { bot: "Inbox Bot", message: "Triage the inbox" },
            resultSummary: "Stopped by you before it finished."
          }
        ])
      })
    );

    const line = screen.getByTestId("delegate-action-line");
    expect(line.dataset.actionStatus).toBe("stopped");
    expect(line.querySelector('[class*="text-red-300"]')).not.toBeNull();
    expect(line.querySelector(".text-red-400")).not.toBeNull();
    expect(line).toHaveTextContent("Messaged Inbox Bot");
  });

  it("toggles the message that was sent from the delegation event line", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_summary",
            kind: "message_bot",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox",
            arguments: { bot: "Inbox Bot", message: "Triage the inbox and flag anything urgent" },
            resultSummary: "Triaged 12 emails and filed 3 replies."
          }
        ])
      })
    );

    const toggle = screen.getByRole("button", { name: /Messaged Inbox Bot/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Triage the inbox and flag anything urgent")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Triage the inbox and flag anything urgent")).toBeInTheDocument();
    expect(screen.queryByText("Triaged 12 emails and filed 3 replies.")).toBeNull();
  });

  it("expands a still-running delegation to show the message that was sent", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_pending_sent",
            kind: "message_bot",
            status: "pending",
            label: "Messaged Inbox Bot",
            detail: "",
            arguments: { bot: "Inbox Bot", message: "Summarise yesterday's replies." }
          }
        ])
      })
    );

    const toggle = screen.getByRole("button", { name: /Messaged Inbox Bot/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByText("Summarise yesterday's replies.")).toBeInTheDocument();
  });

  it("expands a legacy delegate_task row through its task_prompt argument", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_legacy",
            kind: "delegate_task",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "",
            arguments: { task_prompt: "Triage the inbox." }
          }
        ])
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Messaged Inbox Bot/ }));

    expect(screen.getByText("Triage the inbox.")).toBeInTheDocument();
  });

  it("falls back to the detail line when no argument carries the sent message", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_detail_fallback",
            kind: "message_bot",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Tell a joke"
          }
        ])
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Messaged Inbox Bot/ }));

    expect(screen.getByText("Tell a joke")).toBeInTheDocument();
  });

  it("lets a failed delegate line expand to the sent message", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_delegate_failed_reason",
            kind: "message_bot",
            status: "error",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Tell a joke",
            arguments: { bot: "Inbox Bot", message: "Tell a joke." },
            resultSummary: "The bot run failed: 401 Incorrect API key provided."
          }
        ])
      })
    );

    const toggle = screen.getByRole("button", { name: /Messaged Inbox Bot/ });
    expect(screen.queryByText("The bot run failed: 401 Incorrect API key provided.")).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByText("Tell a joke.")).toBeInTheDocument();
    expect(screen.getByTestId("delegate-action-line").dataset.actionStatus).toBe("error");
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
    const avatar = line.querySelector("[data-inline-avatar] img");
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("src")).toBe("/api/avatars/inbox-seed.svg");
    expect(line.querySelector("[data-inline-avatar]")?.className).toContain("ml-1.5 mr-1.5");
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

  it("renders delegated bot replies as a collapsed disclosure of the received message", async () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_wake",
          content:
            "[Message from Research Bot]\nHere is the relayed answer with **bold** text.\n---\n(Automated delivery: this is the reply from the bot you messaged earlier with message_bot. Process it silently.)"
        }
      })
    );

    const wake = screen.getByTestId("delegation-wake-message");
    expect(wake).toHaveTextContent("Message from Research Bot");
    expect(wake).not.toHaveTextContent("Here is the relayed answer");

    const toggle = screen.getByRole("button", { name: /Message from Research Bot/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(wake.querySelector('[class*="text-white/35"]')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(wake).toHaveTextContent("Here is the relayed answer with **bold** text.");
    expect(wake).not.toHaveTextContent("Automated delivery");
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate response" })).toBeNull();
    expect(container.querySelector(".rounded-2xl")).toBeNull();
    expect(wake.querySelector(".markdown-body")).toBeNull();

    await waitFor(() => {
      expect(wake.querySelector("[data-inline-avatar]")).not.toBeNull();
    });
    const avatar = wake.querySelector("[data-inline-avatar] img");
    expect(avatar).not.toBeNull();
    expect(avatar?.getAttribute("src")).toBe("/api/avatars/research-seed.svg");
  });

  it("expands a chief-to-worker marker to the message the bot received", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_wake_chief",
          content: "[Message from Chief of Staff]\nReview the Q3 revenue model, please."
        }
      })
    );

    const toggle = screen.getByRole("button", { name: /Message from Chief of Staff/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByTestId("delegation-wake-message")).toHaveTextContent(
      "Review the Q3 revenue model, please."
    );
  });

  it("tints a failed delegation reply in red when expanded", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_wake_failed",
          content: "[Message from Research Bot]\nThe task failed: 401 Incorrect API key provided."
        }
      })
    );

    const wake = screen.getByTestId("delegation-wake-message");
    fireEvent.click(screen.getByRole("button", { name: /Message from Research Bot/ }));

    expect(wake.querySelector('[class*="text-red-300/60"]')).not.toBeNull();
    expect(wake).toHaveTextContent("The task failed: 401 Incorrect API key provided.");
  });

  it("keeps a paired reply chip styled identically to an unpaired one", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_wake_linked",
          content: "[Message from Research Bot]\nThe answer."
        },
        delegationReplies: {
          links: new Map([["msg_wake_linked", { actionId: "action_1", parentMessageId: "msg_assistant" }]]),
          repliedActionIds: new Set(["action_1"])
        }
      })
    );

    const wake = screen.getByTestId("delegation-wake-message");
    expect(wake.dataset.replyToActionId).toBe("action_1");
    expect(wake.className).toBe("flex w-full min-w-0 flex-col items-stretch gap-2");
    expect(wake.querySelector(".justify-center")).not.toBeNull();
    expect(wake.querySelector(".justify-start")).toBeNull();
  });

  it("leaves an unmatched reply chip rendered as the same centered line", () => {
    render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_wake_unlinked",
          content: "[Message from Research Bot]\nThe answer."
        }
      })
    );

    const wake = screen.getByTestId("delegation-wake-message");
    expect(wake.dataset.replyToActionId).toBeUndefined();
    expect(wake.className).toBe("flex w-full min-w-0 flex-col items-stretch gap-2");
    expect(wake.querySelector(".justify-center")).not.toBeNull();
    expect(wake).toHaveTextContent("Message from Research Bot");
  });

  it("marks a delegation line that has been answered", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_answered",
            kind: "message_bot",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox",
            arguments: { bot: "Inbox Bot", message: "Triage the inbox" }
          }
        ]),
        delegationReplies: {
          links: new Map([["msg_wake", { actionId: "action_answered", parentMessageId: "msg_assistant" }]]),
          repliedActionIds: new Set(["action_answered"])
        }
      })
    );

    expect(screen.getByTestId("delegate-action-line").dataset.replied).toBe("true");
  });

  it("leaves an unanswered delegation line unmarked", () => {
    render(
      React.createElement(MessageBubble, {
        message: createDelegationMessage([
          {
            id: "action_unanswered",
            kind: "message_bot",
            status: "completed",
            label: "Messaged Inbox Bot",
            detail: "→ Inbox Bot: Triage the inbox",
            arguments: { bot: "Inbox Bot", message: "Triage the inbox" }
          }
        ]),
        delegationReplies: {
          links: new Map(),
          repliedActionIds: new Set()
        }
      })
    );

    expect(screen.getByTestId("delegate-action-line").dataset.replied).toBeUndefined();
  });

  it("renders a restart resume notice as a marker without the automated instructions", () => {
    const { container } = render(
      React.createElement(MessageBubble, {
        message: {
          ...createUserMessage(),
          id: "msg_resume",
          content: "[Resumed after a server restart]\nContinue from where you left off instead of starting over."
        }
      })
    );

    const marker = screen.getByTestId("restart-resume-message");
    expect(marker).toHaveTextContent("Resumed after a server restart");
    expect(marker).not.toHaveTextContent("Continue from where you left off");
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(container.querySelector(".rounded-2xl")).toBeNull();
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
      content: "Answer",
      failed: false
    });
    expect(parseDelegationWakeMessage("[Message from Research Bot]")).toEqual({
      botName: "Research Bot",
      content: "",
      failed: false
    });
    expect(parseDelegationWakeMessage("Hello [Message from Research Bot]\nAnswer")).toBeNull();
    expect(parseDelegationWakeMessage("[Message from ]\nAnswer")).toBeNull();
  });
});

describe("MessageBubble reference tokens", () => {
  it("tints known @bot and /skill tokens in user messages but leaves code alone", () => {
    const message = {
      ...createUserMessage(),
      content: "Ask @Chief of Staff to run /daily-report, not `/daily-report` or @Nobody."
    };
    const { container } = render(
      <MessageBubble
        message={message}
        referenceCandidates={[
          { trigger: "@", name: "Chief of Staff" },
          { trigger: "/", name: "daily-report" }
        ]}
      />
    );

    const marks = Array.from(container.querySelectorAll("[data-reference-kind]"));
    expect(marks.map((mark) => [mark.getAttribute("data-reference-kind"), mark.textContent])).toEqual([
      ["bot", "@Chief of Staff"],
      ["skill", "/daily-report"]
    ]);
    expect(container.querySelector("code")).toHaveTextContent("/daily-report");
  });

  it("tints tokens once references arrive after the first render", () => {
    const message = { ...createUserMessage(), content: "Ask @Writer now" };
    const { container, rerender } = render(<MessageBubble message={message} referenceCandidates={[]} />);

    expect(container.querySelector("[data-reference-kind]")).toBeNull();
    rerender(<MessageBubble message={message} referenceCandidates={[{ trigger: "@", name: "Writer" }]} />);

    expect(container.querySelector("[data-reference-kind='bot']")).toHaveTextContent("@Writer");
  });

  it("renders plain text when no references are known", () => {
    const message = { ...createUserMessage(), content: "Ask @Chief of Staff" };
    const { container } = render(<MessageBubble message={message} />);

    expect(container.querySelector("[data-reference-kind]")).toBeNull();
    expect(container).toHaveTextContent("Ask @Chief of Staff");
  });
});

describe("message bubble drafts", () => {
  function createDraftMessage(): Message {
    return {
      ...createAssistantMessage(),
      content: "Here is the draft for Sarah.",
      actions: [
        {
          id: "act_draft",
          messageId: "msg_assistant",
          kind: "draft_message",
          status: "pending",
          serverId: "mcp_gmail",
          skillId: null,
          toolName: "draft_message",
          label: "Message draft for Gmail",
          detail: "",
          arguments: null,
          resultSummary: "",
          sortOrder: 0,
          startedAt: new Date().toISOString(),
          completedAt: null,
          proposalState: "pending",
          proposalPayload: {
            operation: "message_draft",
            mcpServerId: "mcp_gmail",
            mcpServerName: "Gmail",
            mcpToolName: "send_email",
            toolLabel: "Send email",
            arguments: { subject: "Q3 recap", body: "Hi Sarah" },
            fields: [
              { key: "subject", label: "Subject", format: "text", required: true },
              { key: "body", label: "Body", format: "multiline", required: true }
            ]
          },
          proposalUpdatedAt: null
        }
      ]
    };
  }

  it("renders a pending draft card after the reply and sends through the bubble handler", async () => {
    const onSendMessageDraft = vi.fn().mockResolvedValue(undefined);
    render(
      React.createElement(MessageBubble, {
        message: createDraftMessage(),
        onSendMessageDraft,
        toolCallDisplay: "status_line"
      })
    );

    const card = screen.getByTestId("message-draft-card");
    expect(screen.getByTestId("assistant-message-content")).toHaveTextContent("Here is the draft for Sarah.");
    expect(card).toHaveTextContent("Ready to send");
    expect(card).toHaveTextContent("Q3 recap");
    expect(screen.queryByText(/1 tool/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onSendMessageDraft).toHaveBeenCalledWith("act_draft", undefined));
  });

  it("hides the draft card while the reply is still streaming", () => {
    const message = { ...createDraftMessage(), status: "streaming" as const };
    render(
      React.createElement(MessageBubble, {
        message,
        streamingTimeline: message.actions!.map((action) => ({ ...action, timelineKind: "action" as const })),
        streamingAnswer: ""
      })
    );

    expect(screen.queryByTestId("message-draft-card")).not.toBeInTheDocument();
  });
});
