import { Info, RotateCcw } from "lucide-react";

import { CredentialField } from "@/components/settings/integration-settings/credential-field";
import {
  selectIntegrationProvider,
  type GeneralSettingsDraft,
  type IntegrationDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import { Button } from "@/components/ui/button";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import { DEFAULT_SPEECH_CLEANUP_PROMPT } from "@/lib/speech/cleanup-prompt";
import {
  EXTERNAL_STT_PROVIDERS,
  getExternalSttLanguageOptions,
  isExternalSttMultiLanguage,
  type ExternalSttLanguage,
  type ExternalSttModel,
  type ExternalSttProviderDefinition
} from "@/lib/speech/external-providers";
import {
  TRANSCRIPTION_PROVIDER_CATALOG,
  type SttEngine,
  type TranscriptionProviderId
} from "@/lib/speech/transcription-catalog";
import type { AppSettings } from "@/lib/types";

type Draft = IntegrationDraft<AppSettings["speechTranscription"]>;
type CleanupDraft = GeneralSettingsDraft["speechCleanup"];

type CleanupProviderSummary = { id: string; name: string; model: string };

const LOCAL_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" }
] as const;

export function SpeechTranscriptionSettings({
  draft,
  persisted,
  canManage,
  dirty,
  onChange,
  cleanup,
  cleanupDirty,
  providerProfiles,
  onCleanupChange
}: {
  draft: Draft;
  persisted: Draft;
  canManage: boolean;
  dirty: boolean;
  onChange(draft: Draft): void;
  cleanup: CleanupDraft;
  cleanupDirty: boolean;
  providerProfiles: CleanupProviderSummary[];
  onCleanupChange(cleanup: CleanupDraft): void;
}) {
  const descriptor = TRANSCRIPTION_PROVIDER_CATALOG[draft.providerId];
  const externalProvider = descriptor.engine === "external"
    ? EXTERNAL_STT_PROVIDERS[draft.providerId as keyof typeof EXTERNAL_STT_PROVIDERS] as
      ExternalSttProviderDefinition
    : null;
  const languageOptions = externalProvider
    ? getExternalSttLanguageOptions(
        draft.providerId as keyof typeof EXTERNAL_STT_PROVIDERS,
        draft.configuration.model
      )
    : LOCAL_LANGUAGE_OPTIONS.filter(
        (option) => draft.providerId !== "canary" || option.value !== "auto"
      );
  const multiLanguage = externalProvider
    ? isExternalSttMultiLanguage(draft.providerId as keyof typeof EXTERNAL_STT_PROVIDERS)
    : false;
  const selectedLanguages = Array.isArray(draft.configuration.language)
    ? draft.configuration.language
    : [];

  function selectProvider(providerId: TranscriptionProviderId) {
    const provider = TRANSCRIPTION_PROVIDER_CATALOG[providerId];
    const external = provider.engine === "external"
      ? EXTERNAL_STT_PROVIDERS[providerId as keyof typeof EXTERNAL_STT_PROVIDERS] as
        ExternalSttProviderDefinition
      : null;
    const language = external
      ? isExternalSttMultiLanguage(providerId as keyof typeof EXTERNAL_STT_PROVIDERS)
        ? []
        : getExternalSttLanguageOptions(
            providerId as keyof typeof EXTERNAL_STT_PROVIDERS,
            external.defaultModel
          )[0].value
      : providerId === "canary"
        ? "en"
        : "auto";
    onChange(selectIntegrationProvider<AppSettings["speechTranscription"]>(
      draft,
      persisted,
      providerId,
      {
        language: language as ExternalSttLanguage,
        ...(external?.defaultModel ? { model: external.defaultModel as ExternalSttModel } : {})
      }
    ));
  }

  function toggleLanguage(code: string) {
    const current = Array.isArray(draft.configuration.language)
      ? draft.configuration.language
      : [];
    const next = current.includes(code)
      ? current.filter((value) => value !== code)
      : [...current, code];
    onChange({
      ...draft,
      configuration: { ...draft.configuration, language: next as ExternalSttLanguage }
    });
  }

  function selectModel(model: ExternalSttModel) {
    const options = getExternalSttLanguageOptions(
      draft.providerId as keyof typeof EXTERNAL_STT_PROVIDERS,
      model
    );
    const currentLanguage = draft.configuration.language;
    const language = options.some((option) => option.value === currentLanguage)
      ? currentLanguage
      : options[0].value as ExternalSttLanguage;
    onChange({
      ...draft,
      configuration: { ...draft.configuration, model, language }
    });
  }

  function selectEngine(engine: SttEngine) {
    const providerId = (Object.entries(TRANSCRIPTION_PROVIDER_CATALOG) as Array<[
      TranscriptionProviderId,
      (typeof TRANSCRIPTION_PROVIDER_CATALOG)[TranscriptionProviderId]
    ]>).find(([, provider]) => provider.engine === engine)?.[0];
    if (providerId) selectProvider(providerId);
  }

  function toggleCleanup(enabled: boolean) {
    onCleanupChange({
      ...cleanup,
      enabled,
      profileId: enabled && !cleanup.profileId
        ? providerProfiles[0]?.id ?? null
        : cleanup.profileId
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="speech-transcription-engine" className={fieldLabel}>Speech engine</label>
        <p className="mb-2 text-xs text-[var(--muted)]">
          {canManage ? "Choose where composer dictation is transcribed." : "Only admins can change speech-to-text settings."}
        </p>
        <select
          id="speech-transcription-engine"
          aria-label="Speech engine"
          value={descriptor.engine}
          disabled={!canManage}
          onChange={(event) => selectEngine(event.target.value as SttEngine)}
          className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
        >
          <option value="browser">Browser</option>
          <option value="embedded">Embedded</option>
          <option value="external">External</option>
        </select>
      </div>

      {descriptor.engine === "external" ? (
        <div>
          <label htmlFor="speech-transcription-provider" className={fieldLabel}>Speech-to-text provider</label>
          <select
            id="speech-transcription-provider"
            aria-label="Speech-to-text provider"
            value={draft.providerId}
            disabled={!canManage}
            onChange={(event) => selectProvider(event.target.value as TranscriptionProviderId)}
            className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
          >
            {Object.entries(EXTERNAL_STT_PROVIDERS).map(([id, provider]) => (
              <option key={id} value={id}>{provider.label} · {provider.modelLabel}</option>
            ))}
          </select>
        </div>
      ) : null}

      {externalProvider?.modelOptions && externalProvider.modelOptions.length > 1 ? (
        <div>
          <label htmlFor="speech-transcription-model" className={fieldLabel}>Speech-to-text model</label>
          <select
            id="speech-transcription-model"
            aria-label={`${externalProvider.label} transcription model`}
            value={draft.configuration.model ?? externalProvider.defaultModel}
            disabled={!canManage}
            onChange={(event) => selectModel(event.target.value as ExternalSttModel)}
            className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
          >
            {externalProvider.modelOptions.map((model) => (
              <option key={model.value} value={model.value}>{model.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {canManage && descriptor.requiresCredential ? (
        <CredentialField
          id="speech-transcription-credential"
          label={`${descriptor.label} API key`}
          value={draft.credential}
          action={draft.credentialAction}
          stored={draft.credentialStored}
          dirty={dirty}
          onChange={(credential, credentialAction) => onChange({ ...draft, credential, credentialAction })}
        />
      ) : null}

      {multiLanguage ? (
        <fieldset className="m-0 border-0 p-0">
          <legend className={fieldLabel}>Spoken languages</legend>
          <p className="mb-2 text-xs text-[var(--muted)]">
            Select one or more languages to bias detection, or leave all unchecked to auto-detect.
          </p>
          <ul
            className={`max-h-56 overflow-y-auto rounded-xl border bg-white/4 p-1 ${dirty ? "!border-amber-500/40" : "border-white/6"}`}
          >
            {languageOptions.map((language) => (
              <li key={language.value}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[var(--text)] hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={selectedLanguages.includes(language.value)}
                    disabled={!canManage}
                    onChange={() => toggleLanguage(language.value)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  {language.label}
                </label>
              </li>
            ))}
          </ul>
          {selectedLanguages.length === 0 ? (
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
              No languages selected — {externalProvider?.label ?? "the provider"} will auto-detect the spoken language.
            </p>
          ) : null}
        </fieldset>
      ) : (
        <div>
          <label htmlFor="speech-transcription-language" className={fieldLabel}>Spoken language</label>
          <select
            id="speech-transcription-language"
            aria-label={externalProvider
              ? `${externalProvider.label} transcription language`
              : "Default transcription language"}
            value={draft.configuration.language}
            disabled={!canManage}
            onChange={(event) => onChange({
              ...draft,
              configuration: {
                ...draft.configuration,
                language: event.target.value as ExternalSttLanguage
              }
            })}
            className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
          >
            {languageOptions.map((language) => (
              <option key={language.value} value={language.value}>{language.label}</option>
            ))}
          </select>
          {draft.configuration.language === "auto" && externalProvider?.automaticLanguageHint ? (
            <p className="mt-2 max-w-2xl text-xs leading-5 text-[var(--muted)]">
              {externalProvider.automaticLanguageHint}
            </p>
          ) : null}
        </div>
      )}

      {draft.providerId === "canary" ? (
        <div className="flex max-w-2xl items-start gap-2 pt-1 text-xs leading-5 text-white/60">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-300/80" />
          <p>
            <span className="font-medium text-white/80">Canary 180M Flash</span> runs on this Eidon server. The 208 MB model downloads only when embedded dictation is first used, then stays cached in the Eidon data directory. Audio is not sent to an external provider.
          </p>
        </div>
      ) : null}

      <div className="border-t border-white/6 pt-5">
        <label htmlFor="speech-cleanup-enabled" className="flex max-w-2xl cursor-pointer items-center gap-3 rounded-xl border bg-white/4 px-4 py-3 text-sm text-[var(--text)]">
          <input
            id="speech-cleanup-enabled"
            type="checkbox"
            checked={cleanup.enabled}
            disabled={!canManage}
            onChange={(event) => toggleCleanup(event.target.checked)}
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium">AI post-cleanup</span>
            <span className="text-xs leading-5 text-[var(--muted)]">
              Send each transcript through the selected AI provider to remove filler words, apply punctuation, and format text before it lands in the composer.
            </span>
          </span>
        </label>

        {cleanup.enabled ? (
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="speech-cleanup-provider" className={fieldLabel}>Cleanup provider</label>
              {providerProfiles.length ? (
                <select
                  id="speech-cleanup-provider"
                  aria-label="AI post-cleanup provider profile"
                  value={cleanup.profileId ?? ""}
                  disabled={!canManage}
                  onChange={(event) => onCleanupChange({ ...cleanup, profileId: event.target.value || null })}
                  className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${cleanupDirty ? "!border-amber-500/40" : ""}`}
                >
                  {providerProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name} ({profile.model})</option>
                  ))}
                </select>
              ) : (
                <p className="text-xs leading-5 text-[var(--muted)]">Create a provider profile first.</p>
              )}
            </div>

            <div>
              <label htmlFor="speech-cleanup-prompt" className={fieldLabel}>Cleanup instructions</label>
              <p className="mb-2 text-xs leading-5 text-[var(--muted)]">
                System prompt sent with every transcript.
              </p>
              <textarea
                id="speech-cleanup-prompt"
                value={cleanup.prompt}
                disabled={!canManage}
                maxLength={20000}
                rows={12}
                onChange={(event) => onCleanupChange({ ...cleanup, prompt: event.target.value })}
                className={`${selectLike} w-full resize-y font-mono text-xs leading-5 ${!canManage ? "opacity-60" : ""} ${cleanupDirty ? "!border-amber-500/40" : ""}`}
              />
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2 h-8 gap-1.5 px-3 text-xs"
                  onClick={() => onCleanupChange({ ...cleanup, prompt: DEFAULT_SPEECH_CLEANUP_PROMPT })}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restore default prompt
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
