import { Info } from "lucide-react";

import { CredentialField } from "@/components/settings/integration-settings/credential-field";
import {
  selectIntegrationProvider,
  type IntegrationDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import {
  EXTERNAL_STT_PROVIDERS,
  getExternalSttLanguageOptions,
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

const LOCAL_LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" }
] as const;

export function SpeechTranscriptionSettings({
  draft,
  persisted,
  dirty,
  onChange
}: {
  draft: Draft;
  persisted: Draft;
  dirty: boolean;
  onChange(draft: Draft): void;
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

  function selectProvider(providerId: TranscriptionProviderId) {
    const provider = TRANSCRIPTION_PROVIDER_CATALOG[providerId];
    const external = provider.engine === "external"
      ? EXTERNAL_STT_PROVIDERS[providerId as keyof typeof EXTERNAL_STT_PROVIDERS] as
        ExternalSttProviderDefinition
      : null;
    const language = external
      ? getExternalSttLanguageOptions(
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

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="speech-transcription-engine" className={fieldLabel}>Speech engine</label>
        <p className="mb-2 text-xs text-[var(--muted)]">Choose where composer dictation is transcribed.</p>
        <select
          id="speech-transcription-engine"
          aria-label="Speech engine"
          value={descriptor.engine}
          onChange={(event) => selectEngine(event.target.value as SttEngine)}
          className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
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
            onChange={(event) => selectProvider(event.target.value as TranscriptionProviderId)}
            className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
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
            onChange={(event) => selectModel(event.target.value as ExternalSttModel)}
            className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
          >
            {externalProvider.modelOptions.map((model) => (
              <option key={model.value} value={model.value}>{model.label}</option>
            ))}
          </select>
        </div>
      ) : null}

      {descriptor.requiresCredential ? (
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

      <div>
        <label htmlFor="speech-transcription-language" className={fieldLabel}>Spoken language</label>
        <select
          id="speech-transcription-language"
          aria-label={externalProvider
            ? `${externalProvider.label} transcription language`
            : "Default transcription language"}
          value={draft.configuration.language}
          onChange={(event) => onChange({
            ...draft,
            configuration: {
              ...draft.configuration,
              language: event.target.value as ExternalSttLanguage
            }
          })}
          className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
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

      {draft.providerId === "canary" ? (
        <div className="flex max-w-2xl items-start gap-2 pt-1 text-xs leading-5 text-white/60">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-300/80" />
          <p>
            <span className="font-medium text-white/80">Canary 180M Flash</span> runs on this Eidon server. The 208 MB model downloads only when embedded dictation is first used, then stays cached in the Eidon data directory. Audio is not sent to an external provider.
          </p>
        </div>
      ) : null}
    </div>
  );
}
