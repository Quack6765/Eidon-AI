import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTERNAL_STT_PROVIDER,
  EXTERNAL_STT_PROVIDER_OPTIONS,
  getExternalSttProviderConfig,
  isExternalSttLanguageForProvider,
  isSttProvider
} from "@/lib/speech/external-providers";

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
  });

  it("validates provider ids and provider-specific languages", () => {
    expect(isSttProvider("elevenlabs")).toBe(true);
    expect(isSttProvider("unknown")).toBe(false);
    expect(isExternalSttLanguageForProvider("elevenlabs", "fra")).toBe(true);
  });
});
