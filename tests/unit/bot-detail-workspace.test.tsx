// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BotDetailView } from "@/components/agents/bot-detail-view";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { BotSummary } from "@/lib/types";

const routerMocks = vi.hoisted(() => {
  const push = vi.fn();
  return { push, router: { push, refresh: vi.fn() } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks.router
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

const wsMocks = vi.hoisted(() => ({
  listeners: new Set<(message: unknown) => void>(),
  reconnectListeners: new Set<() => void>()
}));

vi.mock("@/lib/ws-client", () => ({
  addGlobalWsListener: (listener: (message: unknown) => void, options?: { onReconnect?: () => void }) => {
    wsMocks.listeners.add(listener);
    if (options?.onReconnect) wsMocks.reconnectListeners.add(options.onReconnect);
    return () => {
      wsMocks.listeners.delete(listener);
      if (options?.onReconnect) wsMocks.reconnectListeners.delete(options.onReconnect);
    };
  }
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

function node(name: string, filePath: string, extra: Record<string, unknown> = {}) {
  return { name, path: filePath, isDirectory: false, byteSize: 4, children: [], ...extra };
}

function renderWithWorkspace() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/bots/bot_1/workspace") {
      return {
        ok: true,
        json: async () => ({
          tree: {
            name: "bot_1",
            path: "",
            isDirectory: true,
            byteSize: 0,
            children: [
              {
                name: "reports",
                path: "reports",
                isDirectory: true,
                byteSize: 0,
                children: [node("june.md", "reports/june.md", { kind: "text", mimeType: "text/markdown" })]
              }
            ]
          },
          sharedTree: {
            name: "shared",
            path: "",
            isDirectory: true,
            byteSize: 0,
            children: [node("handoff.zip", "handoff.zip", { kind: "file", mimeType: "application/zip" })]
          }
        })
      } as Response;
    }
    if (url.startsWith("/api/bots/bot_1/workspace/file?") && url.endsWith("&format=text")) {
      const params = new URL(url, "http://localhost").searchParams;
      if (params.get("path") === "handoff.zip") {
        return { ok: false, status: 415, json: async () => ({ error: "unsupported" }) } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ filename: "june.md", mimeType: "text/markdown", content: "# June report" })
      } as Response;
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
      runs: [],
      botNames: {}
    })
  );

  const toggle = screen.getAllByRole("button").find((button) => button.textContent?.includes("Details"));
  fireEvent.click(toggle!);
  fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
  return fetchMock;
}

describe("bot detail workspace files", () => {
  it("opens a workspace file in the preview with a download link", async () => {
    const fetchMock = renderWithWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "Research Bot" }));
    fireEvent.click(screen.getByRole("button", { name: "reports" }));
    fireEvent.click(screen.getByRole("button", { name: "Open june.md" }));

    const dialog = await screen.findByRole("dialog", { name: "Attachment preview" });
    await waitFor(() => expect(within(dialog).getByText("# June report")).toBeInTheDocument());
    expect(within(dialog).getByText("text/markdown")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/bots/bot_1/workspace/file?scope=bot&path=reports%2Fjune.md&v=1&format=text"
    );
    expect(within(dialog).getByRole("link", { name: "Download attachment" })).toHaveAttribute(
      "href",
      "/api/bots/bot_1/workspace/file?scope=bot&path=reports%2Fjune.md&v=1&download=1"
    );

    expect(document.querySelector("body > div.fixed.inset-0.z-50")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close attachment preview" }));
    expect(screen.queryByRole("dialog", { name: "Attachment preview" })).not.toBeInTheDocument();
  });

  it("lists the shared workspace and offers a download when a file cannot be previewed", async () => {
    renderWithWorkspace();

    fireEvent.click(await screen.findByRole("button", { name: "shared" }));
    fireEvent.click(screen.getByRole("button", { name: "Open handoff.zip" }));

    const dialog = await screen.findByRole("dialog", { name: "Attachment preview" });
    await waitFor(() =>
      expect(within(dialog).getByText("Preview unavailable for this attachment type.")).toBeInTheDocument()
    );
    expect(within(dialog).getByRole("link", { name: "Download attachment" })).toHaveAttribute(
      "href",
      "/api/bots/bot_1/workspace/file?scope=shared&path=handoff.zip&v=1&download=1"
    );
  });

  it("shows an empty message for each workspace root", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tree: { name: "bot_1", path: "", isDirectory: true, byteSize: 0, children: [] },
        sharedTree: { name: "shared", path: "", isDirectory: true, byteSize: 0, children: [] }
      })
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
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    fireEvent.click(await screen.findByRole("button", { name: "Research Bot" }));
    fireEvent.click(screen.getByRole("button", { name: "shared" }));
    expect(screen.getByText("No workspace files yet.")).toBeInTheDocument();
    expect(screen.getByText("No shared files yet.")).toBeInTheDocument();
  });

  it("reloads the workspace when any bot on the team finishes a run", async () => {
    const fetchMock = renderWithWorkspace();
    await screen.findByRole("button", { name: "Research Bot" });
    const workspaceLoads = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/bots/bot_1/workspace").length;
    expect(workspaceLoads()).toBe(1);

    for (const listener of wsMocks.listeners) {
      listener({ type: "bot_run_updated", run: { botId: "bot_other", status: "completed" } });
    }
    await waitFor(() => expect(workspaceLoads()).toBe(2));

    for (const listener of wsMocks.listeners) {
      listener({ type: "bot_updated", bot: { ...bot, id: "bot_other" } });
    }
    await waitFor(() => expect(workspaceLoads()).toBe(3));
  });

  it("reloads the bot, its skills, and its workspace after the live connection comes back", async () => {
    const fetchMock = renderWithWorkspace();
    await screen.findByRole("button", { name: "Research Bot" });
    const calls = (url: string) => fetchMock.mock.calls.filter(([input]) => String(input) === url).length;
    const before = {
      bot: calls("/api/bots/bot_1"),
      skills: calls("/api/bots/bot_1/skills"),
      workspace: calls("/api/bots/bot_1/workspace")
    };

    for (const onReconnect of wsMocks.reconnectListeners) onReconnect();

    await waitFor(() => {
      expect(calls("/api/bots/bot_1")).toBe(before.bot + 1);
      expect(calls("/api/bots/bot_1/skills")).toBe(before.skills + 1);
      expect(calls("/api/bots/bot_1/workspace")).toBe(before.workspace + 1);
    });
  });

  it("reports a workspace payload without the shared tree as a load failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tree: { name: "bot_1", path: "", isDirectory: true, byteSize: 0, children: [] } })
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
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(await screen.findByText("Unable to load workspace files")).toBeInTheDocument();
  });
});
