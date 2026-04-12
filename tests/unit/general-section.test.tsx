// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GeneralSection } from "@/components/settings/sections/general-section";
import type { AppSettings } from "@/lib/types";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh
  })
}));

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    defaultProviderProfileId: "profile_default",
    skillsEnabled: true,
    conversationRetention: "forever",
    memoriesEnabled: false,
    memoriesMaxCount: 3,
    mcpTimeout: 120_000,
    sttEngine: "browser",
    sttLanguage: "auto",
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
});
