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
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("general section", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    global.fetch = vi.fn();
  });

  it("hides auto-compaction and preserves unrelated settings when saving", async () => {
    const settings = makeSettings();
    const settingsResponse = {
      ...settings,
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
      ]
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings: settingsResponse })
    } as Response);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ settings: settingsResponse })
    } as Response);

    render(React.createElement(GeneralSection, { settings }));

    expect(screen.queryByText("Auto-Compaction")).toBeNull();
    expect(screen.queryByLabelText("Enable auto-compaction")).toBeNull();

    fireEvent.change(screen.getByDisplayValue("Forever"), { target: { value: "30d" } });
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const putCall = vi.mocked(global.fetch).mock.calls[1];
    expect(putCall[0]).toBe("/api/settings");
    expect(putCall[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    });

    const body = JSON.parse(String(putCall[1]?.body));

    expect(body).toMatchObject({
      defaultProviderProfileId: "profile_default",
      skillsEnabled: true,
      conversationRetention: "30d",
      memoriesEnabled: false,
      memoriesMaxCount: 3,
      mcpTimeout: 45_000,
      providerProfiles: settingsResponse.providerProfiles
    });
    expect(body).not.toHaveProperty("autoCompaction");
  });
});
