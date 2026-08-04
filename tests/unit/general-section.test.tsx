// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";
import type {
  AppSettings,
  ConversationRetention,
  ImageGenerationModelId,
  ImageGenerationProviderId,
  WebSearchProviderId
} from "@/lib/types";
import type { ExternalSttLanguage } from "@/lib/speech/external-providers";
import type { SttEngine, SttLanguage } from "@/lib/speech/types";
import { getUnsavedChangesGuard } from "@/lib/unsaved-changes-guard";

const mockRefresh = vi.fn();

type GeneralSectionSettings = AppSettings & {
  providerProfiles: Array<{ id: string; name: string; model: string }>;
};

type GeneralSettingsOverrides = Partial<GeneralSectionSettings> & {
  sttEngine?: SttEngine;
  sttLanguage?: SttLanguage;
  externalSttLanguage?: ExternalSttLanguage;
  webSearchEngine?: WebSearchProviderId;
  searxngBaseUrl?: string;
  imageGenerationBackend?: ImageGenerationProviderId;
  googleNanoBananaModel?: ImageGenerationModelId;
  hasExaApiKey?: boolean;
  hasTavilyApiKey?: boolean;
  hasExternalSttApiKey?: boolean;
  hasGoogleNanoBananaApiKey?: boolean;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh
  })
}));

function makeSettings(overrides: GeneralSettingsOverrides = {}): GeneralSectionSettings {
  const speechProvider = overrides.sttEngine === "embedded"
    ? "canary"
    : overrides.sttEngine === "external"
      ? "elevenlabs"
      : "browser";
  const searchProvider = overrides.webSearchEngine ?? "exa";
  const imageProvider = overrides.imageGenerationBackend ?? "disabled";
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: false,
    memoriesMaxCount: 3,
    mcpTimeout: 120_000,
    maxAssistantToolSteps: 25,
    webSearch: !overrides.webSearchEngine && overrides.webSearch ? overrides.webSearch : {
      providerId: searchProvider,
      configuration: searchProvider === "searxng"
        ? { baseUrl: overrides.searxngBaseUrl ?? "" }
        : {},
      configured: searchProvider === "exa"
        ? overrides.hasExaApiKey ?? false
        : searchProvider === "tavily"
          ? overrides.hasTavilyApiKey ?? false
          : searchProvider === "searxng" ? Boolean(overrides.searxngBaseUrl) : true,
      credentialStored: searchProvider === "exa"
        ? overrides.hasExaApiKey ?? false
        : searchProvider === "tavily"
          ? overrides.hasTavilyApiKey ?? false
          : false,
      scope: "user"
    },
    speechTranscription: !overrides.sttEngine && overrides.speechTranscription ? overrides.speechTranscription : {
      providerId: speechProvider,
      configuration: {
        language: speechProvider === "elevenlabs"
          ? overrides.externalSttLanguage ?? "auto"
          : overrides.sttLanguage ?? "auto"
      },
      configured: speechProvider === "elevenlabs"
        ? overrides.hasExternalSttApiKey ?? false
        : true,
      credentialStored: speechProvider === "elevenlabs"
        ? overrides.hasExternalSttApiKey ?? false
        : false,
      scope: "user"
    },
    imageGeneration: !overrides.imageGenerationBackend && overrides.imageGeneration ? overrides.imageGeneration : {
      providerId: imageProvider,
      configuration: imageProvider === "google_nano_banana"
        ? { model: overrides.googleNanoBananaModel ?? "gemini-3.1-flash-image-preview" }
        : {},
      configured: imageProvider === "google_nano_banana"
        ? overrides.hasGoogleNanoBananaApiKey ?? false
        : true,
      credentialStored: imageProvider === "google_nano_banana"
        ? overrides.hasGoogleNanoBananaApiKey ?? false
        : false,
      scope: "global"
    },
    updatedAt: new Date().toISOString(),
    providerProfiles: [],
    titleGenerationMode: "same",
    titleGenerationProfileId: null,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => [
      "defaultProviderProfileId", "skillsEnabled", "conversationRetention",
      "memoriesEnabled", "memoriesMaxCount", "mcpTimeout", "maxAssistantToolSteps",
      "titleGenerationMode", "titleGenerationProfileId", "providerProfiles", "updatedAt",
      "webSearch", "speechTranscription", "imageGeneration"
    ].includes(key)))
  };
}

