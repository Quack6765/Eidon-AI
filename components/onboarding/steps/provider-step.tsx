"use client";

import { Fragment, type ReactNode } from "react";
import { Check, ExternalLink, Eye, EyeOff, LoaderCircle, Plug, X } from "lucide-react";

import { OnboardingOptionTile } from "@/components/onboarding/onboarding-step-shell";
import { OAuthProviderLogo, ProviderLogo } from "@/components/onboarding/provider-logo";
import { Badge } from "@/components/settings/badge";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  getApiKeyProviderKinds,
  getOAuthProviderKinds,
  PROVIDER_CATALOG,
  PROVIDER_PRESETS,
  type ProviderKind,
  type ProviderPresetId
} from "@/lib/provider-catalog";
import { fieldLabel } from "@/lib/settings-styles";

/**
 * Either a known vendor (endpoint and model come from its preset) or a bare
 * protocol kind the user points at their own compatible server.
 */
export type ProviderChoice =
  | { kind: "preset"; presetId: ProviderPresetId }
  | { kind: "custom"; providerKind: ProviderKind }
  | { kind: "oauth"; providerKind: ProviderKind };

export type ProviderDraft = {
  choice: ProviderChoice | null;
  apiKey: string;
  model: string;
  apiBaseUrl: string;
};

export type ProviderTestResult = { success: boolean; message: string } | null;

const groupLabel = "text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";

function LogoSlot({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-md border border-white/6 bg-black/20">
      {children}
    </span>
  );
}

function SelectedTileCard({ tile, detail }: { tile: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--accent)]/45 bg-[var(--accent-soft)] shadow-[0_0_0_3px_var(--accent-soft)]">
      {tile}
      <div className="px-3 pb-3">{detail}</div>
    </div>
  );
}

function isSameChoice(a: ProviderChoice | null, b: ProviderChoice) {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "preset" && b.kind === "preset") return a.presetId === b.presetId;
  if (a.kind === "oauth" && b.kind === "oauth") return a.providerKind === b.providerKind;
  return a.kind === "custom" && b.kind === "custom" && a.providerKind === b.providerKind;
}

/**
 * A preset's suggested model. Only a suggestion — whether a key can actually
 * reach it depends on the account, so the field is always shown and editable.
 * A custom endpoint has no suggestion to offer.
 */
export function getChoiceModel(choice: ProviderChoice | null) {
  if (!choice || choice.kind !== "preset") return "";
  return PROVIDER_PRESETS.find((preset) => preset.id === choice.presetId)?.values.model ?? "";
}

export function providerDraftIsComplete(draft: ProviderDraft) {
  if (!draft.choice) return false;
  if (draft.choice.kind === "oauth") return true;
  if (!draft.apiKey.trim()) return false;
  // The catalog rejects an empty model for every key-based kind.
  if (!draft.model.trim()) return false;
  return draft.choice.kind === "custom" ? Boolean(draft.apiBaseUrl.trim()) : true;
}

