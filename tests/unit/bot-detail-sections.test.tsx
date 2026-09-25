// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { BotDetailView } from "@/components/agents/bot-detail-view";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { BotSummary } from "@/lib/types";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerMocks.push,
    refresh: vi.fn()
  })
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

vi.mock("@/lib/ws-client", () => ({
  addGlobalWsListener: () => () => undefined
}));

vi.mock("@/components/chat-view", () => ({
  ChatView: () => <div data-testid="chat-view" />
}));

vi.mock("@/components/agents/bot-form-modal", () => ({
  BotFormModal: () => null
}));

const bot: BotSummary = {
  id: "bot_1",
  name: "Research Bot",
  title: "Digs into topics",
  description: "Researches topics for the team.",
  avatarSeed: "seed_research",
  isChief: false,
  homeConversationId: "conv_1",
  providerProfileId: null,
  status: "idle",
  waitingForInput: false,
  lastRunAt: null,
  createdAt: "2026-04-10T12:00:00.000Z",
  updatedAt: "2026-04-10T12:00:00.000Z"
};

describe("bot detail sections", () => {
  it("start collapsed by default and expand on header click", () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({})
    })) as unknown as typeof fetch;

    render(
      React.createElement(BotDetailView, {
        bot,
        systemPrompt: "You are a research bot.",
        conversationPayload: {} as ConversationViewPayload,
        routines: []
      })
    );

    const toggle = screen.getAllByRole("button").find((button) => button.textContent?.includes("Details"));
    fireEvent.click(toggle!);

    for (const title of ["Conversation", "Workspace", "Skills", "Browser", "Memories", "Routines"]) {
      expect(screen.getByRole("button", { name: title })).toHaveAttribute("aria-expanded", "false");
    }

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-expanded", "true");
  });
});
