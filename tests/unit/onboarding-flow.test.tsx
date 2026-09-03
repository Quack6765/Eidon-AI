// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { OnboardingFlow, type OnboardingSettings } from "@/components/onboarding/onboarding-flow";
import { createProviderProfileDraft } from "@/lib/provider-catalog";
import { toProviderProfileEditorDraft } from "@/lib/provider-profile-editor";
import type { ProviderProfileSummary } from "@/lib/provider-profile";
import type { UserRole } from "@/lib/types";

const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh })
}));

function makeProfile(): ProviderProfileSummary {
  const flat = createProviderProfileDraft({ id: "prof_seed", name: "Default profile" });
  const timestamp = "2026-01-01T00:00:00.000Z";
  return toProviderProfileEditorDraft({
    ...flat,
    providerConfig: {
      apiBaseUrl: flat.apiBaseUrl,
      apiMode: flat.apiMode,
      processingMode: flat.processingMode,
      reasoningParameterMode: flat.reasoningParameterMode
    },
    connection: { mode: "api_key", status: "disconnected", accountLabel: null, expiresAt: null },
    createdAt: timestamp,
    updatedAt: timestamp
  } as ProviderProfileSummary) as ProviderProfileSummary;
}

function makeSettings(): OnboardingSettings {
  return {
    defaultView: "chat",
    toolCallDisplay: "pills",
    defaultProviderProfileId: "prof_seed",
    providerProfiles: [makeProfile()],
    skillsEnabled: true
  };
}

function renderFlow(role: UserRole = "admin") {
  return render(
    React.createElement(OnboardingFlow, { role, settings: makeSettings() })
  );
}

/** Advances past the welcome screen onto the first numbered step. */
function startFlow() {
  fireEvent.click(screen.getByRole("button", { name: "Get started" }));
}

