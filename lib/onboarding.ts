import {
  applyPresetToProviderProfile,
  buildProviderProfileInput,
  switchProviderProfileKind,
  toProviderProfileEditorDraft,
  type ProviderProfileEditorDraft
} from "@/lib/provider-profile-editor";
import {
  CUSTOM_PROVIDER_KIND,
  getProviderPreset,
  type ProviderKind,
  type ProviderPresetId
} from "@/lib/provider-catalog";
import type { ProviderProfileSummary } from "@/lib/provider-profile";
import type { UserRole } from "@/lib/types";

export const ONBOARDING_STEPS = [
  "welcome",
  "default-view",
  "tool-display",
  "provider",
  "mcp-server",
  "done"
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Provider and MCP configuration are admin-only, so non-admins get a shorter flow. */
const ADMIN_ONLY_STEPS: ReadonlySet<OnboardingStep> = new Set(["provider", "mcp-server"]);

export function getOnboardingSteps(role: UserRole): OnboardingStep[] {
  if (role === "admin") return [...ONBOARDING_STEPS];
  return ONBOARDING_STEPS.filter((step) => !ADMIN_ONLY_STEPS.has(step));
}

/**
 * The step counter shown to the user. "welcome" and "done" are bookends rather
 * than choices, so they are not numbered.
 */
export function getOnboardingProgress(steps: OnboardingStep[], step: OnboardingStep) {
  const numbered: OnboardingStep[] = steps.filter((item) => item !== "welcome" && item !== "done");
  const index = numbered.indexOf(step);
  if (index === -1) return null;
  return { current: index + 1, total: numbered.length };
}

export type ProviderSelection =
  | { kind: "preset"; presetId: ProviderPresetId; model?: string; apiKey: string }
  | {
      kind: "custom";
      providerKind: ProviderKind;
      apiBaseUrl: string;
      model: string;
      apiKey: string;
    };

/**
 * First run always has exactly one seeded, keyless provider profile, and the
 * save route replaces the whole catalog rather than creating single profiles —
 * so onboarding edits the target profile in place and returns every profile.
 */
export function buildProviderCatalogPayload({
  profiles,
  targetProfileId,
  selection
}: {
  profiles: ProviderProfileSummary[];
  targetProfileId: string;
  selection: ProviderSelection;
}) {
  const target = profiles.find((profile) => profile.id === targetProfileId);
  if (!target) {
    throw new Error("Provider profile not found");
  }

  let draft = toProviderProfileEditorDraft(target);
  if (selection.kind === "preset") {
    const preset = getProviderPreset(selection.presetId);
    draft = switchProviderProfileKind(draft, preset.providerKind);
    draft = applyPresetToProviderProfile(draft, selection.presetId);
    draft = { ...draft, name: preset.values.name };
    if (selection.model?.trim()) {
      draft = { ...draft, model: selection.model.trim() };
    }
  } else {
    draft = switchProviderProfileKind(draft, selection.providerKind);
    const apiBaseUrl = selection.apiBaseUrl.trim();
    // Each kind accepts a different providerConfig shape; the catalog's zod
    // union rejects extra keys, so only send what this kind declares.
    draft = {
      ...draft,
      name: target.name,
      model: selection.model.trim(),
      providerPresetId: null,
      providerConfig:
        selection.providerKind === CUSTOM_PROVIDER_KIND
          ? {
              apiBaseUrl,
              apiMode: "chat_completions",
              processingMode: "standard",
              reasoningParameterMode: "standard"
            }
          : { apiBaseUrl }
    } as ProviderProfileEditorDraft;
  }

  draft = { ...draft, credential: selection.apiKey, credentialAction: "replace" };

  return {
    defaultProviderProfileId: draft.id,
    providerProfiles: profiles.map((profile) =>
      buildProviderProfileInput(profile.id === draft.id ? draft : toProviderProfileEditorDraft(profile))
    )
  };
}
