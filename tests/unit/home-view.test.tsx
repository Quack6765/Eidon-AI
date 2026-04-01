// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HomeView } from "@/components/home-view";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push
  })
}));

function createProviderProfile() {
  return {
    id: "profile_default",
    name: "Default",
    apiBaseUrl: "https://api.example.com/v1",
    model: "gpt-5-mini",
    apiMode: "responses" as const,
    systemPrompt: "Be exact",
    temperature: 0.2,
    maxOutputTokens: 512,
    reasoningEffort: "medium" as const,
    reasoningSummaryEnabled: true,
    modelContextLimit: 16000,
    compactionThreshold: 0.8,
    freshTailCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasApiKey: true
  };
}

describe("home view", () => {
  beforeEach(() => {
    push.mockReset();
    sessionStorage.clear();
    global.fetch = vi.fn();
  });

  it("uses the shared composer and removes the old suggestion cards", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: {
          id: "conv_new"
        }
      })
    } as Response);

    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default"
      })
    );

    fireEvent.change(
      screen.getByPlaceholderText(
        "Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."
      ),
      {
        target: {
          value: "Start this thread"
        }
      }
    );

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/conversations",
        expect.objectContaining({
          method: "POST"
        })
      );
    });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/chat/conv_new");
    });

    expect(sessionStorage.getItem("hermes:chat-bootstrap:conv_new")).toContain(
      "Start this thread"
    );
    expect(screen.queryByText("Help me brainstorm ideas")).toBeNull();
  });
});
