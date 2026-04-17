// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProvidersSection } from "@/components/settings/sections/providers-section";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

type ProviderProfileFixture = {
  id: string;
  providerKind: "openai_compatible" | "github_copilot";
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: "responses" | "chat_completions";
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  compactionThreshold: number;
  freshTailCount: number;
  tokenizerModel: "gpt-tokenizer" | "off";
  safetyMarginTokens: number;
  leafSourceTokenLimit: number;
  leafMinMessageCount: number;
  mergedMinNodeCount: number;
  mergedTargetTokens: number;
  visionMode: "none" | "native" | "mcp";
  visionMcpServerId: string | null;
  providerPresetId: "ollama_cloud" | "glm_coding_plan" | "openrouter" | "custom_openai_compatible" | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubConnectionStatus: "disconnected" | "connected" | "expired";
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
};

type SettingsFixture = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  conversationRetention: "forever" | "90d" | "30d" | "7d";
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  mcpTimeout: number;
  sttEngine: "browser" | "embedded";
  sttLanguage: "auto" | "en" | "fr" | "es";
  webSearchEngine: "exa" | "tavily" | "searxng" | "disabled";
  exaApiKey: string;
  tavilyApiKey: string;
  searxngBaseUrl: string;
  imageGenerationBackend: "disabled" | "google_nano_banana";
  googleNanoBananaModel: "gemini-2.5-flash-image" | "gemini-3.1-flash-image-preview" | "gemini-3-pro-image-preview";
  googleNanoBananaApiKey: string;
  providerProfiles: ProviderProfileFixture[];
  updatedAt: string;
};

function makeSettings(overrides: Partial<SettingsFixture> = {}): SettingsFixture {
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 100,
    mcpTimeout: 120_000,
    sttEngine: "browser",
    sttLanguage: "en",
    webSearchEngine: "exa",
    exaApiKey: "",
    tavilyApiKey: "",
    searxngBaseUrl: "",
    imageGenerationBackend: "disabled",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "",
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
        providerPresetId: null,
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
        settings: makeSettings({
          defaultProviderProfileId: "profile_copilot",
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
              providerPresetId: null,
              githubAccountLogin: null,
              githubAccountName: null,
              githubTokenExpiresAt: null,
              githubRefreshTokenExpiresAt: null,
              githubConnectionStatus: "disconnected",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hasApiKey: false
            }
          ]
        })
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
        settings: makeSettings({
          defaultProviderProfileId: "profile_copilot",
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
              providerPresetId: null,
              githubAccountLogin: "octocat",
              githubAccountName: "The Octocat",
              githubTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
              githubRefreshTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
              githubConnectionStatus: "connected",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              hasApiKey: false
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "GPT-4.1" })).toBeInTheDocument();
    });
  });

  it("applies the OpenRouter preset from the providers settings dropdown", async () => {
    const { container } = render(React.createElement(ProvidersSection, { settings: makeSettings() }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    const presetSelect = screen.getByDisplayValue("Manual configuration");
    const profileNameInput = screen.getByDisplayValue("Default");
    const apiBaseUrlInput = screen.getByDisplayValue("https://api.example.com/v1");
    const modelInput = container.querySelector<HTMLInputElement>('input[name="provider-model"]');

    expect(screen.getByRole("option", { name: "OpenRouter" })).toBeInTheDocument();
    expect(modelInput).toBeTruthy();
    expect(modelInput).toHaveValue("gpt-test");

    fireEvent.change(presetSelect, {
      target: { value: "openrouter" }
    });

    expect(profileNameInput).toHaveValue("OpenRouter");
    expect(apiBaseUrlInput).toHaveValue("https://openrouter.ai/api/v1");
    expect(modelInput).toHaveValue("");
  });

  it("keeps the selected preset when the model changes", async () => {
    const { container } = render(React.createElement(ProvidersSection, { settings: makeSettings() }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    const presetSelect = screen.getByDisplayValue("Manual configuration");
    const modelInput = container.querySelector<HTMLInputElement>('input[name="provider-model"]');

    fireEvent.change(presetSelect, { target: { value: "openrouter" } });
    expect(presetSelect).toHaveValue("openrouter");

    fireEvent.change(modelInput!, { target: { value: "custom-model" } });
    expect(presetSelect).toHaveValue("openrouter");
  });

  it("switches to Manual configuration when the API base URL changes", async () => {
    const { container } = render(React.createElement(ProvidersSection, { settings: makeSettings() }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    const presetSelect = screen.getByDisplayValue("Manual configuration");
    const apiBaseUrlInput = screen.getByDisplayValue("https://api.example.com/v1");

    fireEvent.change(presetSelect, { target: { value: "openrouter" } });
    expect(presetSelect).toHaveValue("openrouter");

    fireEvent.change(apiBaseUrlInput, { target: { value: "https://custom.api.com/v1" } });
    expect(presetSelect).toHaveValue("");
  });

  it("shows compaction threshold as a percent and preserves top-level settings on save", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const settings = makeSettings({
      conversationRetention: "7d",
      memoriesEnabled: false,
      memoriesMaxCount: 17,
      mcpTimeout: 240_000
    });

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ servers: [], models: [] })
        } as Response);
      }

      if (url === "/api/settings/providers" && init?.method === "PUT") {
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
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/providers",
        expect.objectContaining({ method: "PUT" })
      );
    });

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/settings/providers" && init?.method === "PUT"
    );
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

  it("rounds fractional percent input before saving", async () => {
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

      if (url === "/api/settings/providers" && init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ settings })
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
    fireEvent.change(screen.getByDisplayValue("80"), { target: { value: "75.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/providers",
        expect.objectContaining({ method: "PUT" })
      );
    });

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/settings/providers" && init?.method === "PUT"
    );
    const body = JSON.parse(String(putCall?.[1]?.body));

    expect(body.providerProfiles[0].compactionThreshold).toBe(0.76);
  });

  it("persists the default profile when clicking Set Default", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const settings = makeSettings({
      providerProfiles: [
        {
          id: "profile_primary",
          providerKind: "openai_compatible",
          name: "Primary",
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
          providerPresetId: null,
          githubTokenExpiresAt: null,
          githubRefreshTokenExpiresAt: null,
          githubAccountLogin: null,
          githubAccountName: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          hasApiKey: false,
          githubConnectionStatus: "disconnected"
        },
        {
          id: "profile_backup",
          providerKind: "openai_compatible",
          name: "Backup",
          apiBaseUrl: "https://api.example.com/v1",
          model: "gpt-backup",
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
          providerPresetId: null,
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
      defaultProviderProfileId: "profile_primary"
    });

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ servers: [], models: [] })
        } as Response);
      }

      if (url === "/api/settings/providers" && init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ settings })
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({})
      } as Response);
    });

    render(React.createElement(ProvidersSection, { settings }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers");
    });

    fireEvent.click(screen.getByText("Backup"));
    fireEvent.click(screen.getByRole("button", { name: "Set Default" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/providers",
        expect.objectContaining({ method: "PUT" })
      );
    });

    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/settings/providers" && init?.method === "PUT"
    );
    const body = JSON.parse(String(putCall?.[1]?.body));

    expect(body.defaultProviderProfileId).toBe("profile_backup");
    expect(screen.getByRole("button", { name: "Is Default" })).toBeInTheDocument();
  });
});
