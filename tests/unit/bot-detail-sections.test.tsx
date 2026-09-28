// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BotDetailView } from "@/components/agents/bot-detail-view";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { BotRun, BotSummary } from "@/lib/types";

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
  unread: false,
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
        routines: [],
        runs: [],
        botNames: {}
      })
    );

    const toggle = screen.getAllByRole("button").find((button) => button.textContent?.includes("Details"));
    fireEvent.click(toggle!);

    for (const title of ["Conversation", "Workspace", "Skills", "Browser", "Memories", "Routines"]) {
      expect(screen.getByRole("button", { name: title })).toHaveAttribute("aria-expanded", "false");
    }

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Runs" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("No runs yet. Messages, hand-offs, and routines appear here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop all" })).toBeNull();
  });

  it("lists own and handed-off runs with their trigger, duration and error, and stops them", async () => {
    const run = (overrides: Partial<BotRun>): BotRun => ({
      id: "run",
      botId: "bot_1",
      conversationId: "conv_1",
      triggerSource: "dm",
      status: "completed",
      startedAt: "2026-04-10T12:00:00.000Z",
      finishedAt: "2026-04-10T12:02:14.000Z",
      parentMessageId: null,
      requestedByBotId: null,
      errorMessage: null,
      createdAt: "2026-04-10T12:00:00.000Z",
      ...overrides
    });
    const runs = [
      run({ id: "run_active", triggerSource: "delegated", status: "running", finishedAt: null, requestedByBotId: "bot_chief" }),
      run({ id: "run_handoff", botId: "bot_writer", status: "queued", startedAt: null, finishedAt: null, requestedByBotId: "bot_1" }),
      run({ id: "run_failed", triggerSource: "routine", status: "failed", errorMessage: "Provider timed out" }),
      run({ id: "run_done" })
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/bots/bot_1/runs/run_handoff/stop" && init?.method === "POST") {
        return { ok: true, json: async () => ({ run: { ...runs[1], status: "stopped" } }) } as Response;
      }
      if (url === "/api/bots/bot_1/stop" && init?.method === "POST") {
        return { ok: true, json: async () => ({ bot }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(
      React.createElement(BotDetailView, {
        bot,
        systemPrompt: "You are a research bot.",
        conversationPayload: {} as ConversationViewPayload,
        routines: [],
        runs,
        botNames: { bot_1: "Research Bot", bot_chief: "Chief of Staff", bot_writer: "Writer" }
      })
    );

    const detailsButton = screen.getAllByRole("button").find((button) => button.textContent?.includes("Details"))!;
    expect(detailsButton).toHaveTextContent("2 active runs");
    fireEvent.click(detailsButton);

    expect(screen.getByText("From Chief of Staff")).toBeInTheDocument();
    expect(screen.getByText("Handed to Writer")).toBeInTheDocument();
    expect(screen.getByText("Routine")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();
    expect(screen.getAllByText(/· 2m 14s$/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Stop run:/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Stop run: Handed to Writer" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Stop run:/ })).toHaveLength(1));
    expect(screen.getByText("stopped")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop all" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/bots/bot_1/stop", expect.objectContaining({ method: "POST" }))
    );
  });

  it("reports a run that could not be stopped", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Bot run not found" })
    })) as unknown as typeof fetch;

    render(
      React.createElement(BotDetailView, {
        bot,
        systemPrompt: "You are a research bot.",
        conversationPayload: {} as ConversationViewPayload,
        routines: [],
        runs: [
          {
            id: "run_gone",
            botId: "bot_1",
            conversationId: "conv_1",
            triggerSource: "dm",
            status: "queued",
            startedAt: null,
            finishedAt: null,
            parentMessageId: null,
            requestedByBotId: null,
            errorMessage: null,
            createdAt: "2026-04-10T12:00:00.000Z"
          }
        ],
        botNames: {}
      })
    );

    fireEvent.click(screen.getAllByRole("button").find((button) => button.textContent?.includes("Details"))!);
    fireEvent.click(screen.getByRole("button", { name: "Stop run: Direct message" }));

    expect(await screen.findByText("Bot run not found")).toBeInTheDocument();
  });
});
