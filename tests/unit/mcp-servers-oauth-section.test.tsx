// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { McpServersSection } from "@/components/settings/sections/mcp-servers-section";
import type { McpServerSummary } from "@/lib/types";

function makeServer(overrides: Partial<McpServerSummary> = {}): McpServerSummary {
  return {
    id: "mcp_oauth_ui",
    name: "Composio",
    slug: "composio",
    url: "https://connect.composio.dev/mcp",
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    isVisionMcp: false,
    hasHeaders: false,
    hasEnv: false,
    oauth: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

const originalLocation = window.location;
const originalMatchMedia = window.matchMedia;

function setDisplayMode(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: standalone && query.includes("standalone"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null
    })
  });
}

beforeEach(() => {
  setDisplayMode(false);
  global.fetch = vi.fn();
});

afterAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia
  });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation
  });
});

describe("MCP servers section OAuth UI", () => {
  it("restores the authentication-required state after navigating away and back", async () => {
    let listServers: McpServerSummary[] = [];
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: listServers }) } as Response;
      }
      if (url === "/api/mcp-servers" && init?.method === "POST") {
        listServers = [makeServer()];
        return { ok: true, json: async () => ({ server: makeServer() }) } as Response;
      }
      if (url === "/api/mcp-servers/test" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            success: false,
            requiresAuth: true,
            text: "Authentication required",
            oauth: { status: "auth_required", expiresAt: null, scope: null }
          })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const first = render(React.createElement(McpServersSection));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.change(screen.getByPlaceholderText("My MCP Server"), {
      target: { value: "Composio" }
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://connect.composio.dev/mcp" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("This server requires authentication.");
    await screen.findByText("AUTH REQUIRED");
    first.unmount();

    listServers = [
      makeServer({ oauth: { status: "auth_required", expiresAt: null, scope: null } })
    ];
    const testCallsAfterRemount = { count: 0 };
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: listServers }) } as Response;
      }
      if (url === "/api/mcp-servers/test" && init?.method === "POST") {
        testCallsAfterRemount.count += 1;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Composio"));

    expect(await screen.findByText("This server requires authentication.")).toBeTruthy();
    expect(await screen.findByText("AUTH REQUIRED")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Authenticate/ })).toBeTruthy();
    expect(testCallsAfterRemount.count).toBe(0);
  });

  it("shows an auth-required badge for servers with an expired connection", async () => {
    const server = makeServer({
      oauth: { status: "expired", expiresAt: null, scope: null }
    });
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [server] }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));

    expect(await screen.findByText("AUTH REQUIRED")).toBeTruthy();
    expect(screen.getByText("HTTP")).toBeTruthy();
    expect(screen.queryByText("OAuth connected")).toBeNull();
  });

  it("opens the provider sign-in in the system browser when running as an installed PWA", async () => {
    setDisplayMode(true);
    const server = makeServer({ oauth: { status: "auth_required", expiresAt: null, scope: null } });
    const assignMock = vi.fn();
    const openMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock }
    });
    Object.defineProperty(window, "open", { configurable: true, writable: true, value: openMock });

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [server] }) } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ server }) } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui/oauth/flows" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            flowId: "flow_pwa",
            authorizationUrl: "https://login.composio.dev/oauth2/authorize?state=pwa"
          })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Composio"));
    fireEvent.click(screen.getByText("Authenticate"));

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledWith(
        "https://login.composio.dev/oauth2/authorize?state=pwa",
        "_blank",
        "noopener,noreferrer"
      );
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/Continue the sign-in in your browser/)).toBeTruthy();
  });

  it("refreshes server state when the app becomes visible again", async () => {
    const connected = makeServer({
      oauth: { status: "connected", expiresAt: "2026-06-01T00:00:00.000Z", scope: "mcp" }
    });
    const pending = makeServer({ oauth: { status: "auth_required", expiresAt: null, scope: null } });
    let listResponse: McpServerSummary[] = [pending];
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: listResponse }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Composio"));
    expect(await screen.findByText("This server requires authentication.")).toBeTruthy();

    listResponse = [connected];
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByText("OAuth connected")).toBeTruthy();
    });
    expect(screen.queryByText("This server requires authentication.")).toBeNull();
  });

  it("shows the connected state and disconnects with confirmation", async () => {
    const server = makeServer({
      oauth: { status: "connected", expiresAt: "2026-06-01T00:00:00.000Z", scope: "mcp" }
    });
    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [server] }) } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui/oauth" && init?.method === "DELETE") {
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      if (url === "/api/mcp-servers/test" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ success: false, requiresAuth: true, text: "Authentication required" })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Composio"));

    expect(await screen.findByText("OAuth connected")).toBeTruthy();

    fireEvent.click(screen.getByText("Disconnect"));
    const dialogConfirm = (await screen.findAllByText("Disconnect")).pop()!;
    fireEvent.click(dialogConfirm);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input) === "/api/mcp-servers/mcp_oauth_ui/oauth" && init?.method === "DELETE"
        )
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText("OAuth connected")).toBeNull();
    });
    expect(await screen.findByText("This server requires authentication.")).toBeTruthy();
    expect(await screen.findByText("AUTH REQUIRED")).toBeTruthy();
  });

  it("prompts to authenticate right after saving a server that requires OAuth", async () => {
    const server = makeServer();
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock }
    });

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [] }) } as Response;
      }
      if (url === "/api/mcp-servers" && init?.method === "POST") {
        return { ok: true, json: async () => ({ server }) } as Response;
      }
      if (url === "/api/mcp-servers/test" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ success: false, requiresAuth: true, text: "Authentication required" })
        } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ server }) } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui/oauth/flows" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            flowId: "flow_save",
            authorizationUrl: "https://login.composio.dev/oauth2/authorize?state=xyz"
          })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.change(screen.getByPlaceholderText("My MCP Server"), {
      target: { value: "Composio" }
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://connect.composio.dev/mcp" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Authentication required");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/mcp-servers/test" && init?.method === "POST"
      )
    ).toBe(true);

    await screen.findByText("AUTH REQUIRED");

    const testCallsBeforeAuthenticate = fetchMock.mock.calls.filter(
      ([input, init]) =>
        String(input) === "/api/mcp-servers/test" && init?.method === "POST"
    ).length;
    fireEvent.click(await screen.findByText("Authenticate"));
    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "https://login.composio.dev/oauth2/authorize?state=xyz"
      );
    });
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) === "/api/mcp-servers/test" && init?.method === "POST"
      ).length
    ).toBe(testCallsBeforeAuthenticate);
  });

  it("offers authentication after a requiresAuth test result and redirects to the provider", async () => {
    const server = makeServer();
    const assignMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: assignMock }
    });

    const fetchMock = vi.mocked(global.fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && !init?.method) {
        return { ok: true, json: async () => ({ servers: [server] }) } as Response;
      }
      if (url === "/api/mcp-servers/test" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ success: false, requiresAuth: true, text: "Authentication required" })
        } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ server }) } as Response;
      }
      if (url === "/api/mcp-servers/mcp_oauth_ui/oauth/flows" && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            flowId: "flow_1",
            authorizationUrl: "https://connect.composio.dev/oauth/authorize?state=abc"
          })
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(React.createElement(McpServersSection));
    fireEvent.click(await screen.findByText("Composio"));

    fireEvent.click(screen.getByText("Test"));
    await screen.findByText("Authentication required");

    fireEvent.click(await screen.findByText("Authenticate"));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith(
        "https://connect.composio.dev/oauth/authorize?state=abc"
      );
    });
  });
});
