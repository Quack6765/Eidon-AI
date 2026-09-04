// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BotDetailView } from "@/components/agents/bot-detail-view";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { BotSummary, UserMemory } from "@/lib/types";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn()
}));

const wsMocks = vi.hoisted(() => ({
  listener: null as ((msg: { type: string }) => void) | null
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
  addGlobalWsListener: (listener: (msg: { type: string }) => void) => {
    wsMocks.listener = listener;
    return () => undefined;
  }
}));

const chatViewProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null
}));

vi.mock("@/components/chat-view", () => ({
  ChatView: (props: Record<string, unknown>) => {
    chatViewProps.current = props;
    return <div data-testid="chat-view" />;
  }
}));

vi.mock("@/components/agents/bot-form-modal", () => ({
  BotFormModal: () => null
}));

function renderWithPanelOpen(ui: React.ReactElement) {
  render(ui);
  const toggle = screen.getAllByRole("button").find((button) =>
    button.textContent?.includes("Details")
  );
  fireEvent.click(toggle!);
  return toggle;
}

function buildBot(overrides: Partial<BotSummary> = {}): BotSummary {
  return {
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
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function buildMemory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: "mem_1",
    content: "Prefers concise summaries",
    category: "preference",
    pinned: false,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function renderView(bot: BotSummary) {
  return renderWithPanelOpen(
    React.createElement(BotDetailView, {
      bot,
      systemPrompt: "You are a research bot.",
      conversationPayload: {} as ConversationViewPayload,
      routines: []
    })
  );
}

function mockMemoryEndpoints(memories: UserMemory[]) {
  const currentMemories = [...memories];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url === "/api/bots/bot_1/memories" && method === "GET") {
      return {
        ok: true,
        json: async () => ({ memories: currentMemories })
      } as Response;
    }

    if (url.startsWith("/api/bots/bot_1/memories") && method === "DELETE") {
      const memoryId = new URL(url, "http://localhost").searchParams.get("memoryId");
      const index = currentMemories.findIndex((memory) => memory.id === memoryId);
      if (index >= 0) {
        currentMemories.splice(index, 1);
      }
      return {
        ok: true,
        json: async () => ({ deleted: true })
      } as Response;
    }

    if (url === "/api/bots/bot_1/workspace" && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          tree: { name: "bot_1", path: "", isDirectory: true, byteSize: 0, children: [] }
        })
      } as Response;
    }

    if (url === "/api/bots/bot_1/seen-input" && method === "POST") {
      return {
        ok: true,
        json: async () => ({ deleted: true })
      } as Response;
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  }) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return fetchMock;
}

describe("bot detail memories", () => {
  it("renders the bot's private memories from the API", async () => {
    mockMemoryEndpoints([
      buildMemory(),
      buildMemory({
        id: "mem_2",
        content: "Works at Acme on the platform team",
        category: "work"
      })
    ]);

    renderView(buildBot());

    expect(await screen.findByText("Prefers concise summaries")).toBeInTheDocument();
    expect(screen.getByText("Works at Acme on the platform team")).toBeInTheDocument();
    expect(screen.getByText("preference")).toBeInTheDocument();
    expect(screen.getByText("work")).toBeInTheDocument();
    expect(
      screen.getByText("Private to this bot. Facts about the user come from the shared account memory.")
    ).toBeInTheDocument();
  });

  it("shows the empty state when the bot has no memories", async () => {
    mockMemoryEndpoints([]);

    renderView(buildBot());

    expect(
      await screen.findByText("No memories yet. This bot saves what it learns to its own pool.")
    ).toBeInTheDocument();
  });

  it("hides the conversation header in the embedded chat view", () => {
    mockMemoryEndpoints([]);

    renderView(buildBot());

    expect(chatViewProps.current).toMatchObject({
      hideConversationHeader: true,
      retainEmptyConversation: true
    });
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("deletes a memory through the confirm dialog and refetches", async () => {
    const fetchMock = mockMemoryEndpoints([
      buildMemory(),
      buildMemory({
        id: "mem_2",
        content: "Works at Acme on the platform team",
        category: "work"
      })
    ]);

    renderView(buildBot());

    expect(await screen.findByText("Prefers concise summaries")).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole("button", { name: "Delete memory" });
    fireEvent.click(deleteButtons[0]);

    expect(await screen.findByText("Delete memory?")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete memory?" })).getByRole("button", {
        name: "Delete"
      })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/bots/bot_1/memories?memoryId=mem_1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Prefers concise summaries")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Works at Acme on the platform team")).toBeInTheDocument();
  });

  it("acknowledges pending input on mount when the bot is waiting for input", async () => {
    const fetchMock = mockMemoryEndpoints([]);

    renderView(buildBot({ waitingForInput: true }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/bots/bot_1/seen-input",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("does not acknowledge pending input when nothing is waiting", () => {
    const fetchMock = mockMemoryEndpoints([]);

    renderView(buildBot());

    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/bots/bot_1/seen-input",
      expect.anything()
    );
  });
});
