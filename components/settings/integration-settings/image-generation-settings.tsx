import { CredentialField } from "@/components/settings/integration-settings/credential-field";
import {
  selectIntegrationProvider,
  type IntegrationDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODEL_OPTIONS,
  IMAGE_GENERATION_PROVIDER_CATALOG,
  type ImageGenerationModelId,
  type ImageGenerationProviderId
} from "@/lib/image-generation/catalog";
import { fieldLabel, selectLike } from "@/lib/settings-styles";
import type { AppSettings } from "@/lib/types";

type Draft = IntegrationDraft<AppSettings["imageGeneration"]>;

export function ImageGenerationSettings({
  draft,
  persisted,
  canManage,
  dirty,
  onChange
}: {
  draft: Draft;
  persisted: Draft;
  canManage: boolean;
  dirty: boolean;
  onChange(draft: Draft): void;
}) {
  function selectProvider(providerId: ImageGenerationProviderId) {
    onChange(selectIntegrationProvider<AppSettings["imageGeneration"]>(
      draft,
      persisted,
      providerId,
      providerId === "google_nano_banana"
        ? { model: DEFAULT_IMAGE_GENERATION_MODEL }
        : {}
    ));
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="image-generation-provider" className={fieldLabel}>Image generation backend</label>
        <p className="mb-2 text-xs text-[var(--muted)]">
          {canManage ? "Choose the provider used for image generation." : "Only admins can change image generation settings."}
        </p>
        <select
          id="image-generation-provider"
          aria-label="Image generation backend"
          value={draft.providerId}
          disabled={!canManage}
          onChange={(event) => selectProvider(event.target.value as ImageGenerationProviderId)}
          className={`${selectLike} w-full sm:w-[22rem] ${!canManage ? "opacity-60" : ""} ${dirty ? "!border-amber-500/40" : ""}`}
        >
          {Object.entries(IMAGE_GENERATION_PROVIDER_CATALOG).map(([id, provider]) => (
            <option key={id} value={id}>{provider.label}</option>
          ))}
        </select>
      </div>

      {canManage && draft.providerId === "google_nano_banana" ? (
        <>
          <div>
            <label htmlFor="image-generation-model" className={fieldLabel}>Model</label>
            <select
              id="image-generation-model"
              aria-label="Image generation model"
              value={draft.configuration.model ?? DEFAULT_IMAGE_GENERATION_MODEL}
              onChange={(event) => onChange({
                ...draft,
                configuration: { model: event.target.value as ImageGenerationModelId }
              })}
              className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
            >
              {IMAGE_GENERATION_MODEL_OPTIONS.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
          </div>
          <CredentialField
            id="image-generation-credential"
            label={`${IMAGE_GENERATION_PROVIDER_CATALOG[draft.providerId].label} API key`}
            value={draft.credential}
            action={draft.credentialAction}
            stored={draft.credentialStored}
            dirty={dirty}
            onChange={(credential, credentialAction) => onChange({ ...draft, credential, credentialAction })}
          />
        </>
      ) : null}
    </div>
  );
}
