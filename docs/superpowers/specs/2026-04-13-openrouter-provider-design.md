# OpenRouter Provider Preset Design

## Goal

Add OpenRouter to the provider settings UI as a reusable template so users can create an OpenAI-compatible profile prefilled for OpenRouter without introducing a new provider type.

## Scope

This change is limited to the settings preset experience.

Included:

- Add an OpenRouter preset to the provider preset registry.
- Surface the preset in the Providers settings preset dropdown.
- Prefill OpenRouter-specific template values when the preset is selected.
- Add regression tests for preset matching and settings UI behavior.

Not included:

- A new `providerKind`
- OpenRouter-specific runtime branching in `lib/provider.ts`
- Automatic model discovery from OpenRouter
- Additional request headers such as `HTTP-Referer` or `X-OpenRouter-Title`

## Product Decision

OpenRouter should be treated as a generic OpenAI-compatible preset because it exposes many models with different capabilities and limits. The preset is only a starting template. Users are expected to choose their own model and API key after applying it.

## Preset Behavior

The new preset will live alongside the existing provider presets and will populate these values:

- `name`: `OpenRouter`
- `apiBaseUrl`: `https://openrouter.ai/api/v1`
- `model`: `""`
- `apiMode`: existing generic default value
- `reasoningEffort`: existing generic default value
- `reasoningSummaryEnabled`: existing generic default value
- `modelContextLimit`: `200000`

All other runtime settings should remain whatever the preset helper already derives from the generic defaults unless explicitly listed above.

## Architecture

### Provider model

No schema or persistence changes are required. OpenRouter remains an `openai_compatible` provider profile.

### Preset registry

`lib/provider-presets.ts` will gain a new preset id and definition. The existing helper functions (`applyProviderPreset`, `getMatchingProviderPresetId`) should continue to work without structural changes because the OpenRouter preset fits the current matching model.

### Settings UI

`components/settings/sections/providers-section.tsx` already renders the preset dropdown for `openai_compatible` providers. No new UI control is needed. The only behavior change is that selecting `OpenRouter` applies the new preset values to the active profile.

The empty `model` value is intentional. The UI should not try to infer or auto-fill a model for OpenRouter.

## Error Handling

No new error flows are needed.

Existing validation remains responsible for requiring:

- a non-empty API base URL
- a non-empty model
- a non-empty system prompt

This means an OpenRouter preset can be applied and saved only after the user fills in a model. That is acceptable and matches the template-only intent.

## Testing

Add or update tests to cover:

- the preset registry includes OpenRouter with the expected values
- applying the OpenRouter preset updates the active provider draft with the OpenRouter base URL, empty model, and `200000` context limit
- matching logic recognizes the OpenRouter preset when a profile has the full preset value set

The most relevant existing coverage points are:

- `tests/unit/provider-presets.test.ts`
- `tests/unit/providers-section.test.tsx`

## Files Expected To Change

- `lib/provider-presets.ts`
- `tests/unit/provider-presets.test.ts`
- `tests/unit/providers-section.test.tsx`

## Implementation Notes

- Keep OpenRouter in the same preset dropdown as Ollama Cloud, GLM Coding Plan, and Custom OpenAI compatible.
- Do not add documentation links or helper copy unless implementation reveals a clear usability gap.
- Do not add OpenRouter-specific transport or capability logic in this change.
