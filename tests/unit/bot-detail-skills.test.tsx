// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BotDetailView } from "@/components/agents/bot-detail-view";
import type { ConversationViewPayload } from "@/lib/conversation-view";
import type { BotSummary, Skill } from "@/lib/types";

const routerMocks = vi.hoisted(() => ({
  push: vi.fn()
}));

const wsMocks = vi.hoisted(() => ({
  listener: null as ((msg: { type: string; run?: { botId: string } }) => void) | null
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
  addGlobalWsListener: (listener: (msg: { type: string; run?: { botId: string } }) => void) => {
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

function renderWithPanelOpen(ui: React.ReactElement) {
  render(ui);
  const toggle = screen.getAllByRole("button").find((button) =>
    button.textContent?.includes("Details")
  );
  fireEvent.click(toggle!);
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
    status: "idle",
    waitingForInput: false,
    lastRunAt: null,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function buildSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "botws-bot_1-web-research",
    name: "Web research",
    description: "Research a topic across sources.",
    content:
      "---\nname: Web research\ndescription: Research a topic across sources.\n---\n\nSearch broadly, then summarize.",
    enabled: true,
    createdAt: "2026-04-10T12:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
    ...overrides
  };
}

function mockSkillEndpoints(skills: Skill[], options: { failList?: boolean } = {}) {
  const current = [...skills];
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url === "/api/bots/bot_1/skills" && method === "GET") {
      if (options.failList) {
        return { ok: false, json: async () => ({ error: "nope" }) } as Response;
      }
      return { ok: true, json: async () => ({ skills: current }) } as Response;
    }

    if (url === "/api/bots/bot_1/skills" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        name: string;
        description: string;
        instructions: string;
      };
      const created = buildSkill({
        id: `botws-bot_1-${body.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: body.name,
        description: body.description,
        content: `---\nname: ${body.name}\ndescription: ${body.description}\n---\n\n${body.instructions}`
      });
      current.push(created);
      return { ok: true, status: 201, json: async () => ({ skill: created }) } as Response;
    }

    if (url.startsWith("/api/bots/bot_1/skills/") && method === "PATCH") {
      const id = url.split("/").pop()!;
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      const index = current.findIndex((skill) => skill.id === id);
      if (index >= 0) {
        current[index] = { ...current[index], ...body };
      }
      return { ok: true, json: async () => ({ skill: current[index] }) } as Response;
    }

    if (url.startsWith("/api/bots/bot_1/skills/") && method === "DELETE") {
      const id = url.split("/").pop()!;
      const index = current.findIndex((skill) => skill.id === id);
      if (index >= 0) {
        current.splice(index, 1);
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }

    if (url === "/api/bots/bot_1/memories" && method === "GET") {
      return { ok: true, json: async () => ({ memories: [] }) } as Response;
    }

    if (url === "/api/bots/bot_1/workspace" && method === "GET") {
      return {
        ok: true,
        json: async () => ({
          tree: { name: "bot_1", path: "", isDirectory: true, byteSize: 0, children: [] }
        })
      } as Response;
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  }) as unknown as typeof fetch;
  global.fetch = fetchMock;
  return { fetchMock, calls };
}

function renderView(bot: BotSummary = buildBot()) {
  renderWithPanelOpen(
    React.createElement(BotDetailView, {
      bot,
      systemPrompt: "You are a research bot.",
      conversationPayload: {} as ConversationViewPayload,
      routines: []
    })
  );
}

describe("bot detail skills", () => {
  it("lists the bot's workspace skills from the API", async () => {
    mockSkillEndpoints([
      buildSkill(),
      buildSkill({
        id: "botws-bot_1-pdf-extraction",
        name: "PDF extraction",
        description: "Pull text out of PDF files.",
        content: "---\nname: PDF extraction\ndescription: Pull text out of PDF files.\n---\n\nUse pdftotext."
      })
    ]);

    renderView();

    expect(await screen.findByText("Web research")).toBeInTheDocument();
    expect(screen.getByText("PDF extraction")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add skill" })).toBeInTheDocument();
  });

  it("shows the empty state when the bot has no skills", async () => {
    mockSkillEndpoints([]);

    renderView();

    expect(
      await screen.findByText("No skills yet. This bot saves skills it creates here, and you can add your own.")
    ).toBeInTheDocument();
  });

  it("shows a load error when listing skills fails", async () => {
    mockSkillEndpoints([], { failList: true });

    renderView();

    expect(await screen.findByText("Unable to load skills")).toBeInTheDocument();
  });

  it("edits a skill through the modal and refetches", async () => {
    const { calls } = mockSkillEndpoints([buildSkill()]);

    renderView();

    expect(await screen.findByText("Web research")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit skill Web research" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit skill" });
    const nameInput = within(dialog).getByLabelText("Skill name");
    expect(nameInput).toHaveValue("Web research");
    expect(within(dialog).getByLabelText("Skill description")).toHaveValue(
      "Research a topic across sources."
    );
    expect(within(dialog).getByLabelText("Skill instructions")).toHaveValue(
      "Search broadly, then summarize."
    );

    fireEvent.change(nameInput, { target: { value: "Deep research" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls).toContainEqual({
        method: "PATCH",
        url: "/api/bots/bot_1/skills/botws-bot_1-web-research",
        body: {
          name: "Deep research",
          description: "Research a topic across sources.",
          instructions: "Search broadly, then summarize."
        }
      });
    });
    expect(await screen.findByText("Deep research")).toBeInTheDocument();
  });

  it("creates a skill through the modal and validates required fields", async () => {
    const { fetchMock, calls } = mockSkillEndpoints([]);

    renderView();

    expect(await screen.findByText("No skills yet. This bot saves skills it creates here, and you can add your own.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    const dialog = await screen.findByRole("dialog", { name: "Add skill" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Name, description, and instructions are all required")
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/bots/bot_1/skills",
      expect.objectContaining({ method: "POST" })
    );

    fireEvent.change(within(dialog).getByLabelText("Skill name"), { target: { value: "Meeting notes" } });
    fireEvent.change(within(dialog).getByLabelText("Skill description"), {
      target: { value: "Summarize meetings." }
    });
    fireEvent.change(within(dialog).getByLabelText("Skill instructions"), {
      target: { value: "Capture action items." }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/bots/bot_1/skills",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Meeting notes",
      description: "Summarize meetings.",
      instructions: "Capture action items."
    });
    expect(await screen.findByText("Meeting notes")).toBeInTheDocument();
  });

  it("surfaces API errors inside the modal", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/bots/bot_1/skills" && (init?.method ?? "GET") === "GET") {
        return { ok: true, json: async () => ({ skills: [] }) } as Response;
      }
      if (url === "/api/bots/bot_1/memories") {
        return { ok: true, json: async () => ({ memories: [] }) } as Response;
      }
      if (url === "/api/bots/bot_1/workspace") {
        return {
          ok: true,
          json: async () => ({ tree: { name: "bot_1", path: "", isDirectory: true, byteSize: 0, children: [] } })
        } as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: "A skill with this name already exists." })
      } as Response;
    }) as unknown as typeof fetch;

    renderView();
    await screen.findByText("No skills yet. This bot saves skills it creates here, and you can add your own.");
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    const dialog = await screen.findByRole("dialog", { name: "Add skill" });
    fireEvent.change(within(dialog).getByLabelText("Skill name"), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText("Skill description"), {
      target: { value: "d" }
    });
    fireEvent.change(within(dialog).getByLabelText("Skill instructions"), {
      target: { value: "i" }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("A skill with this name already exists.")
    ).toBeInTheDocument();
  });

  it("deletes a skill through the confirm dialog and refetches", async () => {
    const { fetchMock } = mockSkillEndpoints([buildSkill()]);

    renderView();

    expect(await screen.findByText("Web research")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete skill Web research" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete skill?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/bots/bot_1/skills/botws-bot_1-web-research",
        expect.objectContaining({ method: "DELETE" })
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Web research")).not.toBeInTheDocument();
    });
  });

  it("refetches skills after a bot run updates", async () => {
    const { calls } = mockSkillEndpoints([]);

    renderView();
    await screen.findByText("No skills yet. This bot saves skills it creates here, and you can add your own.");

    const listCalls = () =>
      calls.filter((call) => call.url === "/api/bots/bot_1/skills" && call.method === "GET");
    expect(listCalls()).toHaveLength(1);

    wsMocks.listener?.({ type: "bot_run_updated", run: { botId: "bot_1" } });

    await waitFor(
      () => {
        expect(listCalls().length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 2000 }
    );
  });
});