describe("general section", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    global.fetch = vi.fn();
  });

  it("hides auto-compaction and saves general settings through the per-user endpoint", async () => {
    const settings = makeSettings();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    expect(screen.queryByText("Auto-Compaction")).toBeNull();
    expect(screen.queryByLabelText("Enable auto-compaction")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("Forever"), { target: { value: "30d" } });
    fireEvent.change(screen.getByLabelText("Max tool call timeout"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const putCall = vi.mocked(global.fetch).mock.calls[0];
    expect(putCall[0]).toBe("/api/settings/general");
    expect(putCall[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    });

    const body = JSON.parse(String(putCall[1]?.body));

    expect(body.preferences).toMatchObject({
      conversationRetention: "30d",
      mcpTimeout: 45_000
    });
    expect(body.preferences).not.toHaveProperty("autoCompaction");
  });

  it("saves speech engine and default language through the general settings endpoint", async () => {
    const settings = makeSettings({
      sttEngine: "browser",
      sttLanguage: "auto"
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    fireEvent.change(screen.getByDisplayValue("Browser"), { target: { value: "embedded" } });
    fireEvent.change(screen.getByDisplayValue("English"), { target: { value: "es" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.speechTranscription).toMatchObject({
      providerId: "canary",
      configuration: { language: "es" },
      credentialAction: "clear"
    });
  });

  it("defaults browser dictation to auto-detect and hides auto-detect for embedded mode", async () => {
    const settings = makeSettings({
      sttEngine: "browser",
      sttLanguage: "auto"
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    expect(screen.getByDisplayValue("Auto-detect")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Browser"), { target: { value: "embedded" } });
    expect(screen.queryByDisplayValue("Auto-detect")).toBeNull();
    expect(screen.getByDisplayValue("English")).toBeInTheDocument();
    expect(screen.getByText("Canary 180M Flash")).toBeInTheDocument();
    expect(screen.getByText(/downloads only when embedded dictation is first used/)).toBeInTheDocument();
  });

  it("reveals ElevenLabs provider credentials after External is selected", () => {
    render(React.createElement(GeneralSection, { settings: makeSettings() }));

    expect(screen.queryByLabelText("Speech-to-text provider")).toBeNull();
    expect(screen.queryByLabelText("ElevenLabs API key")).toBeNull();

    fireEvent.change(screen.getByLabelText("Speech engine"), {
      target: { value: "external" }
    });

    expect(screen.getByLabelText("Speech-to-text provider")).toHaveValue("elevenlabs");
    expect(screen.getByText("ElevenLabs · Scribe v2")).toBeInTheDocument();
    expect(screen.getByLabelText("ElevenLabs API key")).toHaveAttribute(
      "placeholder",
      "Required"
    );
    const language = screen.getByLabelText("ElevenLabs transcription language");
    expect(language).toHaveValue("auto");
    expect((language as HTMLSelectElement).options[0]).toHaveTextContent("Automatic");
    expect(screen.queryByDisplayValue("Auto-detect")).toBeNull();
  });

  it("requires and saves an ElevenLabs key for External transcription", async () => {
    const settings = makeSettings();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        settings: makeSettings({
          sttEngine: "external",
          hasExternalSttApiKey: true
        })
      })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));
    fireEvent.change(screen.getByLabelText("Speech engine"), {
      target: { value: "external" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await screen.findByText("ElevenLabs API key is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ElevenLabs API key"), {
      target: { value: "xi-test-key" }
    });
    fireEvent.change(screen.getByLabelText("ElevenLabs transcription language"), {
      target: { value: "fra" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.speechTranscription).toMatchObject({
      providerId: "elevenlabs",
      configuration: { language: "fra" },
      credential: "xi-test-key",
      credentialAction: "replace"
    });
  });

  it("shows AssemblyAI model-specific languages and resets unsupported selections", () => {
    render(React.createElement(GeneralSection, { settings: makeSettings() }));

    fireEvent.change(screen.getByLabelText("Speech engine"), {
      target: { value: "external" }
    });
    fireEvent.change(screen.getByLabelText("Speech-to-text provider"), {
      target: { value: "assemblyai" }
    });

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByLabelText("AssemblyAI API key")).toHaveAttribute(
      "placeholder",
      "Required"
    );
    expect(screen.getByLabelText("AssemblyAI transcription model")).toHaveValue(
      "universal-3-5-pro"
    );
    expect(screen.getByLabelText("AssemblyAI transcription language")).toHaveValue("auto");
    expect(screen.getByText(/most reliable with at least 15 seconds/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Swahili" })).toBeNull();

    fireEvent.change(screen.getByLabelText("AssemblyAI transcription model"), {
      target: { value: "universal-2" }
    });
    expect(screen.getByRole("option", { name: "Swahili" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription language"), {
      target: { value: "fr" }
    });
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription model"), {
      target: { value: "universal-3-5-pro" }
    });
    expect(screen.getByLabelText("AssemblyAI transcription language")).toHaveValue("fr");
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription model"), {
      target: { value: "universal-2" }
    });
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription language"), {
      target: { value: "sw" }
    });
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription model"), {
      target: { value: "universal-3-5-pro" }
    });
    expect(screen.getByLabelText("AssemblyAI transcription language")).toHaveValue("auto");
  });

  it("requires and saves the selected AssemblyAI model, language, and key", async () => {
    const settings = makeSettings();
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));
    fireEvent.change(screen.getByLabelText("Speech engine"), {
      target: { value: "external" }
    });
    fireEvent.change(screen.getByLabelText("Speech-to-text provider"), {
      target: { value: "assemblyai" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await screen.findByText("AssemblyAI API key is required.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("AssemblyAI API key"), {
      target: { value: "assembly-test-key" }
    });
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription model"), {
      target: { value: "universal-2" }
    });
    fireEvent.change(screen.getByLabelText("AssemblyAI transcription language"), {
      target: { value: "sw" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.speechTranscription).toMatchObject({
      providerId: "assemblyai",
      configuration: { model: "universal-2", language: "sw" },
      credential: "assembly-test-key",
      credentialAction: "replace"
    });
  });

  it("shows Exa by default with an optional API key note", () => {
    render(React.createElement(GeneralSection, { settings: makeSettings() }));

    expect(screen.getByRole("heading", { name: "Web Search" })).toBeInTheDocument();
    expect(screen.getByLabelText("Web search engine")).toHaveValue("exa");
    expect(
      screen.getByText("Exa API key is optional and the public endpoint works without one.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Exa API key")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tavily API key")).toBeNull();
    expect(screen.queryByLabelText("SearXNG base URL")).toBeNull();
  });

  it("preserves search values while switching engines and hides engine-specific fields when disabled", () => {
    render(React.createElement(GeneralSection, { settings: makeSettings() }));

    fireEvent.change(screen.getByLabelText("Exa API key"), {
      target: { value: "exa-local-key" }
    });
    fireEvent.change(screen.getByLabelText("Web search engine"), {
      target: { value: "tavily" }
    });
    fireEvent.change(screen.getByLabelText("Tavily API key"), {
      target: { value: "tvly-local-key" }
    });
    fireEvent.change(screen.getByLabelText("Web search engine"), {
      target: { value: "searxng" }
    });
    fireEvent.change(screen.getByLabelText("SearXNG base URL"), {
      target: { value: "https://search.example.com" }
    });

    fireEvent.change(screen.getByLabelText("Web search engine"), {
      target: { value: "tavily" }
    });
    expect(screen.getByLabelText("Tavily API key")).toHaveValue("tvly-local-key");

    fireEvent.change(screen.getByLabelText("Web search engine"), {
      target: { value: "exa" }
    });
    expect(screen.getByLabelText("Exa API key")).toHaveValue("exa-local-key");

    fireEvent.change(screen.getByLabelText("Web search engine"), {
      target: { value: "searxng" }
    });
    expect(screen.getByLabelText("SearXNG base URL")).toHaveValue("https://search.example.com");

    fireEvent.change(screen.getByLabelText("Web search engine"), {
      target: { value: "disabled" }
    });
    expect(screen.queryByLabelText("Exa API key")).toBeNull();
    expect(screen.queryByLabelText("Tavily API key")).toBeNull();
    expect(screen.queryByLabelText("SearXNG base URL")).toBeNull();
  });

  it("blocks save for Tavily when no key is present", async () => {
    render(
      React.createElement(GeneralSection, {
        settings: makeSettings({
          webSearchEngine: "tavily"
        })
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await screen.findByText("Tavily API key is required.")).toBeInTheDocument();
  });

  it("blocks save for SearXNG when no base URL is present", async () => {
    render(
      React.createElement(GeneralSection, {
        settings: makeSettings({
          webSearchEngine: "searxng"
        })
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await screen.findByText("SearXNG base URL is required.")).toBeInTheDocument();
  });

  it("blocks save for SearXNG when the URL is malformed", async () => {
    render(
      React.createElement(GeneralSection, {
        settings: makeSettings({
          webSearchEngine: "searxng"
        })
      })
    );

    fireEvent.change(screen.getByLabelText("SearXNG base URL"), {
      target: { value: "not-a-url" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(await screen.findByText("SearXNG base URL must be valid.")).toBeInTheDocument();
  });

  it("preserves masked Tavily keys by omitting blank values from the save payload", async () => {
    const settings = makeSettings({
      webSearchEngine: "tavily",
      hasTavilyApiKey: true
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    fireEvent.change(screen.getByDisplayValue("Forever"), { target: { value: "30d" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.preferences).toMatchObject({
      conversationRetention: "30d"
    });
    expect(body.webSearch).toMatchObject({ providerId: "tavily", credentialAction: "preserve" });
    expect(body.webSearch).not.toHaveProperty("credential");
  });

  it("renders masked placeholders for stored Exa and Tavily API keys", () => {
    const { unmount } = render(
      React.createElement(GeneralSection, {
        settings: makeSettings({
          webSearchEngine: "exa",
          hasExaApiKey: true
        })
      })
    );

    expect(screen.getByLabelText("Exa API key")).toHaveAttribute("placeholder", "••••••••");
    unmount();

    render(
      React.createElement(GeneralSection, {
        settings: makeSettings({
          webSearchEngine: "tavily",
          hasTavilyApiKey: true
        })
      })
    );

    expect(screen.getByLabelText("Tavily API key")).toHaveAttribute("placeholder", "••••••••");
  });

  it("sends an explicit clear flag when a saved Exa key is intentionally cleared", async () => {
    const settings = makeSettings({
      webSearchEngine: "exa",
      hasExaApiKey: true
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    const exaInput = screen.getByLabelText("Exa API key");
    fireEvent.change(exaInput, { target: { value: "temporary-value" } });
    fireEvent.change(exaInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.webSearch).toMatchObject({ providerId: "exa", credentialAction: "clear" });
    expect(body.webSearch).not.toHaveProperty("credential");
  });

  it("sends an explicit clear flag when a saved Tavily key is intentionally cleared before switching engines", async () => {
    const settings = makeSettings({
      webSearchEngine: "tavily",
      hasTavilyApiKey: true
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    const tavilyInput = screen.getByLabelText("Tavily API key");
    fireEvent.change(tavilyInput, { target: { value: "temporary-value" } });
    fireEvent.change(tavilyInput, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Web search engine"), { target: { value: "exa" } });
    fireEvent.change(screen.getByDisplayValue("Forever"), { target: { value: "30d" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.preferences).toMatchObject({ conversationRetention: "30d" });
    expect(body.webSearch).toMatchObject({ providerId: "exa", credentialAction: "clear" });
  });

  it("renders an image generation card under web search and saves through the global save button", async () => {
    const settings = makeSettings({
      imageGenerationBackend: "google_nano_banana",
      googleNanoBananaModel: "gemini-3.1-flash-image-preview",
      hasGoogleNanoBananaApiKey: true
    });

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings })
      } as Response);

    render(
      React.createElement(GeneralSection, {
        settings,
        canManageGlobalIntegrations: true
      })
    );

    expect(screen.getByRole("heading", { name: "Image Generation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Image generation backend")).toHaveValue("google_nano_banana");
    expect(screen.queryByRole("option", { name: "ComfyUI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Test ComfyUI workflow" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const imageSettingsCall = vi.mocked(global.fetch).mock.calls[0];
    const imageSettingsBody = JSON.parse(String(imageSettingsCall?.[1]?.body));

    expect(imageSettingsBody.imageGeneration).toEqual({
      providerId: "google_nano_banana",
      configuration: { model: "gemini-3.1-flash-image-preview" },
      credentialAction: "preserve"
    });
  });

  it("sends an explicit clear action for an intentionally cleared Google image key", async () => {
    const settings = makeSettings({
      imageGenerationBackend: "google_nano_banana",
      hasGoogleNanoBananaApiKey: true
    });
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(React.createElement(GeneralSection, { settings, canManageGlobalIntegrations: true }));
    fireEvent.click(screen.getByRole("button", { name: "Clear stored key" }));
    expect(screen.getByText("Stored key will be cleared when you save.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.imageGeneration).toMatchObject({ credentialAction: "clear" });
    expect(body.imageGeneration).not.toHaveProperty("credential");
  });

  it("lets an admin undo a pending Google image key clear", () => {
    const settings = makeSettings({
      imageGenerationBackend: "google_nano_banana",
      hasGoogleNanoBananaApiKey: true
    });

    render(React.createElement(GeneralSection, { settings, canManageGlobalIntegrations: true }));

    expect(screen.getByRole("button", { name: "Clear stored key" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear stored key" }));

    expect(screen.getByRole("status")).toHaveTextContent("Stored key will be cleared when you save.");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep stored key" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(screen.getByRole("button", { name: "Clear stored key" })).toBeInTheDocument();
    expect(screen.getByLabelText("Google Nano Banana API key")).toHaveAttribute("placeholder", "••••••••");
  });

  it("discards to the latest successful save instead of the initial props", async () => {
    const settings = makeSettings();
    vi.mocked(global.fetch).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        preferences: { conversationRetention: ConversationRetention };
      };
      return {
        ok: true,
        json: async () => ({
          settings: makeSettings({
            ...settings,
            conversationRetention: body.preferences.conversationRetention
          })
        })
      } as Response;
    });
    render(React.createElement(GeneralSection, { settings }));

    fireEvent.change(screen.getByDisplayValue("Forever"), { target: { value: "30d" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByDisplayValue("30 days"), { target: { value: "7d" } });
    await act(async () => {
      getUnsavedChangesGuard()?.discard();
    });

    expect(screen.getByDisplayValue("30 days")).toBeInTheDocument();
  });

  it("adopts the normalized server response as the saved baseline", async () => {
    const settings = makeSettings({
      webSearchEngine: "searxng",
      searxngBaseUrl: "https://search.example.com"
    });
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: makeSettings({
          ...settings,
          searxngBaseUrl: "https://search.example.com"
        })
      })
    } as Response);
    render(React.createElement(GeneralSection, { settings }));

    fireEvent.change(screen.getByLabelText("SearXNG base URL"), {
      target: { value: "https://search.example.com///" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByLabelText("SearXNG base URL")).toHaveValue(
        "https://search.example.com"
      );
    });
    fireEvent.change(screen.getByLabelText("SearXNG base URL"), {
      target: { value: "https://different.example.com" }
    });
    await act(async () => {
      getUnsavedChangesGuard()?.discard();
    });
    expect(screen.getByLabelText("SearXNG base URL")).toHaveValue(
      "https://search.example.com"
    );
  });

  it("uses the latest dirty draft when navigation invokes the registered save guard", async () => {
    const settings = makeSettings();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ settings })
    } as Response);
    render(React.createElement(GeneralSection, { settings }));

    fireEvent.change(screen.getByDisplayValue("Forever"), { target: { value: "30d" } });
    await waitFor(() => expect(getUnsavedChangesGuard()).not.toBeNull());
    fireEvent.change(screen.getByDisplayValue("30 days"), { target: { value: "7d" } });
    await act(async () => {
      await getUnsavedChangesGuard()?.save();
    });

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body.preferences.conversationRetention).toBe("7d");
  });

  it("renders the image generation card as read-only for non-admin users", () => {
    render(
      React.createElement(GeneralSection, {
        settings: makeSettings(),
        canManageGlobalIntegrations: false
      })
    );

    expect(screen.getByText("Only admins can change image generation settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Image generation backend")).toBeDisabled();
    expect(screen.queryByRole("option", { name: "ComfyUI" })).toBeNull();
  });
});
