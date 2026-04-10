// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProvidersSection } from "@/components/settings/sections/providers-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

function makeSettings(overrides = {}) {
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 100,
    mcpTimeout: 120_000,
    providerProfiles: [
      {
        id: "profile_default",
        providerKind: "openai_compatible",
        name: "Default",
        apiBaseUrl: "https://api.example.com/v1",
        model: "gpt-test",
        apiMode: "responses",
        systemPrompt: "Be exact.",
        temperature: 0.4,
        maxOutputTokens: 512,
        reasoningEffort: "medium",
        reasoningSummaryEnabled: true,
        modelContextLimit: 16384,
        compactionThreshold: 0.8,
        freshTailCount: 12,
        tokenizerModel: "gpt-tokenizer",
        safetyMarginTokens: 1200,
        leafSourceTokenLimit: 12000,
        leafMinMessageCount: 6,
        mergedMinNodeCount: 4,
        mergedTargetTokens: 1600,
        visionMode: "native",
        visionMcpServerId: null,
        githubTokenExpiresAt: null,
        githubRefreshTokenExpiresAt: null,
        githubAccountLogin: null,
        githubAccountName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hasApiKey: false,
        githubConnectionStatus: "disconnected"
      }
    ],
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("providers section", () => {
  beforeEach(() => {
    global.fetch = vi.fn((input) => {
      const url = String(input);

      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ servers: [], models: [] })
        } as Response);
      }

      if (url === "/api/settings") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            settings: makeSettings({
              conversationRetention: "30d",
              memoriesEnabled: false,
              memoriesMaxCount: 7,
              mcpTimeout: 45_000
            })
          })
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({})
      } as Response);
    });
  });

  it("shows github connection controls for copilot profiles", async () => {
    render(
      React.createElement(ProvidersSection, {
        settings: {
          defaultProviderProfileId: "profile_copilot",
          skillsEnabled: true,
          providerProfiles: [
            {
              id: "profile_copilot",
              providerKind: "github_copilot",
              name: "Copilot",
              apiBaseUrl: "",
              model: "openai/gpt-4.1",
              apiMode: "responses",
              systemPrompt: "Be exact.",
              temperature: 0.2,
              maxOutputTokens: 512,
              reasoningEffort: "medium",
              reasoningSummaryEnabled: true,
              modelContextLimit: 16000,
              compactionThreshold: 0.8,
              freshTailCount: 12,
              tokenizerModel: "gpt-tokenizer",
              safetyMarginTokens: 1200,
              leafSourceTokenLimit: 12000,
              leafMinMessageCount: 6,
              mergedMinNodeCount: 4,
              mergedTargetTokens: 1600,
              visionMode: "native",
              visionMcpServerId: null,
              githubAccountLogin: null,
              githubAccountName: null,
              githubTokenExpiresAt: null,
              githubRefreshTokenExpiresAt: null,
              githubConnectionStatus: "disconnected",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hasApiKey: false
            }
          ],
          updatedAt: new Date().toISOString()
        }
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  it("shows fetched github models for a connected copilot profile", async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);

      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ servers: [], models: [] })
        } as Response);
      }

      if (url.startsWith("/api/providers/github/models")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            models: [{ id: "openai/gpt-4.1", name: "GPT-4.1" }]
          })
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({})
      } as Response);
    });

    render(
      React.createElement(ProvidersSection, {
        settings: {
          defaultProviderProfileId: "profile_copilot",
          skillsEnabled: true,
          providerProfiles: [
            {
              id: "profile_copilot",
              providerKind: "github_copilot",
              name: "Copilot",
              apiBaseUrl: "",
              model: "openai/gpt-4.1",
              apiMode: "responses",
              systemPrompt: "Be exact.",
              temperature: 0.2,
              maxOutputTokens: 512,
              reasoningEffort: "medium",
              reasoningSummaryEnabled: true,
              modelContextLimit: 16000,
              compactionThreshold: 0.8,
              freshTailCount: 12,
              tokenizerModel: "gpt-tokenizer",
              safetyMarginTokens: 1200,
              leafSourceTokenLimit: 12000,
              leafMinMessageCount: 6,
              mergedMinNodeCount: 4,
              mergedTargetTokens: 1600,
              visionMode: "native",
              visionMcpServerId: null,
              githubAccountLogin: "octocat",
              githubAccountName: "The Octocat",
              githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              githubRefreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
              githubConnectionStatus: "connected",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hasApiKey: false
            }
          ],
          updatedAt: new Date().toISOString()
        }
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GPT-4.1" })).toBeInTheDocument();
    });
  });

  it("shows compaction threshold as a percent and preserves top-level settings on save", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const settings = makeSettings();

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ servers: [], models: [] })
        } as Response);
      }

      if (url === "/api/settings" && !init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            settings: {
              ...settings,
              conversationRetention: "7d",
              memoriesEnabled: false,
              memoriesMaxCount: 17,
              mcpTimeout: 240_000
            }
          })
        } as Response);
      }

      if (url === "/api/settings" && init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ settings: settings })
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({})
      } as Response);
    });

    const { container } = render(React.createElement(ProvidersSection, { settings }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers");
    });

    fireEvent.click(container.querySelectorAll("summary")[0]);

    expect(screen.getByText("Fresh tail turns")).toBeInTheDocument();
    expect(screen.getByDisplayValue("80")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("80"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PUT" }));
    });

    const putCall = fetchMock.mock.calls.find(([url, init]) => url === "/api/settings" && init?.method === "PUT");
    expect(putCall).toBeTruthy();

    const body = JSON.parse(String(putCall?.[1]?.body));

    expect(body).toMatchObject({
      defaultProviderProfileId: "profile_default",
      skillsEnabled: true,
      conversationRetention: "7d",
      memoriesEnabled: false,
      memoriesMaxCount: 17,
      mcpTimeout: 240_000
    });
    expect(body.providerProfiles).toHaveLength(1);
    expect(body.providerProfiles[0]).toMatchObject({
      id: "profile_default",
      compactionThreshold: 0.75,
      freshTailCount: 12
    });
  });
});
