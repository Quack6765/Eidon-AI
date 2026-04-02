// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChatView } from "@/components/chat-view";
import { storeChatBootstrap } from "@/lib/chat-bootstrap";
import type { MessageAttachment } from "@/lib/types";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    refresh
  })
}));

function createAttachment(overrides: Partial<MessageAttachment> = {}): MessageAttachment {
  return {
    id: "att_1",
    conversationId: "conv_1",
    messageId: null,
    filename: "photo.png",
    mimeType: "image/png",
    byteSize: 128,
    sha256: "hash",
    relativePath: "conv_1/att_1_photo.png",
    kind: "image",
    extractedText: "",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function createPayload() {
  return {
    conversation: {
      id: "conv_1",
      title: "Test conversation",
      titleGenerationStatus: "completed" as const,
      folderId: null,
      providerProfileId: "profile_default",
      toolExecutionMode: "read_only" as const,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: false
    },
    messages: [],
    toolExecutionMode: "read_only" as const,
    providerProfiles: [
      {
        id: "profile_default",
        name: "Default",
        apiBaseUrl: "https://api.example.com/v1",
        model: "gpt-5-mini",
        apiMode: "responses" as const,
        systemPrompt: "Be exact",
        temperature: 0.2,
        maxOutputTokens: 512,
        reasoningEffort: "medium" as const,
        reasoningSummaryEnabled: true,
        modelContextLimit: 16000,
        compactionThreshold: 0.8,
        freshTailCount: 12,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasApiKey: true
      }
    ],
    defaultProviderProfileId: "profile_default",
    debug: {
      rawTurnCount: 0,
      memoryNodeCount: 0,
      latestCompactionAt: null
    }
  };
}

describe("chat view attachments", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    global.fetch = vi.fn();
    vi.useRealTimers();
    window.history.pushState({}, "", "/chat/conv_1");
  });

  it("uploads an attachment from the file input and removes it from the pending list", async () => {
    const attachment = createAttachment();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ attachments: [attachment] })
    } as Response);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true })
    } as Response);

    const { container } = render(React.createElement(ChatView, { payload: createPayload() }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["binary"], "photo.png", { type: "image/png" });

    fireEvent.change(input, {
      target: {
        files: [file]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("photo.png")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove photo.png" }));

    await waitFor(() => {
      expect(screen.queryByText("photo.png")).toBeNull();
    });
  });

  it("focuses the composer textarea when the conversation loads", async () => {
    render(React.createElement(ChatView, { payload: createPayload() }));

    const textarea = screen.getByPlaceholderText(
      "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
    );

    await waitFor(() => {
      expect(textarea).toHaveFocus();
    });
  });

  it("shows a drop overlay and uploads dropped files", async () => {
    const attachment = createAttachment({
      id: "att_2",
      filename: "notes.txt",
      mimeType: "text/plain",
      kind: "text",
      extractedText: "hello"
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ attachments: [attachment] })
    } as Response);

    const { container } = render(React.createElement(ChatView, { payload: createPayload() }));
    const root = container.firstElementChild as HTMLElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    fireEvent.dragEnter(root, {
      dataTransfer: {
        types: ["Files"]
      }
    });

    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();

    fireEvent.drop(root, {
      dataTransfer: {
        files: [file],
        types: ["Files"]
      }
    });

    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeInTheDocument();
    });

    expect(screen.queryByText("Drop files to attach")).toBeNull();
  });

  it("submits a bootstrapped first prompt for a new conversation", async () => {
    const encoder = new TextEncoder();
    storeChatBootstrap("conv_1", {
      message: "Bootstrap prompt",
      attachments: []
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"type":"message_start","messageId":"msg_assistant"}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"type":"answer_delta","text":"Done"}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"type":"done","messageId":"msg_assistant"}\n\n')
          );
          controller.close();
        }
      })
    } as Response);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: createPayload().conversation,
        messages: [
          {
            id: "msg_user",
            conversationId: "conv_1",
            role: "user",
            content: "Bootstrap prompt",
            thinkingContent: "",
            status: "completed",
            estimatedTokens: 0,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString(),
            actions: [],
            attachments: []
          },
          {
            id: "msg_assistant",
            conversationId: "conv_1",
            role: "assistant",
            content: "Done",
            thinkingContent: "",
            status: "completed",
            estimatedTokens: 0,
            systemKind: null,
            compactedAt: null,
            createdAt: new Date().toISOString(),
            actions: [],
            attachments: []
          }
        ],
        debug: createPayload().debug
      })
    } as Response);

    render(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/conversations/conv_1/chat",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/conversations/conv_1");
    });
  });

  it("deletes an empty conversation when navigating away before sending a message", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, deleted: true })
    } as Response);

    const view = render(React.createElement(ChatView, { payload: createPayload() }));

    window.history.pushState({}, "", "/");
    view.unmount();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/conversations/conv_1?onlyIfEmpty=1",
        expect.objectContaining({
          method: "DELETE",
          keepalive: true
        })
      );
    });
  });

  it("keeps an empty conversation when the chat view remounts on the same route", () => {
    const view = render(React.createElement(ChatView, { payload: createPayload() }));

    view.unmount();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("polls for a generated title after the first user turn", async () => {
    const encoder = new TextEncoder();
    storeChatBootstrap("conv_1", {
      message: "Build a deployment checklist",
      attachments: []
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"type":"message_start","messageId":"msg_assistant"}\n\n')
            );
            controller.enqueue(
              encoder.encode('data: {"type":"answer_delta","text":"Done"}\n\n')
            );
            controller.enqueue(
              encoder.encode('data: {"type":"done","messageId":"msg_assistant"}\n\n')
            );
            controller.close();
          }
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: {
            ...createPayload().conversation,
            title: "Conversation",
            titleGenerationStatus: "pending"
          },
          messages: [
            {
              id: "msg_user",
              conversationId: "conv_1",
              role: "user",
              content: "Build a deployment checklist",
              thinkingContent: "",
              status: "completed",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              actions: [],
              attachments: []
            },
            {
              id: "msg_assistant",
              conversationId: "conv_1",
              role: "assistant",
              content: "Done",
              thinkingContent: "",
              status: "completed",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              actions: [],
              attachments: []
            }
          ],
          debug: createPayload().debug
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: {
            ...createPayload().conversation,
            title: "Deployment Checklist",
            titleGenerationStatus: "completed"
          }
        })
      } as Response);

    render(
      React.createElement(ChatView, {
        payload: {
          ...createPayload(),
          conversation: {
            ...createPayload().conversation,
            title: "Conversation",
            titleGenerationStatus: "pending"
          }
        }
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/conversations/conv_1/chat",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    await waitFor(
      () => {
        expect(global.fetch).toHaveBeenCalledWith("/api/conversations/conv_1");
      },
      {
        timeout: 2000
      }
    );

    await waitFor(() => {
      expect(screen.getByText("Deployment Checklist")).toBeInTheDocument();
    });

    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders assistant text and tool actions in chronological order after sync", async () => {
    const encoder = new TextEncoder();
    storeChatBootstrap("conv_1", {
      message: "Check booking availability",
      attachments: []
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"type":"message_start","messageId":"msg_assistant"}\n\n')
            );
            controller.enqueue(
              encoder.encode('data: {"type":"answer_delta","text":"Checking the official site.\\n\\n"}\n\n')
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "action_start",
                  action: {
                    id: "act_1",
                    messageId: "msg_assistant",
                    kind: "mcp_tool_call",
                    status: "running",
                    serverId: "exa",
                    skillId: null,
                    toolName: "web_search_exa",
                    label: "web_search_exa",
                    detail: "query=booking",
                    arguments: { query: "booking" },
                    resultSummary: "",
                    sortOrder: 1,
                    startedAt: new Date().toISOString(),
                    completedAt: null
                  }
                })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "action_complete",
                  action: {
                    id: "act_1",
                    messageId: "msg_assistant",
                    kind: "mcp_tool_call",
                    status: "completed",
                    serverId: "exa",
                    skillId: null,
                    toolName: "web_search_exa",
                    label: "web_search_exa",
                    detail: "query=booking",
                    arguments: { query: "booking" },
                    resultSummary: "Found official site",
                    sortOrder: 1,
                    startedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString()
                  }
                })}\n\n`
              )
            );
            controller.enqueue(
              encoder.encode('data: {"type":"answer_delta","text":"The first available slot is Saturday at 9:00 AM."}\n\n')
            );
            controller.enqueue(
              encoder.encode('data: {"type":"done","messageId":"msg_assistant"}\n\n')
            );
            controller.close();
          }
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: createPayload().conversation,
          messages: [
            {
              id: "msg_user",
              conversationId: "conv_1",
              role: "user",
              content: "Check booking availability",
              thinkingContent: "",
              status: "completed",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              actions: [],
              attachments: []
            },
            {
              id: "msg_assistant",
              conversationId: "conv_1",
              role: "assistant",
              content: "Checking the official site.\n\nThe first available slot is Saturday at 9:00 AM.",
              thinkingContent: "",
              status: "completed",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              actions: [
                {
                  id: "act_1",
                  messageId: "msg_assistant",
                  kind: "mcp_tool_call",
                  status: "completed",
                  serverId: "exa",
                  skillId: null,
                  toolName: "web_search_exa",
                  label: "web_search_exa",
                  detail: "query=booking",
                  arguments: { query: "booking" },
                  resultSummary: "Found official site",
                  sortOrder: 1,
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString()
                }
              ],
              textSegments: [
                {
                  id: "seg_1",
                  messageId: "msg_assistant",
                  content: "Checking the official site.\n\n",
                  sortOrder: 0,
                  createdAt: new Date().toISOString()
                },
                {
                  id: "seg_2",
                  messageId: "msg_assistant",
                  content: "The first available slot is Saturday at 9:00 AM.",
                  sortOrder: 2,
                  createdAt: new Date().toISOString()
                }
              ],
              timeline: [
                {
                  id: "seg_1",
                  timelineKind: "text",
                  content: "Checking the official site.\n\n",
                  sortOrder: 0,
                  createdAt: new Date().toISOString()
                },
                {
                  id: "act_1",
                  timelineKind: "action",
                  kind: "mcp_tool_call",
                  messageId: "msg_assistant",
                  status: "completed",
                  serverId: "exa",
                  skillId: null,
                  toolName: "web_search_exa",
                  label: "web_search_exa",
                  detail: "query=booking",
                  arguments: { query: "booking" },
                  resultSummary: "Found official site",
                  sortOrder: 1,
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString()
                },
                {
                  id: "seg_2",
                  timelineKind: "text",
                  content: "The first available slot is Saturday at 9:00 AM.",
                  sortOrder: 2,
                  createdAt: new Date().toISOString()
                }
              ],
              attachments: []
            }
          ],
          debug: createPayload().debug
        })
      } as Response);

    const { container } = render(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/conversations/conv_1");
    });

    const blocks = Array.from(
      container.querySelectorAll('[data-testid="assistant-message-bubble"], [data-testid="assistant-actions-shell"]')
    );

    expect(blocks[0]?.textContent).toContain("Checking the official site.");
    expect(blocks[1]?.textContent).toContain("web_search_exa");
    expect(blocks[2]?.textContent).toContain("The first available slot is Saturday at 9:00 AM.");
  });

  it("keeps the streaming assistant row mounted when sync finishes", async () => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();

    storeChatBootstrap("conv_1", {
      message: "Bootstrap prompt",
      attachments: []
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controllerRef = controller;
          }
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: createPayload().conversation,
          messages: [
            {
              id: "msg_user",
              conversationId: "conv_1",
              role: "user",
              content: "Bootstrap prompt",
              thinkingContent: "",
              status: "completed",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              actions: [],
              attachments: []
            },
            {
              id: "msg_assistant",
              conversationId: "conv_1",
              role: "assistant",
              content: "Done",
              thinkingContent: "",
              status: "completed",
              estimatedTokens: 0,
              systemKind: null,
              compactedAt: null,
              createdAt: new Date().toISOString(),
              actions: [],
              attachments: []
            }
          ],
          debug: createPayload().debug
        })
      } as Response);

    const { container } = render(React.createElement(ChatView, { payload: createPayload() }));

    await waitFor(() => {
      expect(controllerRef).not.toBeNull();
    });

    await waitFor(() => {
      expect(container.querySelectorAll(".animate-slide-up")).toHaveLength(2);
    });

    const assistantWrapper = Array.from(container.querySelectorAll(".animate-slide-up")).at(-1);
    const controller = controllerRef;

    expect(controller).toBeDefined();

    controller?.enqueue(
      encoder.encode('data: {"type":"message_start","messageId":"msg_assistant"}\n\n')
    );
    controller?.enqueue(
      encoder.encode('data: {"type":"answer_delta","text":"Done"}\n\n')
    );
    controller?.enqueue(
      encoder.encode('data: {"type":"done","messageId":"msg_assistant"}\n\n')
    );
    controller?.close();

    await waitFor(() => {
      expect(screen.getByText("Done")).toBeInTheDocument();
    });

    const wrappersAfterSync = Array.from(container.querySelectorAll(".animate-slide-up"));
    expect(wrappersAfterSync).toHaveLength(2);
    expect(wrappersAfterSync.at(-1)).toBe(assistantWrapper);
  });
});