describe("onboarding flow", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settings: {} })
    } as Response);
  });

  it("opens on the welcome screen with no step counter", () => {
    renderFlow();
    expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy();
    expect(screen.queryByText(/^Step /)).toBeNull();
  });

  it("counts four steps for an admin", () => {
    renderFlow("admin");
    startFlow();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
  });

  it("counts only two steps for a non-admin and skips the admin-only steps", async () => {
    renderFlow("user");
    startFlow();
    expect(screen.getByText("Step 1 of 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Step 2 of 2")).toBeTruthy());
    expect(screen.getByText("How should tool calls look?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("You're set up")).toBeTruthy());
    // Never offered the provider or MCP steps.
    expect(screen.queryByText("Connect a model provider")).toBeNull();
    expect(screen.queryByText("Add an MCP server")).toBeNull();
  });

  it("saves the chosen default view when advancing", async () => {
    renderFlow("user");
    startFlow();
    fireEvent.click(screen.getByRole("radio", { name: /Agents/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("/api/onboarding");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ defaultView: "agents" });
  });

  it("preselects the chat view for a fresh install", () => {
    renderFlow("user");
    startFlow();

    expect(screen.getByRole("radio", { name: /Chat/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Agents/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: /Automations/ }).getAttribute("aria-checked")).toBe("false");
  });

  it("renders both tool display demos side by side", async () => {
    renderFlow("user");
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    expect(screen.getByRole("radio", { name: /Tool pills/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Single status line/ })).toBeTruthy();
  });

  it("preserves the draft when navigating back", async () => {
    renderFlow("user");
    startFlow();
    fireEvent.click(screen.getByRole("radio", { name: /Automations/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByText("Step 2 of 2")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    await waitFor(() => expect(screen.getByText("Step 1 of 2")).toBeTruthy());
    expect(screen.getByRole("radio", { name: /Automations/ }).getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("shows a README screenshot on every default-view tile", () => {
    renderFlow("user");
    startFlow();

    const expected = [
      ["Eidon chat with a tool timeline and queued follow-ups", "/screenshots/desktop-chat.png"],
      ["Chief of Staff agent messaging two specialist bots", "/screenshots/desktop-delegation.png"],
      ["Automations list with run history", "/screenshots/desktop-automations.png"]
    ] as const;
    for (const [name, src] of expected) {
      expect(screen.getByRole("img", { name }).getAttribute("src")).toBe(src);
    }
  });

  /** Walks an admin from the welcome screen to the provider step. */
  async function gotoProviderStep() {
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Connect a model provider")).toBeTruthy());
  }

  function saveButton() {
    return screen.getByRole("button", { name: "Save and test" });
  }

  it("keeps the provider step blocked until a preset and key are supplied", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    expect(saveButton().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));
    expect(saveButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });

  it("pre-fills the model from the chosen preset and keeps it editable", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));
    const model = screen.getByLabelText("Model") as HTMLInputElement;
    expect(model.value).toBe("claude-opus-4-8");

    // Switching preset swaps in that preset's suggestion.
    fireEvent.click(screen.getByRole("radio", { name: /^OpenAI \(/ }));
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("gpt-5.6-luna");
  });

  it("blocks saving when the model is cleared", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    expect(saveButton().hasAttribute("disabled")).toBe(false);

    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "  " } });
    expect(saveButton().hasAttribute("disabled")).toBe(true);
  });

  it("requires a model for a preset that ships without one", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: /OpenRouter/ }));
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    expect(saveButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: "anthropic/claude-opus-4.8" }
    });
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });

  it("does not discard an edited model when the active preset is clicked again", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-haiku-4-5" } });
    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));

    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("claude-haiku-4-5");
  });

  it("offers a custom endpoint tile per key-based provider kind", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    const custom = screen.getByRole("radiogroup", { name: "Custom endpoint" });
    const tiles = within(custom).getAllByRole("radio");
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Custom OpenAI compatible endpoint",
      "Custom Anthropic compatible endpoint"
    ]);

    // The named vendors and the sign-in option stay in their own group.
    const presets = screen.getByRole("radiogroup", { name: "Model provider" });
    expect(within(presets).getAllByRole("radio")).toHaveLength(10);
  });

  it("shows each preset's brand logo on its tile", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    const presets = screen.getByRole("radiogroup", { name: "Model provider" });
    const logos = Array.from(presets.querySelectorAll("img"));
    expect(logos.map((logo) => logo.getAttribute("src"))).toEqual([
      "/logos/ollama.svg",
      "/logos/zai.svg",
      "/logos/openrouter.svg",
      "/logos/opencode.svg",
      "/logos/deepseek.svg",
      "/logos/xiaomi.svg",
      "/logos/openai.svg",
      "/logos/anthropic.svg",
      "/logos/opencode.svg",
      "/logos/githubcopilot.svg"
    ]);
    expect(logos.every((logo) => logo.getAttribute("alt") === "")).toBe(true);
  });

  it("shows OAuth guidance instead of fields for the sign-in provider", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: /GitHub Copilot/ }));
    expect(screen.getByText(/signs you in rather than taking a key/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Settings › Providers/ })).toBeTruthy();
    expect(screen.queryByLabelText("API key")).toBeNull();
    expect(screen.queryByLabelText("Model")).toBeNull();
    expect(screen.queryByLabelText("API base URL")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save and test" })).toBeNull();
  });

  it("places the fields directly under the selected provider on narrow viewports", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    }));
    try {
      renderFlow("admin");
      await gotoProviderStep();

      fireEvent.click(screen.getByRole("radio", { name: /^OpenAI \(/ }));
      const model = screen.getByLabelText("Model");
      const anthropic = screen.getByRole("radio", { name: /Anthropic \(/ });
      const copilot = screen.getByRole("radio", { name: /GitHub Copilot/ });

      expect(model.compareDocumentPosition(anthropic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(anthropic.compareDocumentPosition(copilot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(copilot.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();

      const presets = screen.getByRole("radiogroup", { name: "Model provider" });
      const card = screen.getByRole("radio", { name: /^OpenAI \(/ }).parentElement;
      expect(card?.parentElement).toBe(presets);
      expect(card).toContainElement(model);
      expect(card).toContainElement(screen.getByLabelText("API key"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("advances without saving when the sign-in provider is selected", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: /GitHub Copilot/ }));
    const next = screen.getByRole("button", { name: "Next" });
    expect(next.hasAttribute("disabled")).toBe(false);
    fireEvent.click(next);

    await waitFor(() => expect(screen.getByText("Add an MCP server")).toBeTruthy());
    const saved = vi
      .mocked(global.fetch)
      .mock.calls.filter(([url]) => String(url) === "/api/settings/providers");
    expect(saved).toHaveLength(0);
  });

  it("marks the custom endpoint tiles with a neutral plug instead of a brand logo", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    const custom = screen.getByRole("radiogroup", { name: "Custom endpoint" });
    expect(within(custom).queryAllByRole("img")).toHaveLength(0);
    expect(custom.querySelectorAll("svg.lucide-plug")).toHaveLength(2);
  });

  it("requires a base URL as well as a model for a custom endpoint", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: "Custom OpenAI compatible endpoint" }));
    // A custom endpoint has no model to suggest.
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("");

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "local-model" } });
    expect(saveButton().hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("API base URL"), {
      target: { value: "https://llm.internal/v1" }
    });
    expect(saveButton().hasAttribute("disabled")).toBe(false);
  });

  it("saves a custom endpoint with the kind chosen from its own group", async () => {
    renderFlow("admin");
    await gotoProviderStep();

    fireEvent.click(screen.getByRole("radio", { name: "Custom Anthropic compatible endpoint" }));
    fireEvent.change(screen.getByLabelText("API base URL"), {
      target: { value: "https://claude.internal" }
    });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "local-opus" } });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(
        vi.mocked(global.fetch).mock.calls.some(([url]) => String(url) === "/api/settings/providers")
      ).toBe(true)
    );
    const call = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) => String(url) === "/api/settings/providers");
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
      providerProfiles: Array<{ providerKind: string; providerConfig: Record<string, unknown> }>;
    };
    expect(body.providerProfiles[0].providerKind).toBe("anthropic");
    expect(body.providerProfiles[0].providerConfig).toEqual({
      apiBaseUrl: "https://claude.internal"
    });
  });

  it("can skip the provider and MCP steps", async () => {
    renderFlow("admin");
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(screen.getByText("Connect a model provider")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(screen.getByText("Add an MCP server")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => expect(screen.getByText("You're set up")).toBeTruthy());
  });

  it("saves the provider, then reports a successful connection test", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings/test") {
        return { ok: true, json: async () => ({ success: true, text: "connected" }) } as Response;
      }
      return { ok: true, json: async () => ({ settings: {} }) } as Response;
    });

    renderFlow("admin");
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Connect a model provider")).toBeTruthy());

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-test" } });
    // An edited model must reach the payload, not the preset's suggestion.
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "claude-haiku-4-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    await waitFor(() =>
      expect(screen.getByText("Connected. Your provider is ready.")).toBeTruthy()
    );

    const providerSave = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) => String(url) === "/api/settings/providers");
    expect(providerSave).toBeTruthy();
    const body = JSON.parse(String((providerSave?.[1] as RequestInit).body)) as {
      defaultProviderProfileId: string;
      providerProfiles: Array<{
        providerKind: string;
        credentialAction: string;
        model: string;
      }>;
    };
    expect(body.defaultProviderProfileId).toBe("prof_seed");
    expect(body.providerProfiles[0].providerKind).toBe("anthropic");
    expect(body.providerProfiles[0].credentialAction).toBe("replace");
    expect(body.providerProfiles[0].model).toBe("claude-haiku-4-5");
  });

  it("still lets the user continue when the connection test fails", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/settings/test") {
        return { ok: false, json: async () => ({ error: "401 Unauthorized" }) } as Response;
      }
      return { ok: true, json: async () => ({ settings: {} }) } as Response;
    });

    renderFlow("admin");
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Connect a model provider")).toBeTruthy());

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic \(/ }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and test" }));

    await waitFor(() => expect(screen.getByText("401 Unauthorized")).toBeTruthy());
    // Failure is a warning, not a wall.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Add an MCP server")).toBeTruthy());
  });

  /** Walks an admin to the MCP step, skipping the provider step. */
  async function gotoMcpStep() {
    await gotoProviderStep();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(screen.getByText("Add an MCP server")).toBeTruthy());
  }

  it("sends headers JSON with a streamable HTTP server", async () => {
    renderFlow("admin");
    await gotoMcpStep();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://mcp.example.com" }
    });
    fireEvent.change(screen.getByLabelText("Headers (JSON)"), {
      target: { value: '{"Authorization": "Bearer abc"}' }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await waitFor(() =>
      expect(
        vi.mocked(global.fetch).mock.calls.some(
          ([url, init]) => String(url) === "/api/mcp-servers" && (init as RequestInit)?.method === "POST"
        )
      ).toBe(true)
    );
    const call = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([url, init]) => String(url) === "/api/mcp-servers" && (init as RequestInit)?.method === "POST"
      );
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      transport: "streamable_http",
      name: "Docs",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer abc" }
    });
  });

  it("sends env JSON and parsed args with a stdio server", async () => {
    renderFlow("admin");
    await gotoMcpStep();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Fetch" } });
    fireEvent.change(screen.getByLabelText("Transport"), { target: { value: "stdio" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "npx" } });
    fireEvent.change(screen.getByLabelText("Args (JSON array or space-separated)"), {
      target: { value: "-y @modelcontextprotocol/server-fetch" }
    });
    fireEvent.change(screen.getByLabelText("Environment variables (JSON, optional)"), {
      target: { value: '{"API_KEY": "xyz"}' }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await waitFor(() =>
      expect(
        vi.mocked(global.fetch).mock.calls.some(
          ([url, init]) => String(url) === "/api/mcp-servers" && (init as RequestInit)?.method === "POST"
        )
      ).toBe(true)
    );
    const call = vi
      .mocked(global.fetch)
      .mock.calls.find(
        ([url, init]) => String(url) === "/api/mcp-servers" && (init as RequestInit)?.method === "POST"
      );
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      transport: "stdio",
      name: "Fetch",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-fetch"],
      env: { API_KEY: "xyz" }
    });
  });

  it("blocks saving on malformed JSON instead of silently dropping it", async () => {
    renderFlow("admin");
    await gotoMcpStep();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://mcp.example.com" }
    });
    expect(
      screen.getByRole("button", { name: "Save and continue" }).hasAttribute("disabled")
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Headers (JSON)"), {
      target: { value: "{not json" }
    });
    expect(screen.getByRole("alert").textContent).toContain("must be a JSON object");
    expect(
      screen.getByRole("button", { name: "Save and continue" }).hasAttribute("disabled")
    ).toBe(true);
  });

  it("omits the JSON payload entirely when left blank", async () => {
    renderFlow("admin");
    await gotoMcpStep();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://mcp.example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(
        vi.mocked(global.fetch).mock.calls.some(([url]) => String(url) === "/api/mcp-servers/test")
      ).toBe(true)
    );
    const call = vi
      .mocked(global.fetch)
      .mock.calls.find(([url]) => String(url) === "/api/mcp-servers/test");
    const body = JSON.parse(String((call?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect("headers" in body).toBe(false);
  });

  it("treats an HTTP 200 requiresAuth MCP response as needing authentication", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/mcp-servers/test") {
        return {
          ok: true,
          json: async () => ({ success: false, requiresAuth: true })
        } as Response;
      }
      return { ok: true, json: async () => ({ settings: {} }) } as Response;
    });

    renderFlow("admin");
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Connect a model provider")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(screen.getByText("Add an MCP server")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://mcp.example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText(/needs authentication/)).toBeTruthy());
  });

  it("reports the slug collision message when saving an MCP server fails", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/mcp-servers" && (init as RequestInit)?.method === "POST") {
        return {
          ok: false,
          json: async () => ({ error: "An MCP server with a similar name already exists." })
        } as Response;
      }
      return { ok: true, json: async () => ({ settings: {} }) } as Response;
    });

    renderFlow("admin");
    startFlow();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How should tool calls look?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Connect a model provider")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(screen.getByText("Add an MCP server")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://mcp.example.com" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    await waitFor(() =>
      expect(screen.getByText("An MCP server with a similar name already exists.")).toBeTruthy()
    );
    // Stayed on the step rather than advancing past the error.
    expect(screen.getByText("Add an MCP server")).toBeTruthy();
  });

  it("marks onboarding complete and lands the user in the app", async () => {
    renderFlow("user");
    startFlow();
    fireEvent.click(screen.getByRole("radio", { name: /Agents/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Step 2 of 2")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: /Single status line/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("You're set up")).toBeTruthy());

    expect(screen.getByText("Opening into Agents")).toBeTruthy();
    expect(screen.getByText("Tool activity shown as a single status line")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Start using Eidon" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockRefresh).toHaveBeenCalled();
    const finalCall = vi
      .mocked(global.fetch)
      .mock.calls.filter(([url]) => String(url) === "/api/onboarding")
      .at(-1);
    expect(JSON.parse(String((finalCall?.[1] as RequestInit).body))).toEqual({
      defaultView: "agents",
      toolCallDisplay: "status_line",
      completed: true
    });
  });
});
