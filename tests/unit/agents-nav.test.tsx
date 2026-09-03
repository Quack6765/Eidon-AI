// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AgentsNav } from "@/components/agents/agents-nav";
import type { BotSummary } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useRouter: () => ({
    push: vi.fn(),
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

vi.mock("@/components/sidebar-footer-nav", () => ({
  SidebarFooterNav: () => <nav data-testid="sidebar-footer" />
}));

vi.mock("@/components/agents/bot-avatar", () => ({
  BotAvatar: () => <div data-testid="bot-avatar" />
}));

function buildBot(overrides: Partial<BotSummary> = {}): BotSummary {
  return {
    id: "bot_1",
    name: "Research Bot",
    title: "Digs into topics",
    description: "Researches topics for the team.",
    avatarSeed: "seed_research",
    isChief: false,
    homeConversationId: "conv_1",
    status: "idle",
    waitingForInput: false,
    lastRunAt: null,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

describe("AgentsNav", () => {
  it("renders the purple dot next to a bot waiting for input", () => {
    render(<AgentsNav bots={[buildBot({ waitingForInput: true })]} onCloseAction={() => {}} />);

    const row = screen.getByRole("link", { name: /Research Bot/ });
    const dot = row.querySelector("span.bg-\\[var\\(--accent\\)\\]");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("h-2 w-2");
  });

  it("renders no indicator for an idle bot without pending input", () => {
    render(<AgentsNav bots={[buildBot()]} onCloseAction={() => {}} />);

    const row = screen.getByRole("link", { name: /Research Bot/ });
    expect(row.querySelector("span.bg-\\[var\\(--accent\\)\\]")).toBeNull();
  });
});
