// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProvidersSection } from "@/components/settings/sections/providers-section";
import { toProviderProfileSummary } from "@/lib/provider-profile";
import type { AppSettings, ProviderProfileSummary } from "@/lib/types";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

type ProviderProfileFixture = {
  id: string;
  providerKind: "openai_compatible" | "github_copilot" | "anthropic";
  name: string;
  apiBaseUrl: string;
  model: string;
  apiMode: "responses" | "chat_completions";
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
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
  providerPresetId: "ollama_cloud" | "glm_coding_plan" | "openai_official" | "openrouter" | "opencode_go" | "deepseek" | "xiaomi_mimo" | "anthropic_official" | "opencode_go_anthropic" | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubConnectionStatus: "disconnected" | "connected" | "expired";
  createdAt: string;
  updatedAt: string;
  hasApiKey: boolean;
};

type SettingsFixture = AppSettings & { providerProfiles: ProviderProfileSummary[] };

type SettingsOverrides = Partial<Omit<SettingsFixture, "providerProfiles">> & {
  providerProfiles?: Array<ProviderProfileFixture | ProviderProfileSummary | Record<string, unknown>>;
};

function normalizeProfile(profile: ProviderProfileFixture | ProviderProfileSummary | Record<string, unknown>) {
  const providerKind = profile.providerKind as ProviderProfileSummary["providerKind"];
  const legacy = profile as ProviderProfileFixture;
  const current = profile as ProviderProfileSummary;
  return toProviderProfileSummary(createRuntimeProviderProfile({
    ...profile,
    providerKind,
    providerConfig: "apiMode" in profile || "apiBaseUrl" in profile
      ? providerKind === "github_copilot"
        ? {}
        : providerKind === "anthropic"
          ? { apiBaseUrl: legacy.apiBaseUrl }
          : { apiBaseUrl: legacy.apiBaseUrl, apiMode: legacy.apiMode }
      : "providerConfig" in profile
      ? current.providerConfig
      : providerKind === "github_copilot"
        ? {}
        : providerKind === "anthropic"
          ? { apiBaseUrl: legacy.apiBaseUrl }
          : { apiBaseUrl: legacy.apiBaseUrl, apiMode: legacy.apiMode },
    credentials: providerKind === "github_copilot"
      ? {
          accessToken: ("connection" in profile
            ? current.connection.status !== "disconnected"
            : legacy.githubConnectionStatus !== "disconnected") ? "github-test-token" : undefined
        }
      : {
          apiKey: ("hasApiKey" in profile
            ? legacy.hasApiKey
            : "connection" in profile
            ? current.connection.status !== "disconnected"
            : false) ? "sk-test" : undefined
        },
    connectionMetadata: {
      accountLabel: "connection" in profile ? current.connection.accountLabel :
        legacy.githubAccountName ?? legacy.githubAccountLogin,
      expiresAt: "connection" in profile ? current.connection.expiresAt : legacy.githubTokenExpiresAt,
    }
  }));
}

