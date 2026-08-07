// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { McpServersSection } from "@/components/settings/sections/mcp-servers-section";
import type { McpServerSummary } from "@/lib/types";

function makeServer(
  hasHeaders = false,
  overrides: Partial<McpServerSummary> = {}
): McpServerSummary {
  return {
    id: "mcp_docs",
    name: "Docs server",
    slug: "docs_server",
    url: "https://mcp.example.com",
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    hasHeaders,
    hasEnv: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("MCP servers section", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("preserves a newly saved secret on an immediate second save", async () => {
    let hasHeaders = false;
    const patchBodies: Array<Record<string, unknown>> = [];
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return {
          ok: true,
          json: async () => ({ servers: [makeServer(hasHeaders)] })
        } as Response;
      }
      if (url === "/api/mcp-servers/mcp_docs" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        if (body.headersAction === "replace") hasHeaders = true;
        if (body.headersAction === "clear") hasHeaders = false;
        return { ok: true, json: async () => ({ server: makeServer(hasHeaders) }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Docs server"));
    fireEvent.change(screen.getByPlaceholderText('{"Authorization": "Bearer ..."}'), {
      target: { value: '{"Authorization":"Bearer secret"}' }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    await screen.findByPlaceholderText("Stored securely. Leave blank to keep existing headers.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patchBodies).toHaveLength(2));

    expect(patchBodies.map((body) => body.headersAction)).toEqual(["replace", "preserve"]);
    expect(hasHeaders).toBe(true);
  });

  it("reports a rejected save without clearing the dirty draft", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      if (String(input) === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [makeServer()] }) } as Response;
      }
      throw new Error("network down");
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Docs server"));
    fireEvent.change(screen.getByDisplayValue("Docs server"), {
      target: { value: "Unsaved server" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Failed to save MCP server")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Unsaved server")).toBeInTheDocument();
  });

  it("shows an accessible validation error for missing required fields", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [] })
    } as Response);
    render(React.createElement(McpServersSection));

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Server name is required");
  });

  it("keeps a created server identity and retries later saves with PATCH", async () => {
    let postCount = 0;
    let patchCount = 0;
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [] }) } as Response;
      }
      if (url === "/api/mcp-servers" && init?.method === "POST") {
        postCount += 1;
        return {
          ok: true,
          json: async () => ({
            server: makeServer(false, {
              id: "mcp_created",
              name: "Canonical server",
              slug: "canonical_server",
              url: "https://canonical.example.com"
            })
          })
        } as Response;
      }
      if (url === "/api/mcp-servers/mcp_created" && init?.method === "PATCH") {
        patchCount += 1;
        return {
          ok: true,
          json: async () => ({
            server: makeServer(false, {
              id: "mcp_created",
              name: "Canonical server updated",
              slug: "canonical_server_updated",
              url: "https://canonical.example.com"
            })
          })
        } as Response;
      }
      throw new Error(`Unhandled fetch ${String(init?.method ?? "GET")} ${url}`);
    });
    render(React.createElement(McpServersSection));

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.change(screen.getByPlaceholderText("My MCP Server"), {
      target: { value: "Draft server" }
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://draft.example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByDisplayValue("Canonical server");
    fireEvent.change(screen.getByDisplayValue("Canonical server"), {
      target: { value: "Edited again" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByDisplayValue("Canonical server updated");
    expect(postCount).toBe(1);
    expect(patchCount).toBe(1);
  });

  it("does not let a stale initial load hide a newly created server", async () => {
    let resolveInitialLoad: ((response: Response) => void) | undefined;
    let initialLoadRead = false;
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return new Promise<Response>((resolve) => {
          resolveInitialLoad = resolve;
        });
      }
      if (url === "/api/mcp-servers" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            server: makeServer(false, {
              id: "mcp_created",
              name: "Canonical server",
              slug: "canonical_server"
            })
          })
        } as Response;
      }
      throw new Error(`Unhandled fetch ${String(init?.method ?? "GET")} ${url}`);
    });
    render(React.createElement(McpServersSection));

    await waitFor(() => expect(resolveInitialLoad).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.change(screen.getByPlaceholderText("My MCP Server"), {
      target: { value: "Draft server" }
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://draft.example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findAllByText("Canonical server")).toHaveLength(3);
    resolveInitialLoad?.({
      ok: true,
      json: async () => {
        initialLoadRead = true;
        return { servers: [] };
      }
    } as Response);

    await waitFor(() => expect(initialLoadRead).toBe(true));
    expect(screen.getAllByText("Canonical server")).toHaveLength(3);
  });
});
