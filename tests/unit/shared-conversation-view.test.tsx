// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedConversationView } from "@/components/shared-conversation-view";
import type { Conversation, Message, MessageAttachment, MessageTimelineItem } from "@/lib/types";

function createConversation(): Conversation {
  return {
    id: "conv_shared",
    title: "Shared UI thread",
    titleGenerationStatus: "completed",
    folderId: null,
    providerProfileId: "profile_default",
    automationId: null,
    automationRunId: null,
    conversationOrigin: "manual",
    sortOrder: 0,
    createdAt: "2026-05-06T12:00:00.000Z",
    updatedAt: "2026-05-06T12:05:00.000Z",
    isActive: false,
    shareEnabled: true,
    shareToken: "share_token_1234567890",
    sharedAt: "2026-05-06T12:06:00.000Z"
  };
}

function createAttachment(): MessageAttachment {
  return {
    id: "att_shared",
    conversationId: "conv_shared",
    messageId: "msg_user",
    filename: "photo.png",
    mimeType: "image/png",
    byteSize: 128,
    sha256: "hash",
    relativePath: "conv_shared/att_shared_photo.png",
    kind: "image",
    extractedText: "",
    createdAt: "2026-05-06T12:01:00.000Z"
  };
}

function createMessages(attachment: MessageAttachment): Message[] {
  const action: Extract<MessageTimelineItem, { timelineKind: "action" }> = {
    id: "act_shared",
    messageId: "msg_assistant",
    timelineKind: "action",
    kind: "mcp_tool_call",
    status: "completed",
    serverId: "browser",
    skillId: null,
    toolName: "screenshot",
    label: "Web browser",
    detail: "Captured screenshot",
    arguments: { url: "http://localhost" },
    resultSummary: "Screenshot captured",
    sortOrder: 1,
    startedAt: "2026-05-06T12:02:00.000Z",
    completedAt: "2026-05-06T12:02:01.000Z",
    proposalState: null,
    proposalPayload: null,
    proposalUpdatedAt: null
  };

  return [
    {
      id: "msg_user",
      conversationId: "conv_shared",
      role: "user",
      content: "what do you see?",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 6,
      systemKind: null,
      compactedAt: null,
      createdAt: "2026-05-06T12:01:00.000Z",
      attachments: [attachment],
      actions: [],
      textSegments: [],
      timeline: []
    },
    {
      id: "msg_assistant",
      conversationId: "conv_shared",
      role: "assistant",
      content: "I inspected it.",
      thinkingContent: "Need to inspect the provided screenshot.",
      status: "completed",
      estimatedTokens: 20,
      systemKind: null,
      compactedAt: null,
      createdAt: "2026-05-06T12:02:00.000Z",
      attachments: [],
      actions: [action],
      textSegments: [],
      timeline: [
        {
          id: "seg_shared",
          timelineKind: "text",
          content: "I inspected it.",
          sortOrder: 0,
          createdAt: "2026-05-06T12:02:00.000Z"
        },
        action
      ]
    }
  ];
}

describe("SharedConversationView", () => {
  beforeEach(() => {
    class TestImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";

      get src() {
        return this._src;
      }

      set src(value: string) {
        this._src = value;
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal("Image", TestImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the shared transcript with the normal chat message UI and public attachment previews", async () => {
    const attachment = createAttachment();
    const { container } = render(
      <SharedConversationView
        conversation={createConversation()}
        messages={createMessages(attachment)}
        shareToken="share_token_1234567890"
      />
    );

    expect(screen.getByRole("link", { name: "Eidon" })).toHaveAttribute(
      "href",
      "https://github.com/Quack6765/Eidon-AI"
    );
    expect(screen.getByRole("link", { name: "Eidon" })).toContainHTML(
      'font-bold leading-none tracking-[0.12em]'
    );
    expect(screen.getByRole("link", { name: "Eidon" })).toContainHTML(
      "linear-gradient(to bottom, #FFFFFF 0%, #D4C8FF 40%, #8b5cf6 100%)"
    );
    expect(screen.getByText("Shared UI thread")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Ask, create, or start a task/i)).not.toBeInTheDocument();
    expect(screen.queryByText("New Chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Search")).not.toBeInTheDocument();
    expect(container.querySelector('img[src="/agent-icon.png"]')).not.toBeNull();
    expect(screen.getByTestId("assistant-thinking-shell")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-actions-shell")).toHaveTextContent("Web browser");

    fireEvent.click(screen.getByRole("button", { name: /Thought/i }));
    expect(await screen.findByText("Need to inspect the provided screenshot.")).toBeInTheDocument();

    const previewButton = screen.getByRole("button", { name: "Preview photo.png" });
    expect(previewButton.querySelector("img")).toHaveAttribute(
      "src",
      "/api/share/share_token_1234567890/attachments/att_shared"
    );

    fireEvent.click(previewButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Attachment preview" })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "Download attachment" })).toHaveAttribute(
      "href",
      "/api/share/share_token_1234567890/attachments/att_shared?download=1"
    );
    expect(screen.queryByRole("button", { name: "Edit message" })).not.toBeInTheDocument();
  });
});
