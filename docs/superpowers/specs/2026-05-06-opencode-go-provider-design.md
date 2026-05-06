# OpenCode Go Provider Preset + Default Context Limit Change

**Date:** 2026-05-06  
**Status:** Approved  

## Summary

Add OpenCode Go as a new provider preset and change the default `modelContextLimit` from 128,000 to 200,000.

## Background

OpenCode Go is a $5–10/month subscription from opencode.ai providing access to curated open-source coding models. Its API (`https://opencode.ai/zen/go/v1`) is fully OpenAI-compatible, using the standard `/v1/chat/completions` endpoint. This means it can be implemented as a preset for the existing `openai_compatible` provider kind — no new `ProviderKind` is needed.

## Design

### 1. New Preset: `opencode_go`

**File:** `lib/provider-presets.ts`

Add a new preset entry:

| Field | Value |
|---|---|
| `id` | `"opencode_go"` |
| `label` | `"OpenCode Go"` |
| `baseURL` | `"https://opencode.ai/zen/go/v1"` |
| `defaultModel` | `"kimi-k2.6"` |
| `apiMode` | `"chat_completions"` |
| `modelContextLimit` | `200000` |

This follows the exact pattern of existing presets like `ollama_cloud` and `glm_coding_plan`.

### 2. Type Update

**File:** `lib/types.ts` (line ~70)

Add `"opencode_go"` to the `ProviderPresetId` union type:

```ts
export type ProviderPresetId = "ollama_cloud" | "glm_coding_plan" | "openrouter" | "custom_openai_compatible" | "opencode_go";
```

### 3. Default Context Limit Change

**File:** `lib/constants.ts` (line 32)

Change:
```ts
modelContextLimit: 128000,
```
To:
```ts
modelContextLimit: 200000,
```

This changes the default for the `custom_openai_compatible` preset and any new profiles that don't specify an override. Existing provider profiles are unaffected — they store their own `modelContextLimit` value in the database.

### 4. UI Dropdown Update

**File:** `components/settings/sections/providers-section.tsx` (lines ~489–492)

Add "OpenCode Go" to the preset selector dropdown alongside the existing options.

### 5. Tests

**File:** `tests/unit/provider-presets.test.ts`

Add test cases for the new `opencode_go` preset verifying:
- Preset ID, label, base URL, default model, API mode
- Context limit is 200,000

## Scope

### In Scope
- Adding `opencode_go` preset (preset + type + UI)
- Changing default `modelContextLimit` to 200,000
- Tests for the new preset

### Out of Scope
- New `ProviderKind` — not needed (OpenAI-compatible)
- Changes to `lib/provider.ts` streaming/calling logic
- Support for MiniMax M2.7/M2.5 (Anthropic Messages API) or Qwen3.x Plus (Alibaba SDK) — these use non-OpenAI-compatible formats and would require separate provider kinds if ever needed
- Database migrations — no schema changes
- Any changes to existing presets or their context limits

## Files Changed

| File | Change |
|---|---|
| `lib/provider-presets.ts` | Add `opencode_go` preset object |
| `lib/types.ts` | Add `"opencode_go"` to `ProviderPresetId` |
| `lib/constants.ts` | Change `modelContextLimit` default from 128000 to 200000 |
| `components/settings/sections/providers-section.tsx` | Add "OpenCode Go" to preset dropdown |
| `tests/unit/provider-presets.test.ts` | Add tests for new preset |

## Edge Cases

- **Non-OpenAI-compatible models:** MiniMax M2.7/M2.5 and Qwen3.x Plus use different API formats. These 2 of 14 models will not work through this preset. Users wanting those models would need a separate provider configured appropriately. This is acceptable and documented.
- **Usage limits:** OpenCode Go has dollar-value usage caps ($12/5hr, $30/week, $60/month). These are enforced server-side and invisible to Eidon's implementation.
- **Existing profiles:** Changing the default `modelContextLimit` does not retroactively update existing provider profiles — those values are stored per-profile in the database. Only new profiles get the new default.
