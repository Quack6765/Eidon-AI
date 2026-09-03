// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentsWorkspace } from "@/components/agents/agents-workspace";
import type { BotRun, BotSummary } from "@/lib/types";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn()
}));

const wsMocks = vi.hoisted(() => ({
  listener: null as ((msg: { type: string; bot?: BotSummary }) => void) | null
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
  addGlobalWsListener: (listener: (msg: { type: string; bot?: BotSummary }) => void) => {
    wsMocks.listener = listener;
    return () => undefined;
  }
}));

function buildBot(overrides: Partial<BotSummary> = {}): BotSummary {
  return {
    id: "bot_chief",
    name: "Chief of Staff",
    title: "Runs the team",
    description: "Delegates work to specialist bots.",
    avatarSeed: "seed_chief",
    isChief: true,
    homeConversationId: "conv_chief",
    status: "idle",
    lastRunAt: null,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function buildRun(overrides: Partial<BotRun> = {}): BotRun {
  return {
    id: "run_1",
    botId: "bot_chief",
    conversationId: "conv_chief",
    triggerSource: "dm",
    status: "completed",
    startedAt: null,
    finishedAt: null,
    parentMessageId: null,
    errorMessage: null,
    createdAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function mockGetBotsEndpoint(bots: BotSummary[]) {
  global.fetch = vi.fn(async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/bots" && method === "GET") {
      return {
        ok: true,
        json: async () => ({ bots, runs: [], limits: { maxBots: 20 } })
      } as Response;
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  }) as typeof fetch;
}

describe("agents workspace", () => {
  it("pins the chief bot first and shows roster status", () => {
    render(
      React.createElement(AgentsWorkspace, {
        initialBots: [
          buildBot({
            id: "bot_inbox",
            name: "Inbox Bot",
            isChief: false,
            status: "running"
          }),
          buildBot()
        ],
        initialRuns: [],
        initialLimits: { maxBots: 20 }
      })
    );

    const chiefCard = screen.getByRole("link", { name: /Chief of Staff/ });
    const inboxCard = screen.getByRole("link", { name: /Inbox Bot/ });
    expect(
      chiefCard.compareDocumentPosition(inboxCard) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText("Chief")).toBeInTheDocument();
    expect(screen.getByLabelText("Running")).toBeInTheDocument();
    expect(screen.getByText("2 of 20 bots")).toBeInTheDocument();
  });

  it("creates a bot and navigates to its thread", async () => {
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/bots" && method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            bot: buildBot({
              id: "bot_new",
              name: "Research Bot",
              isChief: false
            })
          })
        } as unknown as Response;
      }

      if (url === "/api/bots" && method === "GET") {
        return {
          ok: true,
          json: async () => ({ bots: [], runs: [], limits: { maxBots: 20 } })
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    }) as typeof fetch;

    render(
      React.createElement(AgentsWorkspace, {
        initialBots: [],
        initialRuns: [],
        initialLimits: { maxBots: 20 }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /New bot/ }));
    fireEvent.change(screen.getByLabelText("Bot name"), {
      target: { value: "Research Bot" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create bot" }));

    await waitFor(() => {
      expect(routerMocks.push).toHaveBeenCalledWith("/agents/bot_new");
    });
  });

  it("surfaces API errors such as the bot limit", async () => {
    global.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/bots" && method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "Bot limit reached (20)" })
        } as unknown as Response;
      }

      if (url === "/api/bots" && method === "GET") {
        return {
          ok: true,
          json: async () => ({ bots: [], runs: [], limits: { maxBots: 20 } })
        } as Response;
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    }) as typeof fetch;

    render(
      React.createElement(AgentsWorkspace, {
        initialBots: [],
        initialRuns: [],
        initialLimits: { maxBots: 20 }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /New bot/ }));
    fireEvent.change(screen.getByLabelText("Bot name"), {
      target: { value: "One too many" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create bot" }));

    expect(await screen.findByText("Bot limit reached (20)")).toBeInTheDocument();
  });

  it("updates bot status from websocket events", async () => {
    mockGetBotsEndpoint([buildBot()]);

    render(
      React.createElement(AgentsWorkspace, {
        initialBots: [buildBot()],
        initialRuns: [buildRun()],
        initialLimits: { maxBots: 20 }
      })
    );

    expect(screen.queryByText("Idle")).not.toBeInTheDocument();

    wsMocks.listener?.({
      type: "bot_updated",
      bot: buildBot({ status: "running" })
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Running")).toBeInTheDocument();
    });

    wsMocks.listener?.({
      type: "bot_updated",
      bot: buildBot({ status: "idle" })
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Running")).not.toBeInTheDocument();
    });
  });
});
