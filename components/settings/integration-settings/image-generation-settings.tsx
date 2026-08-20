import { CredentialField } from "@/components/settings/integration-settings/credential-field";
import {
  selectIntegrationProvider,
  type IntegrationDraft
} from "@/components/settings/integration-settings/general-settings-draft";
import {
  getDefaultImageGenerationConfiguration,
  getImageGenerationModelOptions,
  IMAGE_GENERATION_PROVIDER_CATALOG,
  OPENAI_GPT_IMAGE_QUALITY_OPTIONS,
  type ImageGenerationModelId,
  type ImageGenerationProviderId,
  type OpenAiGptImageQuality
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
  const defaultConfiguration = getDefaultImageGenerationConfiguration(draft.providerId);
  const modelOptions = getImageGenerationModelOptions(draft.providerId);

  function selectProvider(providerId: ImageGenerationProviderId) {
    onChange(selectIntegrationProvider<AppSettings["imageGeneration"]>(
      draft,
      persisted,
      providerId,
      getDefaultImageGenerationConfiguration(providerId)
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

      {canManage && draft.providerId !== "disabled" ? (
        <>
          <div>
            <label htmlFor="image-generation-model" className={fieldLabel}>Model</label>
            <select
              id="image-generation-model"
              aria-label="Image generation model"
              value={draft.configuration.model ?? defaultConfiguration.model}
              onChange={(event) => onChange({
                ...draft,
                configuration: { ...draft.configuration, model: event.target.value as ImageGenerationModelId }
              })}
              className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
            >
              {modelOptions.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
          </div>
          {draft.providerId === "openai_gpt_image" ? (
            <div>
              <label htmlFor="image-generation-quality" className={fieldLabel}>Quality</label>
              <p className="mb-2 text-xs text-[var(--muted)]">
                Higher quality costs more per image. Auto lets the model decide based on the prompt.
              </p>
              <select
                id="image-generation-quality"
                aria-label="Image generation quality"
                value={draft.configuration.quality ?? defaultConfiguration.quality ?? "auto"}
                onChange={(event) => onChange({
                  ...draft,
                  configuration: {
                    ...draft.configuration,
                    quality: event.target.value as OpenAiGptImageQuality
                  }
                })}
                className={`${selectLike} w-full sm:w-[22rem] ${dirty ? "!border-amber-500/40" : ""}`}
              >
                {OPENAI_GPT_IMAGE_QUALITY_OPTIONS.map((quality) => (
                  <option key={quality.value} value={quality.value}>{quality.label}</option>
                ))}
              </select>
            </div>
          ) : null}
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