export function ProviderStep({
  draft,
  onChange,
  testResult,
  isTesting,
  showKey,
  onToggleShowKey
}: {
  draft: ProviderDraft;
  onChange: (draft: ProviderDraft) => void;
  testResult: ProviderTestResult;
  isTesting: boolean;
  showKey: boolean;
  onToggleShowKey: () => void;
}) {
  // Re-selecting the active tile must not discard a model the user edited.
  const select = (choice: ProviderChoice) => {
    if (isSameChoice(draft.choice, choice)) return;
    onChange({ ...draft, choice, model: getChoiceModel(choice) });
  };

  const isWideViewport = useMediaQuery("(min-width: 640px)");

  const detail =
    draft.choice?.kind === "oauth" ? (
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-5">
        <Badge variant="violet">OAUTH</Badge>
        <p className="text-xs leading-5 text-[var(--muted)]">
          {PROVIDER_CATALOG[draft.choice.providerKind].label} signs you in rather than taking a
          key. Skip this step and connect it from{" "}
          <a
            className="inline-flex items-center gap-1 text-[var(--text)] underline decoration-white/25 underline-offset-2"
            href="/settings/providers"
          >
            Settings › Providers
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          .
        </p>
      </div>
    ) : draft.choice ? (
      <div className="flex flex-col gap-4 border-t border-white/[0.06] pt-5">
        {draft.choice.kind === "custom" ? (
          <div>
            <label className={fieldLabel} htmlFor="onboarding-base-url">
              API base URL
            </label>
            <Input
              id="onboarding-base-url"
              value={draft.apiBaseUrl}
              onChange={(event) => onChange({ ...draft, apiBaseUrl: event.target.value })}
              placeholder="https://..."
            />
          </div>
        ) : null}

        <div>
          <label className={fieldLabel} htmlFor="onboarding-model">
            Model
          </label>
          <Input
            id="onboarding-model"
            value={draft.model}
            onChange={(event) => onChange({ ...draft, model: event.target.value })}
            placeholder="Name the model you want to use"
          />
          <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
            {getChoiceModel(draft.choice)
              ? "Pre-filled with a common choice. Change it to any model your key can reach."
              : "Enter a model name this endpoint serves."}
          </p>
        </div>

        <div>
          <label className={fieldLabel} htmlFor="onboarding-api-key">
            API key
          </label>
          <div className="relative">
            <Input
              id="onboarding-api-key"
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              onChange={(event) => onChange({ ...draft, apiKey: event.target.value })}
              placeholder="Required"
              autoComplete="off"
              className="pr-11"
            />
            <button
              type="button"
              onClick={onToggleShowKey}
              aria-label={showKey ? "Hide API key" : "Show API key"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] transition hover:text-[var(--text)]"
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-[var(--muted)]">
            Stored encrypted on your own server. It never leaves your instance except to reach
            the provider.
          </p>
        </div>

        {isTesting ? (
          <p className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Testing the connection…
          </p>
        ) : testResult ? (
          <p
            role="status"
            className={`flex items-start gap-2 text-xs leading-5 ${
              testResult.success ? "text-emerald-300" : "text-red-300"
            }`}
          >
            {testResult.success ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            {testResult.message}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className={groupLabel}>Providers</p>
        <div
          role="radiogroup"
          aria-label="Model provider"
          className="mt-2.5 grid gap-3 sm:grid-cols-3"
        >
          {PROVIDER_PRESETS.map((preset) => {
            const selected = isSameChoice(draft.choice, {
              kind: "preset",
              presetId: preset.id
            });
            const tile = (
              <OnboardingOptionTile
                selected={selected}
                onSelect={() => select({ kind: "preset", presetId: preset.id })}
                title={preset.label}
                // Two presets share a label, so the kind disambiguates them.
                description={PROVIDER_CATALOG[preset.providerKind].label}
                ariaLabel={`${preset.label} (${PROVIDER_CATALOG[preset.providerKind].label})`}
                className={
                  !isWideViewport && selected
                    ? "border-transparent! bg-transparent! shadow-none!"
                    : undefined
                }
              >
                <LogoSlot>
                  <ProviderLogo presetId={preset.id} />
                </LogoSlot>
              </OnboardingOptionTile>
            );
            return (
              <Fragment key={preset.id}>
                {!isWideViewport && selected ? (
                  <SelectedTileCard tile={tile} detail={detail} />
                ) : (
                  tile
                )}
              </Fragment>
            );
          })}
          {getOAuthProviderKinds().map((providerKind) => {
            const selected = isSameChoice(draft.choice, { kind: "oauth", providerKind });
            const tile = (
              <OnboardingOptionTile
                selected={selected}
                onSelect={() => select({ kind: "oauth", providerKind })}
                title={PROVIDER_CATALOG[providerKind].label}
                description="Sign in with OAuth instead of a key."
                className={
                  !isWideViewport && selected
                    ? "border-transparent! bg-transparent! shadow-none!"
                    : undefined
                }
              >
                <LogoSlot>
                  <OAuthProviderLogo providerKind={providerKind} />
                </LogoSlot>
              </OnboardingOptionTile>
            );
            return (
              <Fragment key={providerKind}>
                {!isWideViewport && selected ? (
                  <SelectedTileCard tile={tile} detail={detail} />
                ) : (
                  tile
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Separated by space alone — the tiles' own labels carry the distinction,
          and the group stays named for screen readers via aria-label. */}
      <div className="pt-3">
        <div role="radiogroup" aria-label="Custom endpoint" className="grid gap-3 sm:grid-cols-2">
          {getApiKeyProviderKinds().map((providerKind) => {
            const selected = isSameChoice(draft.choice, { kind: "custom", providerKind });
            const tile = (
              <OnboardingOptionTile
                selected={selected}
                onSelect={() => select({ kind: "custom", providerKind })}
                title={PROVIDER_CATALOG[providerKind].label}
                description="Your own URL and model."
                ariaLabel={`Custom ${PROVIDER_CATALOG[providerKind].label} endpoint`}
                className={
                  !isWideViewport && selected
                    ? "border-transparent! bg-transparent! shadow-none!"
                    : undefined
                }
              >
                <LogoSlot>
                  <Plug className="h-4 w-4 text-white/60" aria-hidden="true" />
                </LogoSlot>
              </OnboardingOptionTile>
            );
            return (
              <Fragment key={providerKind}>
                {!isWideViewport && selected ? (
                  <SelectedTileCard tile={tile} detail={detail} />
                ) : (
                  tile
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {isWideViewport ? detail : null}
    </div>
  );
}
