// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { highlightMatch, Sidebar } from "@/components/sidebar";
import type { Conversation, ConversationListPage } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/conversation-1",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

const conversationPage: ConversationListPage = {
  conversations: [
    {
      id: "conversation-1",
      title: "Mobile drawer layout",
      titleGenerationStatus: "completed",
      folderId: null,
      providerProfileId: null,
      automationId: null,
      automationRunId: null,
      conversationOrigin: "manual",
      sortOrder: 0,
      createdAt: "2026-05-07T12:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
      isActive: false,
      shareEnabled: false,
      shareToken: null,
      sharedAt: null,
      isTemporary: false
    }
  ],
  hasMore: false,
  nextCursor: null
};

describe("highlightMatch", () => {
  it("escapes raw html while preserving highlighted search text", () => {
    const result = highlightMatch('<img src=x onerror="alert(1)"> silver moon', "silver moon");

    expect(result).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(result).toContain('<mark class="bg-[var(--accent)]/30 text-white rounded px-0.5">silver moon</mark>');
    expect(result).not.toContain("<img");
    expect(result).not.toContain('onerror="alert(1)"');
  });
});

function buildConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conversation-1",
    title: "Mobile drawer layout",
    titleGenerationStatus: "completed",
    folderId: null,
    providerProfileId: null,
    automationId: null,
    automationRunId: null,
    conversationOrigin: "manual",
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00.000Z",
    updatedAt: "2026-05-07T12:00:00.000Z",
    isActive: false,
    shareEnabled: false,
    shareToken: null,
    sharedAt: null,
    isTemporary: false,
    ...overrides
  };
}

function getIconForConversation(title: string) {
  const link = screen.getByText(title).closest("a");
  return link?.querySelector("svg");
}

describe("Sidebar conversation row spinner", () => {
  it("does not show a spinner for a freshly-created conversation with pending title generation", () => {
    const page: ConversationListPage = {
      conversations: [
        buildConversation({
          id: "conv-pending",
          title: "Conversation",
          titleGenerationStatus: "pending",
          isActive: false
        })
      ],
      hasMore: false,
      nextCursor: null
    };

    render(<Sidebar conversationPage={page} folders={[]} />);

    const icon = getIconForConversation("Conversation");
    expect(icon).not.toHaveClass("animate-spin");
  });

  it("shows a spinner when title generation is running", () => {
    const page: ConversationListPage = {
      conversations: [
        buildConversation({
          id: "conv-running",
          title: "Conversation",
          titleGenerationStatus: "running",
          isActive: false
        })
      ],
      hasMore: false,
      nextCursor: null
    };

    render(<Sidebar conversationPage={page} folders={[]} />);

    const icon = getIconForConversation("Conversation");
    expect(icon).toHaveClass("animate-spin");
  });

  it("shows a spinner when the conversation is active (agent working)", () => {
    const page: ConversationListPage = {
      conversations: [
        buildConversation({
          id: "conv-active",
          title: "Working conversation",
          titleGenerationStatus: "completed",
          isActive: true
        })
      ],
      hasMore: false,
      nextCursor: null
    };

    render(<Sidebar conversationPage={page} folders={[]} />);

    const icon = getIconForConversation("Working conversation");
    expect(icon).toHaveClass("animate-spin");
  });

  it("does not show a spinner for an idle completed conversation", () => {
    const page: ConversationListPage = {
      conversations: [
        buildConversation({
          id: "conv-idle",
          title: "Mobile drawer layout",
          titleGenerationStatus: "completed",
          isActive: false
        })
      ],
      hasMore: false,
      nextCursor: null
    };

    render(<Sidebar conversationPage={page} folders={[]} />);

    const icon = getIconForConversation("Mobile drawer layout");
    expect(icon).not.toHaveClass("animate-spin");
  });
});

describe("Sidebar", () => {
  it("keeps the footer outside a min-height scroll region in the mobile drawer", () => {
    const { container } = render(<Sidebar conversationPage={conversationPage} folders={[]} />);

    const sidebar = container.querySelector("aside");
    const innerColumn = sidebar?.firstElementChild;
    const scrollRegion = screen.getByText("Mobile drawer layout").closest(".overflow-y-auto");
    const automationsLink = screen.getByRole("link", { name: /automations/i });
    const settingsLink = screen.getByRole("link", { name: /settings/i });
    const footerWrapper = automationsLink.parentElement?.parentElement;

    expect(sidebar).toHaveClass("h-full");
    expect(innerColumn).toHaveClass("min-h-0");
    expect(scrollRegion).toHaveClass("flex-1");
    expect(scrollRegion).toHaveClass("min-h-0");
    expect(scrollRegion).toHaveClass("overflow-y-auto");
    expect(scrollRegion).toContainElement(screen.getByText("Mobile drawer layout"));
    expect(scrollRegion).not.toContainElement(automationsLink);
    expect(scrollRegion).not.toContainElement(settingsLink);
    expect(footerWrapper).toHaveClass("shrink-0");
  });
});
