import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRuntimeAppSettings } from "@/tests/provider-fixtures";
import type { RuntimeProviderProfile } from "@/lib/types";

const { callProviderTextMock, getRuntimeProviderProfileMock, getSettingsMock } = vi.hoisted(() => ({
  callProviderTextMock: vi.fn(),
  getRuntimeProviderProfileMock: vi.fn(),
  getSettingsMock: vi.fn()
}));

vi.mock("@/lib/provider", () => ({
  callProviderText: callProviderTextMock
}));

vi.mock("@/lib/provider-profiles", () => ({
  getRuntimeProviderProfile: getRuntimeProviderProfileMock
}));

vi.mock("@/lib/settings", () => ({
  getSettings: getSettingsMock
}));

const profile = {
  id: "profile_cleanup",
  name: "Cleanup profile",
  model: "claude-sonnet-4-5"
} as RuntimeProviderProfile;

describe("cleanSpeechTranscript", () => {
  beforeEach(() => {
    callProviderTextMock.mockReset();
    getRuntimeProviderProfileMock.mockReset();
    getSettingsMock.mockReset();
    getRuntimeProviderProfileMock.mockReturnValue(profile);
    callProviderTextMock.mockResolvedValue("  Buy water.  ");
  });

  it("refuses to run when AI post-cleanup is disabled", async () => {
    getSettingsMock.mockReturnValue(createRuntimeAppSettings());
    const { cleanSpeechTranscript } = await import("@/lib/speech/cleanup");

    await expect(cleanSpeechTranscript({ transcript: "buy milk" })).rejects.toThrow(
      "AI post-cleanup is disabled."
    );
    expect(callProviderTextMock).not.toHaveBeenCalled();
  });

  it("refuses to run when the configured provider profile is missing", async () => {
    getSettingsMock.mockReturnValue(createRuntimeAppSettings({
      speechCleanupEnabled: true,
      speechCleanupProfileId: "profile_gone"
    }));
    getRuntimeProviderProfileMock.mockReturnValue(null);
    const { cleanSpeechTranscript } = await import("@/lib/speech/cleanup");

    await expect(cleanSpeechTranscript({ transcript: "buy milk" })).rejects.toThrow(
      "AI post-cleanup provider profile is unavailable."
    );
    expect(callProviderTextMock).not.toHaveBeenCalled();
  });

  it("refuses to run when enabled without a profile selection", async () => {
    getSettingsMock.mockReturnValue(createRuntimeAppSettings({
      speechCleanupEnabled: true,
      speechCleanupProfileId: null
    }));
    const { cleanSpeechTranscript } = await import("@/lib/speech/cleanup");

    await expect(cleanSpeechTranscript({ transcript: "buy milk" })).rejects.toThrow(
      "AI post-cleanup provider profile is unavailable."
    );
  });

  it("cleans through the selected profile with the stored prompt", async () => {
    getSettingsMock.mockReturnValue(createRuntimeAppSettings({
      speechCleanupEnabled: true,
      speechCleanupProfileId: "profile_cleanup",
      speechCleanupPrompt: "Custom cleaner."
    }));
    const { cleanSpeechTranscript } = await import("@/lib/speech/cleanup");

    const result = await cleanSpeechTranscript({ transcript: "um buy milk" });

    expect(result).toEqual({
      text: "Buy water.",
      model: "claude-sonnet-4-5",
      provider: "Cleanup profile"
    });
    expect(callProviderTextMock).toHaveBeenCalledWith({
      settings: profile,
      prompt: "Custom cleaner.\n\nRaw transcript to clean:\num buy milk",
      purpose: "speech_cleanup",
      abortSignal: undefined
    });
  });

  it("falls back to the default prompt when none is stored", async () => {
    getSettingsMock.mockReturnValue(createRuntimeAppSettings({
      speechCleanupEnabled: true,
      speechCleanupProfileId: "profile_cleanup",
      speechCleanupPrompt: "   "
    }));
    const { cleanSpeechTranscript, buildSpeechCleanupPrompt } = await import(
      "@/lib/speech/cleanup"
    );
    const { DEFAULT_SPEECH_CLEANUP_PROMPT } = await import("@/lib/speech/cleanup-prompt");

    await cleanSpeechTranscript({ transcript: "um buy milk" });

    expect(callProviderTextMock).toHaveBeenCalledWith({
      settings: profile,
      prompt: buildSpeechCleanupPrompt(DEFAULT_SPEECH_CLEANUP_PROMPT, "um buy milk"),
      purpose: "speech_cleanup",
      abortSignal: undefined
    });
  });
});
