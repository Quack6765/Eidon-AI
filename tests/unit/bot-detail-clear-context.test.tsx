// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BotDetailView } from "@/components/agents/bot-detail-view";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { BotSummary } from "@/lib/types";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn()
}));

const wsMocks = vi.hoisted(() => ({
  listener: null as ((msg: { type: string; botId?: string }) => void) | null
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerMocks.push,
    refresh: routerMocks.refresh
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
  addGlobalWsListener: (listener: (msg: { type: string; botId?: string }) => void) => {
    wsMocks.listener = listener;
    return () => undefined;
  }
}));

vi.mock("@/components/chat-view", () => ({
  ChatView: () => <div data-testid="chat-view" />
}));

vi.mock("@/components/agents/bot-form-modal", () => ({
  BotFormModal: () => null
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

function mockDetailEndpoints(options: { failClear?: boolean } = {}) {
  const calls: Array<{ method: string; url: string }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    if (url === "/api/bots/bot_1/workspace" && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          tree: { name: "bot_1", path: "", isDirectory: true, byteSize: 0, children: [] }
        })
      } as Response;
    }
    if (url === "/api/bots/bot_1/memories" && method === "GET") {
      return { ok: true, json: async () => ({ memories: [] }) } as Response;
    }
    if (url === "/api/bots/bot_1/skills" && method === "GET") {
      return { ok: true, json: async () => ({ skills: [] }) } as Response;
    }
    if (url === "/api/bots/bot_1/clear-context" && method === "POST") {
      if (options.failClear) {
        return { ok: false, status: 409, json: async () => ({ error: "This bot is still finishing a run. Try again in a moment." }) } as Response;
      }
      return { ok: true, json: async () => ({ cleared: true, bot: buildBot() }) } as Response;
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  }) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return { fetchMock, calls };
}

function findDetailsToggle() {
  return screen.getAllByRole("button").find((button) => button.hasAttribute("aria-pressed"))!;
}

function renderView(bot: BotSummary = buildBot()) {
  render(
    React.createElement(BotDetailView, {
      bot,
      systemPrompt: "You are a research bot.",
      conversationPayload: {} as ConversationViewPayload,
      routines: []
    })
  );
  fireEvent.click(findDetailsToggle());
}

describe("bot detail clear conversation", () => {
  beforeEach(() => {
    routerMocks.push.mockReset();
    routerMocks.refresh.mockReset();
  });
  it("clears the conversation after confirmation and refreshes the server payload", async () => {
    const { calls } = mockDetailEndpoints();

    renderView();

    const clearButton = await screen.findByRole("button", { name: /Clear conversation/ });
    fireEvent.click(clearButton);

    const dialog = await screen.findByRole("dialog");
    expect(screen.getByText("Clear conversation?")).toBeInTheDocument();
    expect(dialog.textContent).toContain("Any running task is stopped");

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));

    await waitFor(() => {
      expect(calls).toContainEqual({ method: "POST", url: "/api/bots/bot_1/clear-context" });
    });
    await waitFor(() => {
      expect(routerMocks.refresh).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(findDetailsToggle()).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("shows the failure notice when clearing is rejected", async () => {
    mockDetailEndpoints({ failClear: true });

    renderView();

    const clearButton = await screen.findByRole("button", { name: /Clear conversation/ });
    fireEvent.click(clearButton);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));

    expect(
      await screen.findByText("This bot is still finishing a run. Try again in a moment.")
    ).toBeInTheDocument();
    expect(routerMocks.refresh).not.toHaveBeenCalled();
    expect(findDetailsToggle()).toHaveAttribute("aria-pressed", "true");
  });
});
