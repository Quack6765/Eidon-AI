// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "@/components/shell";
import type { AuthUser, Conversation, ConversationListPage } from "@/lib/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/conv_share_header",
  useRouter: () => ({ push })
}));

vi.mock("@/lib/ws-client", () => ({
  addGlobalWsListener: () => () => undefined,
  useGlobalWebSocket: () => undefined
}));

const user: AuthUser = {
  id: "user_share_header",
  username: "owner",
  role: "user",
  authSource: "local",
  passwordManagedBy: "local",
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z"
};

const conversation: Conversation = {
  id: "conv_share_header",
  title: "Header share",
  titleGenerationStatus: "completed",
  folderId: null,
  providerProfileId: null,
  automationId: null,
  automationRunId: null,
  conversationOrigin: "manual",
  sortOrder: 0,
  createdAt: "2026-05-06T00:00:00.000Z",
  updatedAt: "2026-05-06T00:00:00.000Z",
  isActive: false,
  shareEnabled: false,
  shareToken: null,
  sharedAt: null
};

const conversationPage: ConversationListPage = {
  conversations: [conversation],
  hasMore: false,
  nextCursor: null
};

describe("Shell sharing control", () => {
  beforeEach(() => {
    push.mockReset();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
  });

  it("opens a share modal from the mobile header without moving the new chat button", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: false,
          token: null,
          url: null
        })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          token: "share_public_token",
          url: "http://localhost/share/share_public_token"
        })
      } as Response);

    render(
      <Shell
        currentUser={user}
        passwordLoginEnabled
        conversationPage={conversationPage}
        folders={[]}
      >
        <div>Thread body</div>
      </Shell>
    );

    const shareButton = screen
      .getAllByRole("button", { name: "Share conversation" })
      .find((button) => !button.className.includes("md:flex"))!;
    const newChatButton = screen.getAllByRole("button", { name: "New chat" }).at(-1)!;
    expect(shareButton.compareDocumentPosition(newChatButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(shareButton);

    expect(await screen.findByRole("dialog", { name: "Share conversation" })).toBeInTheDocument();
    expect(screen.queryByText("Sharing is off for this conversation.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy share link" })).not.toBeInTheDocument();
    expect(screen.getByText("Share this conversation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Share this conversation" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/share/share_public_token`
      );
    });
  });

  it("uses one sharing switch and keeps copying on the link icon button", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          token: "share_public_token",
          url: "http://localhost/share/share_public_token"
        })
      } as Response);
    render(
      <Shell
        currentUser={user}
        passwordLoginEnabled
        conversationPage={conversationPage}
        folders={[]}
      >
        <div>Thread body</div>
      </Shell>
    );

    const shareButton = screen
      .getAllByRole("button", { name: "Share conversation" })
      .find((button) => !button.className.includes("md:flex"))!;
    fireEvent.click(shareButton);

    expect(await screen.findByRole("switch", { name: "Share this conversation" })).toBeInTheDocument();
    expect(screen.getByText("Share this conversation")).toBeInTheDocument();
    expect(screen.queryByText("Sharing is off for this conversation.")).not.toBeInTheDocument();
    expect(screen.queryByText("Only workspace users can read it.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable sharing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable sharing" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy share link" })).toBeInTheDocument();
  });
});
