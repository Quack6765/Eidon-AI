// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";
import type { AppSettings } from "@/lib/types";

const mockRefresh = vi.fn();

type GeneralSectionSettings = AppSettings & {
  hasExaApiKey?: boolean;
  hasTavilyApiKey?: boolean;
  hasGoogleNanoBananaApiKey?: boolean;
  hasComfyuiBearerToken?: boolean;
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh
  })
}));

function makeSettings(overrides: Partial<GeneralSectionSettings> = {}): GeneralSectionSettings {
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: false,
    memoriesMaxCount: 3,
    mcpTimeout: 120_000,
    sttEngine: "browser",
    sttLanguage: "auto",
    webSearchEngine: "exa",
    exaApiKey: "",
    tavilyApiKey: "",
    searxngBaseUrl: "",
    imageGenerationBackend: "disabled",
    googleNanoBananaModel: "gemini-3.1-flash-image-preview",
    googleNanoBananaApiKey: "",
    comfyuiBaseUrl: "",
    comfyuiAuthType: "none",
    comfyuiBearerToken: "",
    comfyuiWorkflowJson: "",
    comfyuiPromptPath: "",
    comfyuiNegativePromptPath: "",
    comfyuiWidthPath: "",
    comfyuiHeightPath: "",
    comfyuiSeedPath: "",
    hasExaApiKey: false,
    hasTavilyApiKey: false,
    updatedAt: new Date().toISOString(),
    ...overrides
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
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

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

    expect(body).toMatchObject({
      conversationRetention: "30d",
      mcpTimeout: 45_000
    });
    expect(body).not.toHaveProperty("autoCompaction");
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
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      sttEngine: "embedded",
      sttLanguage: "es"
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

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      conversationRetention: "30d",
      webSearchEngine: "tavily"
    });
    expect(body).not.toHaveProperty("tavilyApiKey");
    expect(body).not.toHaveProperty("clearTavilyApiKey");
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
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      webSearchEngine: "exa",
      exaApiKey: "",
      clearExaApiKey: true
    });
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
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      conversationRetention: "30d",
      webSearchEngine: "exa",
      tavilyApiKey: "",
      clearTavilyApiKey: true
    });
  });

  it("renders an image generation card under web search and saves through the image settings route", async () => {
    const settings = makeSettings({
      imageGenerationBackend: "google_nano_banana",
      googleNanoBananaModel: "gemini-3.1-flash-image-preview",
      hasGoogleNanoBananaApiKey: true
    });

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings })
    } as Response);

    render(
      React.createElement(GeneralSection, {
        settings,
        canManageImageGeneration: true
      })
    );

    expect(screen.getByRole("heading", { name: "Image Generation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Image generation backend")).toHaveValue("google_nano_banana");

    fireEvent.click(screen.getByRole("button", { name: "Save image settings" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/settings/image-generation",
        expect.objectContaining({ method: "PUT" })
      );
    });
  });

  it("renders the image generation card as read-only for non-admin users", () => {
    render(
      React.createElement(GeneralSection, {
        settings: makeSettings(),
        canManageImageGeneration: false
      })
    );

    expect(screen.getByText("Only admins can change image generation settings.")).toBeInTheDocument();
    expect(screen.getByLabelText("Image generation backend")).toBeDisabled();
  });
});
