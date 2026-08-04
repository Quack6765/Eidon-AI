import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTERNAL_STT_PROVIDER,
  EXTERNAL_STT_PROVIDER_OPTIONS,
  getExternalSttDefaultModel,
  getExternalSttLanguageCodes,
  getExternalSttLanguageOptions,
  getExternalSttProviderConfig,
  isExternalSttLanguageForProvider,
  isExternalSttModelForProvider,
  isSttProvider
} from "@/lib/speech/external-providers";
import {
  normalizeTranscriptionSelection,
  speechTranscriptionIntegrationUpdateSchema
} from "@/lib/speech/transcription-catalog";

describe("external speech-to-text providers", () => {
  it("exposes provider metadata through the shared registry", () => {
    expect(DEFAULT_EXTERNAL_STT_PROVIDER).toBe("elevenlabs");
    expect(EXTERNAL_STT_PROVIDER_OPTIONS).toContainEqual(
      expect.objectContaining({
        value: "elevenlabs",
        label: "ElevenLabs",
        modelLabel: "Scribe v2"
      })
    );
    expect(getExternalSttProviderConfig("elevenlabs").languages[0]).toEqual({
      value: "auto",
      label: "Automatic"
    });
    expect(EXTERNAL_STT_PROVIDER_OPTIONS).toContainEqual(
      expect.objectContaining({
        value: "assemblyai",
        label: "AssemblyAI",
        modelLabel: "Universal 3.5 Pro",
        defaultModel: "universal-3-5-pro"
      })
    );
  });

  it("validates provider ids and provider-specific languages", () => {
    expect(isSttProvider("elevenlabs")).toBe(true);
    expect(isSttProvider("assemblyai")).toBe(true);
    expect(isSttProvider("unknown")).toBe(false);
    expect(isExternalSttLanguageForProvider("elevenlabs", "fra")).toBe(true);
    expect(isExternalSttLanguageForProvider(
      "assemblyai",
      "sw",
      "universal-3-5-pro"
    )).toBe(false);
    expect(isExternalSttLanguageForProvider(
      "assemblyai",
      "sw",
      "universal-2"
    )).toBe(true);
    expect(getExternalSttLanguageCodes("elevenlabs")).toContain("fra");
    expect(getExternalSttLanguageCodes("assemblyai", "universal-3-5-pro"))
      .not.toContain("sw");
    expect(getExternalSttLanguageOptions("assemblyai", "universal-2").length)
      .toBeGreaterThan(99);
    expect(getExternalSttDefaultModel("assemblyai")).toBe("universal-3-5-pro");
    expect(isExternalSttModelForProvider("assemblyai", "universal-2")).toBe(true);
    expect(isExternalSttModelForProvider("elevenlabs", "universal-2")).toBe(false);
  });

  it("normalizes AssemblyAI defaults and validates model-specific languages", () => {
    expect(normalizeTranscriptionSelection("assemblyai", {
      model: "unknown",
      language: "sw"
    })).toEqual({
      providerId: "assemblyai",
      configuration: { model: "universal-3-5-pro", language: "auto" }
    });
    expect(speechTranscriptionIntegrationUpdateSchema.safeParse({
      providerId: "assemblyai",
      configuration: { model: "universal-3-5-pro", language: "sw" },
      credentialAction: "clear"
    }).success).toBe(false);
    expect(speechTranscriptionIntegrationUpdateSchema.safeParse({
      providerId: "assemblyai",
      configuration: { model: "universal-2", language: "sw" },
      credentialAction: "clear"
    }).success).toBe(true);
    expect(speechTranscriptionIntegrationUpdateSchema.safeParse({
      providerId: "elevenlabs",
      configuration: { language: "sw" },
      credentialAction: "clear"
    }).success).toBe(false);
  });
});
