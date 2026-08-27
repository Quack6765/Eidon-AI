// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { HomeView } from "@/components/home-view";
import type { SpeechSessionSnapshot, SttEngine, SttLanguage } from "@/lib/speech/types";

const push = vi.fn();

const speechMock = vi.hoisted(() => {
  const audioMonitor = {
    readLevel: vi.fn(() => 0.48),
    dispose: vi.fn()
  };

  const createSpeechEngine = vi.fn((engine: SttEngine) => ({
    isSupported: vi.fn(() => engine === "browser"),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ transcript: "home transcript" })),
    dispose: vi.fn()
  }));

  const createSpeechController = vi.fn((input: { audioMonitor: typeof audioMonitor }) => {
    let snapshot: SpeechSessionSnapshot = {
      phase: "idle",
      engine: "browser",
      language: "en",
      level: 0,
      error: null
    };

    return {
      getSnapshot: vi.fn(() => ({
        ...snapshot,
        level: snapshot.phase === "listening" ? input.audioMonitor.readLevel() : 0
      })),
      start: vi.fn(async ({ engine, language }: { engine: SttEngine; language: SttLanguage }) => {
        snapshot = {
          ...snapshot,
          phase: "requesting-permission",
          engine,
          language,
          error: null
        };
        snapshot = {
          ...snapshot,
          phase: "listening",
          engine,
          language,
          error: null
        };
      }),
      stop: vi.fn(async () => {
        snapshot = {
          ...snapshot,
          phase: "transcribing"
        };
        snapshot = {
          ...snapshot,
          phase: "idle",
          level: 0,
          error: null
        };
        return { transcript: "home transcript" };
      }),
      dispose: vi.fn()
    };
  });

  return {
    audioMonitor,
    createSpeechEngine,
    createSpeechController
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push
  })
}));

vi.mock("@/lib/speech/audio-level-monitor", () => ({
  createAudioLevelMonitor: vi.fn(() => speechMock.audioMonitor)
}));

vi.mock("@/lib/speech/create-speech-engine", () => ({
  createSpeechEngine: speechMock.createSpeechEngine
}));

vi.mock("@/lib/speech/speech-controller", () => ({
  createSpeechController: speechMock.createSpeechController
}));

function createProviderProfile() {
  return toProviderProfileSummary(createRuntimeProviderProfile({
    id: "profile_default",
    name: "Default",
    model: "gpt-5-mini",
    systemPrompt: "Be exact",
    temperature: 0.2,
    maxOutputTokens: 512,
    modelContextLimit: 16000,
    freshTailCount: 12,
    visionMode: "native"
  }));
}

describe("home view", () => {
  const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, "maxTouchPoints");
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  const originalAudioContext = Object.getOwnPropertyDescriptor(window, "AudioContext");

  beforeEach(() => {
    push.mockReset();
    sessionStorage.clear();
    speechMock.audioMonitor.readLevel.mockReturnValue(0.48);
    speechMock.audioMonitor.dispose.mockReset();
    speechMock.createSpeechEngine.mockClear();
    speechMock.createSpeechController.mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ personas: [] })
    } as Response);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop() {} }]
        }))
      }
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class FakeAudioContext {
        resume() {
          return Promise.resolve();
        }

        close() {
          return Promise.resolve();
        }

        createMediaStreamSource() {
          return {
            connect() {},
            disconnect() {}
          };
        }

        createAnalyser() {
          return {
            fftSize: 256,
            connect() {},
            disconnect() {}
          };
        }
      }
    });
  });

  afterEach(() => {
    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, "maxTouchPoints", originalMaxTouchPoints);
    } else {
      Object.defineProperty(navigator, "maxTouchPoints", {
        configurable: true,
        value: 0
      });
    }

    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    } else {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined
      });
    }

    if (originalAudioContext) {
      Object.defineProperty(window, "AudioContext", originalAudioContext);
    } else {
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        value: undefined
      });
    }
  });

  it("uses the shared composer and removes the old suggestion cards", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
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
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          },
          speechCleanupEnabled: false
        }
      })
    );

    fireEvent.change(
      screen.getByRole("textbox"),
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

    expect(sessionStorage.getItem("eidon:chat-bootstrap:conv_new")).toContain(
      "Start this thread"
    );
    expect(sessionStorage.getItem("eidon:shell:auto-hide-sidebar-conversation")).toBe(
      "conv_new"
    );
    expect(screen.queryByText("Help me brainstorm ideas")).toBeNull();
  });

  it("carries the selected reasoning effort into the draft conversation", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          conversation: {
            id: "conv_effort"
          }
        })
      } as Response);

    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          }
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Reasoning effort" }));
    fireEvent.click(screen.getByText("High"));

    fireEvent.change(
      screen.getByRole("textbox"),
      {
        target: {
          value: "Start this thread with more effort"
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
      expect(push).toHaveBeenCalledWith("/chat/conv_effort");
    });

    const createCall = vi.mocked(global.fetch).mock.calls.find(
      (call) => call[0] === "/api/conversations"
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      reasoningEffort: "high"
    });
  });

  it("does not autofocus the composer on touch devices", () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1
    });

    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          },
          speechCleanupEnabled: false
        }
      })
    );

    expect(
      screen.getByRole("textbox")
    ).not.toHaveFocus();
  });

  it("does not mark the floating composer as an iOS keyboard lift target", () => {
    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          },
          speechCleanupEnabled: false
        }
      })
    );

    expect(screen.getByRole("textbox").closest(".ios-keyboard-lift")).toBeNull();
  });

  it("dictates into the home composer draft without auto-sending", async () => {
    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          },
          speechCleanupEnabled: false
        }
      })
    );

    expect(screen.queryByRole("combobox", { name: "Speech language" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop voice input" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop voice input" }));

    await waitFor(() => {
      expect(
        screen.getByRole("textbox")
      ).toHaveValue("home transcript");
    });

    expect(push).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/speech/transcription/cleanup",
      expect.anything()
    );
  });

  it("cleans dictation through the cleanup endpoint when enabled", async () => {
    vi.mocked(global.fetch)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "Home cleaned transcript." })
      } as Response);

    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          },
          speechCleanupEnabled: true
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop voice input" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("Home cleaned transcript.");
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/speech/transcription/cleanup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ transcript: "home transcript" })
      })
    );
  });

  it("falls back to the raw transcript when cleanup fails", async () => {
    vi.mocked(global.fetch)
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ personas: [] })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "AI post-cleanup is disabled." })
      } as Response);

    render(
      React.createElement(HomeView, {
        providerProfiles: [createProviderProfile()],
        defaultProviderProfileId: "profile_default",
        settings: {
          speechTranscription: {
            providerId: "browser",
            configuration: { language: "en" },
            configured: true,
            credentialStored: false,
            scope: "global"
          },
          speechCleanupEnabled: true
        }
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop voice input" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop voice input" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toHaveValue("home transcript");
    });
    expect(
      await screen.findByText("AI cleanup failed — inserted raw transcript.")
    ).toBeInTheDocument();
  });
});
import { toProviderProfileSummary } from "@/lib/provider-profile";
import { createRuntimeProviderProfile } from "@/tests/provider-fixtures";
