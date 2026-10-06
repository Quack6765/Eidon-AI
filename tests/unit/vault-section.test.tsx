// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { VaultSection } from "@/components/settings/sections/vault-section";
import type { VaultEntry } from "@/lib/vault";

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "vault_github",
    name: "GitHub password",
    origin: "https://github.com",
    username: "octocat",
    notes: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    lastUsedAt: null,
    ...overrides
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("vault section", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("explains an empty vault and creates a secret", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/vault" && !init?.method) return jsonResponse({ vaultEntries: [] });
      if (url === "/api/vault" && init?.method === "POST") {
        return jsonResponse({ vaultEntry: makeEntry({ id: "vault_openai", name: "OpenAI API key", origin: null, username: "" }) }, 201);
      }
      throw new Error(`Unhandled fetch ${init?.method ?? "GET"} ${url}`);
    });
    render(<VaultSection />);

    expect(await screen.findByText(/Nothing in your vault yet/)).toBeInTheDocument();
    expect(screen.getByText("0 secrets")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add secret" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Give the secret a name.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "OpenAI API key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the secret's value.")).toBeInTheDocument();

    const value = screen.getByLabelText("Value");
    expect(value).toHaveAttribute("type", "password");
    fireEvent.change(value, { target: { value: "sk-test-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("1 secret")).toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: "OpenAI API key",
      origin: null,
      username: "",
      notes: "",
      secret: "sk-test-123"
    });
    expect(screen.getByLabelText("Value")).toHaveValue("");
    expect(screen.getByText("No site")).toBeInTheDocument();
  });

  it("lists entries without values, reveals one on demand and keeps it unless changed", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/vault" && !init?.method) return jsonResponse({ vaultEntries: [makeEntry()] });
      if (url === "/api/vault/vault_github/secret") return jsonResponse({ secret: "hunter22" });
      if (url === "/api/vault/vault_github" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { notes: string };
        return jsonResponse({ vaultEntry: makeEntry({ notes: body.notes }) });
      }
      throw new Error(`Unhandled fetch ${init?.method ?? "GET"} ${url}`);
    });
    render(<VaultSection />);

    fireEvent.click(await screen.findByRole("button", { name: /GitHub password/ }));
    expect(screen.getByText("github.com · octocat")).toBeInTheDocument();
    expect(screen.getByText(/not used yet/)).toBeInTheDocument();
    const value = screen.getByLabelText("Value");
    expect(value).toHaveValue("");
    expect(value).toHaveAttribute("placeholder", "Stored. Leave empty to keep it");

    fireEvent.click(screen.getByRole("button", { name: "Show value" }));
    await waitFor(() => expect(value).toHaveValue("hunter22"));
    expect(value).toHaveAttribute("type", "text");
    expect(fetchMock).toHaveBeenCalledWith("/api/vault/vault_github/secret", { cache: "no-store" });
    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide value" }));
    expect(value).toHaveAttribute("type", "password");

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Work account" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      name: "GitHub password",
      origin: "https://github.com",
      username: "octocat",
      notes: "Work account"
    });
  });

  it("sends a changed value, shows server errors and deletes after confirmation", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/vault" && !init?.method) {
        return jsonResponse({ vaultEntries: [makeEntry(), makeEntry({ id: "vault_aws", name: "AWS key", origin: null, username: "" })] });
      }
      if (url === "/api/vault/vault_github" && init?.method === "PATCH") {
        return jsonResponse({ error: "You already have a secret called \"AWS key\"." }, 409);
      }
      if (url === "/api/vault/vault_github" && init?.method === "DELETE") return jsonResponse({ success: true });
      throw new Error(`Unhandled fetch ${init?.method ?? "GET"} ${url}`);
    });
    render(<VaultSection />);

    fireEvent.click(await screen.findByRole("button", { name: /GitHub password/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "AWS key" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "new-password" } });
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("You already have a secret called \"AWS key\".")).toBeInTheDocument();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ name: "AWS key", secret: "new-password" });

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Name")).toHaveValue("GitHub password");
    expect(screen.getByLabelText("Value")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("GitHub password")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /GitHub password/ })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/vault/vault_github", { method: "DELETE" });
    expect(screen.getByText("1 secret")).toBeInTheDocument();
    expect(screen.getByText("Select a secret or add a new one")).toBeInTheDocument();
  });

  it("asks before switching away from unsaved changes", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/vault" && !init?.method) {
        return jsonResponse({ vaultEntries: [makeEntry(), makeEntry({ id: "vault_aws", name: "AWS key", origin: null, username: "" })] });
      }
      throw new Error(`Unhandled fetch ${init?.method ?? "GET"} ${url}`);
    });
    render(<VaultSection />);

    fireEvent.click(await screen.findByRole("button", { name: /GitHub password/ }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "someone-else" } });
    fireEvent.click(screen.getByRole("button", { name: /AWS key/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't save" }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("AWS key"));
    expect(screen.getByLabelText("Username")).toHaveValue("");
  });
});
