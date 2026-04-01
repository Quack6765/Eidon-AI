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
      folderId: null,
      providerProfileId: "profile_default",
      toolExecutionMode: "read_only" as const,
      sortOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
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
            encoder.encode('data: {"type":"answer_delta","text":"Done"}\n\n')
          );
          controller.close();
        }
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
  });
});