function makeSettings(overrides: SettingsOverrides = {}): SettingsFixture {
  const settings = {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: true,
    memoriesMaxCount: 100,
    mcpTimeout: 120_000,
    maxAssistantToolSteps: 25,
    titleGenerationMode: "same",
    titleGenerationProfileId: null,
    webSearch: {
      providerId: "exa" as const,
      configuration: {},
      configured: true,
      credentialStored: false,
      scope: "global" as const
    },
    imageGeneration: {
      providerId: "disabled" as const,
      configuration: {},
      configured: true,
      credentialStored: false,
      scope: "global" as const
    },
    speechTranscription: {
      providerId: "browser" as const,
      configuration: { language: "en" as const },
      configured: true,
      credentialStored: false,
      scope: "global" as const
    },
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
  return {
    ...settings,
    providerProfiles: settings.providerProfiles.map(normalizeProfile)
  } as SettingsFixture;
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

    expect(screen.getByRole("button", { name: "Connect GitHub Copilot" })).toBeInTheDocument();
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

      if (url === "/api/providers/profile_copilot/models") {
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

    expect(profileNameInput).toHaveValue("Default");
    expect(apiBaseUrlInput).toHaveValue("https://openrouter.ai/api/v1");
    expect(modelInput).toHaveValue("");
  });

  it("applies request capabilities from the official provider preset", async () => {
    const { container } = render(
      React.createElement(ProvidersSection, { settings: makeSettings() })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    const presetSelect = screen.getByDisplayValue("Manual configuration");
    const apiBaseUrlInput = screen.getByDisplayValue("https://api.example.com/v1");
    const modelInput = container.querySelector<HTMLInputElement>(
      'input[name="provider-model"]'
    );

    expect(screen.getByRole("option", { name: "OpenAI" })).toBeInTheDocument();
    expect(container.querySelector('input[name="provider-temperature"]')).toBeInTheDocument();

    fireEvent.change(presetSelect, { target: { value: "openai_official" } });

    expect(apiBaseUrlInput).toHaveValue("https://api.openai.com/v1");
    expect(modelInput).toHaveValue("gpt-5.6-luna");
    expect(container.querySelector('input[name="provider-max-output-tokens"]')).toHaveValue(128000);
    expect(container.querySelector('input[name="provider-model-context-limit"]')).toHaveValue(1050000);
    expect(container.querySelector('input[name="provider-temperature"]')).not.toBeInTheDocument();
    expect(screen.getByText("This limit includes reasoning and visible output tokens.")).toBeInTheDocument();
    expect(screen.getByText("Long-context pricing applies above 272,000 input tokens.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "max" })).toBeInTheDocument();
    expect(presetSelect).toHaveValue("openai_official");

    const processingMode = container.querySelector<HTMLSelectElement>(
      'select[name="provider-processing-mode"]'
    );
    expect(processingMode).toHaveValue("standard");

    fireEvent.change(processingMode!, { target: { value: "fast" } });
    expect(processingMode).toHaveValue("fast");
    expect(screen.getByText(/lower-latency processing at a per-token premium/i)).toBeInTheDocument();

    fireEvent.change(modelInput!, { target: { value: "gpt-4.1-mini" } });
    expect(container.querySelector('input[name="provider-temperature"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "max" })).not.toBeInTheDocument();

    fireEvent.change(apiBaseUrlInput, { target: { value: "https://custom.example.com/v1" } });
    expect(container.querySelector('input[name="provider-temperature"]')).toBeInTheDocument();
    expect(container.querySelector('select[name="provider-processing-mode"]')).not.toBeInTheDocument();
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

  it("explicitly clears a stored key when switching provider presets", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const settings = makeSettings({
      providerProfiles: [{
        ...makeSettings().providerProfiles[0],
        hasApiKey: true
      }]
    });
    fetchMock.mockImplementation((input, init) => {
      if (String(input) === "/api/mcp-servers") {
        return Promise.resolve({ ok: true, json: async () => ({ servers: [] }) } as Response);
      }
      if (String(input) === "/api/settings/providers" && init?.method === "PUT") {
        return Promise.resolve({ ok: true, json: async () => ({ settings }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    const { container } = render(React.createElement(ProvidersSection, { settings }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers"));

    fireEvent.change(screen.getByDisplayValue("Manual configuration"), {
      target: { value: "openrouter" }
    });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[name="provider-model"]')!, {
      target: { value: "openai/gpt-5" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
    expect(body.providerProfiles[0]).toMatchObject({
      providerPresetId: "openrouter",
      credential: "",
      credentialAction: "clear"
    });
  });

  it("keeps a rejected provider save in the editor", async () => {
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      if (String(input) === "/api/mcp-servers") {
        return Promise.resolve({ ok: true, json: async () => ({ servers: [] }) } as Response);
      }
      if (String(input) === "/api/settings/providers" && init?.method === "PUT") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    render(React.createElement(ProvidersSection, { settings: makeSettings() }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers"));

    fireEvent.change(screen.getByDisplayValue("Default"), {
      target: { value: "Unsaved provider" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Unable to save settings")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Unsaved provider")).toBeInTheDocument();
  });

  it("treats a duplicated provider as an already saved profile", async () => {
    const settings = makeSettings();
    const copiedProfile = {
      ...settings.providerProfiles[0],
      id: "profile_copy",
      name: "Default copy"
    };
    vi.mocked(global.fetch).mockImplementation((input) => {
      if (String(input) === "/api/mcp-servers") {
        return Promise.resolve({ ok: true, json: async () => ({ servers: [] }) } as Response);
      }
      if (String(input) === "/api/settings/providers/duplicate") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            settings: { ...settings, providerProfiles: [...settings.providerProfiles, copiedProfile] }
          })
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    render(React.createElement(ProvidersSection, { settings }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers"));

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await screen.findByDisplayValue("Default copy");

    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("keeps a newly added provider dirty until it is saved", async () => {
    render(React.createElement(ProvidersSection, { settings: makeSettings() }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers"));

    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    await screen.findByDisplayValue("Profile 2");
    await waitFor(() => {
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Default"));

    expect(await screen.findByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
  });

  it("restores persisted skills without leaving a stale dirty baseline", async () => {
    const primary = makeSettings().providerProfiles[0];
    const settings = makeSettings({
      defaultProviderProfileId: "profile_primary",
      providerProfiles: [
        { ...primary, id: "profile_primary", name: "Primary" },
        { ...primary, id: "profile_backup", name: "Backup", model: "gpt-backup" }
      ]
    });
    render(React.createElement(ProvidersSection, { settings }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers"));

    const skillsCheckbox = screen.getByLabelText(
      "Make enabled skills available to every chat in this workspace"
    );
    fireEvent.click(skillsCheckbox);
    expect(skillsCheckbox).not.toBeChecked();
    fireEvent.click(screen.getByText("Backup"));
    fireEvent.click(await screen.findByRole("button", { name: "Don't save" }));

    await screen.findByDisplayValue("Backup");
    expect(screen.getByLabelText(
      "Make enabled skills available to every chat in this workspace"
    )).toBeChecked();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
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

    render(React.createElement(ProvidersSection, { settings }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.getByText("Fresh tail turns")).toBeInTheDocument();
    expect(screen.getByDisplayValue("80")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("80"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
        const body = JSON.parse(String(init.body)) as { defaultProviderProfileId: string };
        return Promise.resolve({
          ok: true,
          json: async () => ({
            settings: {
              ...settings,
              defaultProviderProfileId: body.defaultProviderProfileId
            }
          })
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

    fireEvent.change(screen.getByDisplayValue("80"), { target: { value: "75.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

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

  it("offers the Anthropic compatible provider type", async () => {
    render(React.createElement(ProvidersSection, { settings: makeSettings() }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.getByRole("option", { name: "Anthropic compatible" })).toBeInTheDocument();
  });

  it("hides the API mode control and lists only anthropic presets for an anthropic profile", async () => {
    render(
      React.createElement(ProvidersSection, {
        settings: makeSettings({
          defaultProviderProfileId: "profile_anthropic",
          providerProfiles: [
            {
              ...makeSettings().providerProfiles[0],
              id: "profile_anthropic",
              providerKind: "anthropic",
              name: "Claude",
              apiBaseUrl: "https://api.anthropic.com",
              model: "claude-opus-4-8",
              providerPresetId: "anthropic_official"
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.queryByRole("option", { name: "responses" })).toBeNull();
    expect(screen.getByRole("option", { name: "Anthropic" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ollama Cloud" })).toBeNull();
  });

  it("shows amber warning when visionMode is mcp and no enabled server has isVisionMcp", async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            servers: [
              {
                id: "mcp_plain",
                name: "Plain Server",
                slug: "plain",
                url: "https://plain.example.com",
                headers: {},
                transport: "streamable_http",
                command: null,
                args: null,
                env: null,
                enabled: true,
                isVisionMcp: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]
          })
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(
      React.createElement(ProvidersSection, {
        settings: makeSettings({
          providerProfiles: [
            {
              ...makeSettings().providerProfiles[0],
              visionMode: "mcp"
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.getByText(/no MCP server is marked as a Vision MCP/i)).toBeInTheDocument();
  });

  it("does not show amber warning when visionMode is mcp and an enabled server has isVisionMcp", async () => {
    vi.mocked(global.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/mcp-servers") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            servers: [
              {
                id: "mcp_vision",
                name: "Vision Server",
                slug: "vision",
                url: "https://vision.example.com",
                headers: {},
                transport: "streamable_http",
                command: null,
                args: null,
                env: null,
                enabled: true,
                isVisionMcp: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            ]
          })
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(
      React.createElement(ProvidersSection, {
        settings: makeSettings({
          providerProfiles: [
            {
              ...makeSettings().providerProfiles[0],
              visionMode: "mcp"
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.queryByText(/no MCP server is marked as a Vision MCP/i)).toBeNull();
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
        const body = JSON.parse(String(init.body)) as { defaultProviderProfileId: string };
        return Promise.resolve({
          ok: true,
          json: async () => ({
            settings: {
              ...settings,
              defaultProviderProfileId: body.defaultProviderProfileId
            }
          })
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

    const defaultCheckbox = screen.getByLabelText("Default provider");
    expect(defaultCheckbox).not.toBeChecked();
    fireEvent.click(defaultCheckbox);

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
    await waitFor(() => {
      expect(screen.getByLabelText("Default provider")).toBeChecked();
    });
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("uses the server-normalized provider profile as the clean baseline", async () => {
    const settings = makeSettings();
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      if (String(input) === "/api/mcp-servers") {
        return Promise.resolve({ ok: true, json: async () => ({ servers: [] }) } as Response);
      }
      if (String(input) === "/api/settings/providers" && init?.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ settings })
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });
    render(React.createElement(ProvidersSection, { settings }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers"));

    fireEvent.change(screen.getByDisplayValue("80"), { target: { value: "78" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByDisplayValue("80")).toBeInTheDocument());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("shows Thinking toggle instead of Reasoning effort for a mimo model in chat_completions mode", async () => {
    render(
      React.createElement(ProvidersSection, {
        settings: makeSettings({
          providerProfiles: [
            {
              ...makeSettings().providerProfiles[0],
              model: "mimo-v2.5",
              apiMode: "chat_completions",
              reasoningEffort: "medium"
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.getByLabelText("Enable thinking mode")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("medium")).toBeNull();
  });

  it("shows Reasoning effort dropdown for a model without extraBody thinking", async () => {
    render(
      React.createElement(ProvidersSection, {
        settings: makeSettings({
          providerProfiles: [
            {
              ...makeSettings().providerProfiles[0],
              model: "gpt-test",
              apiMode: "responses",
              reasoningEffort: "medium"
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.queryByLabelText("Enable thinking mode")).toBeNull();
  });

  it("sets reasoningEffort to none when the Thinking toggle is unchecked", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const settings = makeSettings({
      providerProfiles: [
        {
          ...makeSettings().providerProfiles[0],
          model: "deepseek-v4-flash",
          apiMode: "chat_completions",
          reasoningEffort: "medium",
          reasoningSummaryEnabled: true
        }
      ]
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
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(React.createElement(ProvidersSection, { settings }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers");
    });

    const thinkingCheckbox = screen.getByLabelText("Enable thinking mode");
    expect(thinkingCheckbox).toBeChecked();

    fireEvent.click(thinkingCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
    expect(body.providerProfiles[0].reasoningEffort).toBe("none");
  });

  it("hides Reasoning summary when Thinking toggle is shown", async () => {
    render(
      React.createElement(ProvidersSection, {
        settings: makeSettings({
          providerProfiles: [
            {
              ...makeSettings().providerProfiles[0],
              model: "mimo-v2.5",
              apiMode: "chat_completions",
              reasoningEffort: "medium",
              reasoningSummaryEnabled: true
            }
          ]
        })
      })
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/mcp-servers");
    });

    expect(screen.getByLabelText("Enable thinking mode")).toBeInTheDocument();
    expect(screen.queryByText("Show reasoning when supported")).toBeNull();
  });
});
