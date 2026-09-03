import { describe, expect, it } from "vitest";

import {
  buildProviderCatalogPayload,
  getOnboardingProgress,
  getOnboardingSteps
} from "@/lib/onboarding";
import { toProviderProfileEditorDraft } from "@/lib/provider-profile-editor";
import { createProviderProfileDraft } from "@/lib/provider-catalog";
import type { ProviderProfileSummary } from "@/lib/provider-profile";

function makeProfile(overrides: Partial<ProviderProfileSummary> = {}): ProviderProfileSummary {
  const flat = createProviderProfileDraft({ id: "prof_seed", name: "Default profile" });
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    ...toProviderProfileEditorDraft({
      ...flat,
      providerConfig: {
        apiBaseUrl: flat.apiBaseUrl,
        apiMode: flat.apiMode,
        processingMode: flat.processingMode,
        reasoningParameterMode: flat.reasoningParameterMode
      },
      connection: {
        mode: "api_key",
        status: "disconnected",
        accountLabel: null,
        expiresAt: null
      },
      createdAt: timestamp,
      updatedAt: timestamp
    } as ProviderProfileSummary),
    ...overrides
  } as ProviderProfileSummary;
}

describe("onboarding steps", () => {
  it("gives admins the full flow", () => {
    expect(getOnboardingSteps("admin")).toEqual([
      "welcome",
      "default-view",
      "tool-display",
      "provider",
      "mcp-server",
      "done"
    ]);
  });

  it("hides admin-only steps from other users", () => {
    const steps = getOnboardingSteps("user");
    expect(steps).toEqual(["welcome", "default-view", "tool-display", "done"]);
    expect(steps).not.toContain("provider");
    expect(steps).not.toContain("mcp-server");
  });

  it("numbers only the choice steps", () => {
    const adminSteps = getOnboardingSteps("admin");
    expect(getOnboardingProgress(adminSteps, "default-view")).toEqual({ current: 1, total: 4 });
    expect(getOnboardingProgress(adminSteps, "mcp-server")).toEqual({ current: 4, total: 4 });
    expect(getOnboardingProgress(adminSteps, "welcome")).toBeNull();
    expect(getOnboardingProgress(adminSteps, "done")).toBeNull();
  });

  it("counts non-admin steps out of the shorter total", () => {
    const steps = getOnboardingSteps("user");
    expect(getOnboardingProgress(steps, "default-view")).toEqual({ current: 1, total: 2 });
    expect(getOnboardingProgress(steps, "tool-display")).toEqual({ current: 2, total: 2 });
  });
});

describe("buildProviderCatalogPayload", () => {
  it("applies a preset and marks the profile as the default", () => {
    const profiles = [makeProfile()];
    const payload = buildProviderCatalogPayload({
      profiles,
      targetProfileId: "prof_seed",
      selection: { kind: "preset", presetId: "anthropic_official", apiKey: "sk-test" }
    });

    expect(payload.defaultProviderProfileId).toBe("prof_seed");
    expect(payload.providerProfiles).toHaveLength(1);
    const [profile] = payload.providerProfiles;
    expect(profile.providerKind).toBe("anthropic");
    expect(profile.model).toBe("claude-opus-4-8");
    expect(profile.name).toBe("Anthropic");
    expect(profile.providerConfig).toEqual({ apiBaseUrl: "https://api.anthropic.com" });
    expect(profile.credential).toBe("sk-test");
    expect(profile.credentialAction).toBe("replace");
  });

  it("lets an explicit model override a preset with no default model", () => {
    const payload = buildProviderCatalogPayload({
      profiles: [makeProfile()],
      targetProfileId: "prof_seed",
      selection: {
        kind: "preset",
        presetId: "openrouter",
        model: "anthropic/claude-opus-4.8",
        apiKey: "sk-test"
      }
    });

    expect(payload.providerProfiles[0].model).toBe("anthropic/claude-opus-4.8");
  });

  it("builds a custom profile for the openai-compatible kind", () => {
    const payload = buildProviderCatalogPayload({
      profiles: [makeProfile()],
      targetProfileId: "prof_seed",
      selection: {
        kind: "custom",
        providerKind: "openai_compatible",
        apiBaseUrl: "  https://llm.internal/v1  ",
        model: "  local-model  ",
        apiKey: "sk-test"
      }
    });

    const [profile] = payload.providerProfiles;
    expect(profile.providerKind).toBe("openai_compatible");
    expect(profile.providerPresetId).toBeNull();
    expect(profile.model).toBe("local-model");
    expect(profile.providerConfig).toEqual({
      apiBaseUrl: "https://llm.internal/v1",
      apiMode: "chat_completions",
      processingMode: "standard",
      reasoningParameterMode: "standard"
    });
  });

  it("builds a custom profile for the anthropic-compatible kind", () => {
    const payload = buildProviderCatalogPayload({
      profiles: [makeProfile()],
      targetProfileId: "prof_seed",
      selection: {
        kind: "custom",
        providerKind: "anthropic",
        apiBaseUrl: "https://claude.internal",
        model: "local-opus",
        apiKey: "sk-test"
      }
    });

    const [profile] = payload.providerProfiles;
    expect(profile.providerKind).toBe("anthropic");
    expect(profile.model).toBe("local-opus");
    // This kind declares only a base URL; the catalog's zod union rejects more.
    expect(profile.providerConfig).toEqual({ apiBaseUrl: "https://claude.internal" });
  });

  it("returns every profile so the whole-catalog save does not delete the others", () => {
    const profiles = [makeProfile(), makeProfile({ id: "prof_other", name: "Other" })];
    const payload = buildProviderCatalogPayload({
      profiles,
      targetProfileId: "prof_seed",
      selection: { kind: "preset", presetId: "openai_official", apiKey: "sk-test" }
    });

    expect(payload.providerProfiles.map((profile) => profile.id)).toEqual([
      "prof_seed",
      "prof_other"
    ]);
    // Untouched profiles keep their credential rather than being cleared.
    expect(payload.providerProfiles[1].credentialAction).toBe("preserve");
  });

  it("throws when the target profile is missing", () => {
    expect(() =>
      buildProviderCatalogPayload({
        profiles: [makeProfile()],
        targetProfileId: "prof_missing",
        selection: { kind: "preset", presetId: "openai_official", apiKey: "sk-test" }
      })
    ).toThrow("Provider profile not found");
  });
});
