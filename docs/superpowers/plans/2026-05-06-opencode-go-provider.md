# OpenCode Go Provider Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenCode Go as a provider preset and change the default modelContextLimit from 128000 to 200000.

**Architecture:** OpenCode Go uses a standard OpenAI-compatible chat completions API, so it reuses the existing `openai_compatible` ProviderKind. We add a preset entry and update the default context limit — no new ProviderKind, no new files, no database changes.

**Tech Stack:** TypeScript, React, Zod, Vitest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/types.ts` | Modify line 70 | Add `"opencode_go"` to `ProviderPresetId` union |
| `lib/constants.ts` | Modify line 32 | Change `modelContextLimit` default from `128000` to `200000` |
| `lib/provider-presets.ts` | Modify lines 73-85 (insert before `custom_openai_compatible`) | Add `opencode_go` preset entry |
| `tests/unit/provider-presets.test.ts` | Add tests | Test the new preset and the updated default context limit |
| `components/settings/sections/providers-section.tsx` | No changes needed | Dropdown already renders dynamically from `PROVIDER_PRESETS.map()` (lines 511-516) |

---

### Task 1: Add `"opencode_go"` to `ProviderPresetId` type

**Files:**
- Modify: `lib/types.ts:70`

- [ ] **Step 1: Update the type union**

Change line 70 of `lib/types.ts` from:

```ts
export type ProviderPresetId = "ollama_cloud" | "glm_coding_plan" | "openrouter" | "custom_openai_compatible";
```

to:

```ts
export type ProviderPresetId = "ollama_cloud" | "glm_coding_plan" | "openrouter" | "opencode_go" | "custom_openai_compatible";
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: Errors about missing preset — that's expected. We'll fix in Task 2.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add opencode_go to ProviderPresetId type"
```

---

### Task 2: Add OpenCode Go preset entry

**Files:**
- Modify: `lib/provider-presets.ts` (insert between `openrouter` and `custom_openai_compatible` presets, before line 73)

- [ ] **Step 1: Add the preset**

Insert the following block between the `openrouter` preset (ends at line 72) and the `custom_openai_compatible` preset (starts at line 73) in `lib/provider-presets.ts`:

```ts
  {
    id: "opencode_go",
    label: "OpenCode Go",
    values: {
      name: "OpenCode Go",
      apiBaseUrl: "https://opencode.ai/zen/go/v1",
      model: "kimi-k2.6",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 200000
    }
  },
```

The full `PROVIDER_PRESETS` array should now have 5 entries in this order: `ollama_cloud`, `glm_coding_plan`, `openrouter`, `opencode_go`, `custom_openai_compatible`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors related to provider presets.

- [ ] **Step 3: Commit**

```bash
git add lib/provider-presets.ts
git commit -m "feat: add OpenCode Go provider preset"
```

---

### Task 3: Change default modelContextLimit to 200000

**Files:**
- Modify: `lib/constants.ts:32`

- [ ] **Step 1: Update the default**

Change line 32 of `lib/constants.ts` from:

```ts
  modelContextLimit: 128000,
```

to:

```ts
  modelContextLimit: 200000,
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat: change default modelContextLimit from 128000 to 200000"
```

---

### Task 4: Add tests for the new preset

**Files:**
- Modify: `tests/unit/provider-presets.test.ts`

- [ ] **Step 1: Add the OpenCode Go preset test**

Insert a new test after the "applies the OpenRouter preset values" test (after line 77), before the "preserves non-provider tuning" test. Add:

```ts
  it("applies the OpenCode Go preset values", () => {
    const profile = applyProviderPreset(createProfile(), "opencode_go");

    expect(profile.name).toBe("OpenCode Go");
    expect(profile.apiBaseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(profile.model).toBe("kimi-k2.6");
    expect(profile.apiMode).toBe("chat_completions");
    expect(profile.reasoningEffort).toBe("medium");
    expect(profile.reasoningSummaryEnabled).toBe(true);
    expect(profile.modelContextLimit).toBe(200000);
  });

  it("matches a profile back to the OpenCode Go preset when the provider fields align", () => {
    const profile = {
      ...createProfile(),
      ...getProviderPreset("opencode_go").values
    };

    expect(getMatchingProviderPresetId(profile)).toBe("opencode_go");
  });
```

- [ ] **Step 2: Update the custom OpenAI compatible test for the new default**

The test at line 53-63 ("applies the custom OpenAI compatible preset values") asserts `modelContextLimit` is `128000`. Since `custom_openai_compatible` uses `DEFAULT_PROVIDER_SETTINGS.modelContextLimit` and we changed the default to `200000`, update line 62 from:

```ts
    expect(profile.modelContextLimit).toBe(128000);
```

to:

```ts
    expect(profile.modelContextLimit).toBe(200000);
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/unit/provider-presets.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/provider-presets.test.ts
git commit -m "test: add OpenCode Go preset tests and update default context limit assertion"
```

---

### Task 5: Final verification

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 3: Verify build**

Run: `npm run build`

Expected: Build succeeds.
