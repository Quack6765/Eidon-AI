// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProvidersSection } from "@/components/settings/sections/providers-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

describe("providers section", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ servers: [], models: [] })
    } as Response);
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

    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).toBeNull();
  });

  it("shows fetched github models for a connected copilot profile", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [],
        models: [{ id: "openai/gpt-4.1", name: "GPT-4.1" }]
      })
    } as Response);

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
      expect(screen.getByRole("option", { name: "GPT-4.1" })).toBeInTheDocument();
    });
  });

  it("saves provider changes through the admin-only providers endpoint", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);

      if (url === "/api/mcp-servers") {
        return {
          ok: true,
          json: async () => ({ servers: [] })
        } as Response;
      }

      if (url === "/api/settings/providers") {
        return {
          ok: true,
          json: async () => ({ settings: {} })
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({ servers: [], models: [] })
      } as Response;
    });

    render(
      React.createElement(ProvidersSection, {
        settings: {
          defaultProviderProfileId: "profile_alpha",
          skillsEnabled: true,
          providerProfiles: [
            {
              id: "profile_alpha",
              providerKind: "openai_compatible",
              name: "Alpha",
              apiBaseUrl: "https://api.example.com/v1",
              model: "gpt-test",
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

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/settings/providers",
        expect.objectContaining({
          method: "PUT"
        })
      );
    });
  });
});
