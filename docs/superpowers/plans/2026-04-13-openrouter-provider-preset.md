# OpenRouter Provider Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OpenRouter template to Settings → Providers so users can create an OpenAI-compatible profile prefilled with the OpenRouter base URL and generic defaults.

**Architecture:** Keep OpenRouter inside the existing `openai_compatible` provider flow. Extend the provider preset registry with a new `openrouter` preset, then verify the settings UI exposes it through the existing preset dropdown and applies the expected values to the active profile.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Testing Library

---

## File Structure

- `lib/provider-presets.ts`
  Owns the preset id union, preset definitions, and the helper functions that apply and match presets.
- `tests/unit/provider-presets.test.ts`
  Verifies preset values and preset matching behavior independently of the UI.
- `tests/unit/providers-section.test.tsx`
  Verifies the Providers settings screen exposes the preset and applies it through the existing dropdown.

### Task 1: Add the OpenRouter preset to the preset registry

**Files:**
- Modify: `lib/provider-presets.ts`
- Test: `tests/unit/provider-presets.test.ts`

- [ ] **Step 1: Write the failing preset unit tests**

Add these tests to `tests/unit/provider-presets.test.ts`:

```ts
  it("applies the OpenRouter preset values", () => {
    const profile = applyProviderPreset(createProfile(), "openrouter");

    expect(profile.name).toBe("OpenRouter");
    expect(profile.apiBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(profile.model).toBe("");
    expect(profile.apiMode).toBe("responses");
    expect(profile.reasoningEffort).toBe("medium");
    expect(profile.reasoningSummaryEnabled).toBe(true);
    expect(profile.modelContextLimit).toBe(200000);
  });

  it("matches a profile back to the OpenRouter preset when the provider fields align", () => {
    const profile = {
      ...createProfile(),
      ...getProviderPreset("openrouter").values
    };

    expect(getMatchingProviderPresetId(profile)).toBe("openrouter");
  });
```

- [ ] **Step 2: Run the preset test file to verify it fails**

Run: `npx vitest run tests/unit/provider-presets.test.ts`

Expected: FAIL with a TypeScript or runtime error because `"openrouter"` is not part of `ProviderPresetId` and `getProviderPreset("openrouter")` is unknown.

- [ ] **Step 3: Implement the OpenRouter preset**

Update `lib/provider-presets.ts` with this change:

```ts
export type ProviderPresetId =
  | "openrouter"
  | "ollama_cloud"
  | "glm_coding_plan"
  | "custom_openai_compatible";

export const PROVIDER_PRESETS: ProviderPresetDefinition[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    values: {
      name: "OpenRouter",
      apiBaseUrl: "https://openrouter.ai/api/v1",
      model: "",
      apiMode: DEFAULT_PROVIDER_SETTINGS.apiMode,
      reasoningEffort: DEFAULT_PROVIDER_SETTINGS.reasoningEffort,
      reasoningSummaryEnabled: DEFAULT_PROVIDER_SETTINGS.reasoningSummaryEnabled,
      modelContextLimit: 200000
    }
  },
  {
    id: "ollama_cloud",
    label: "Ollama Cloud",
    values: {
      name: "Ollama Cloud",
      apiBaseUrl: "https://ollama.com/v1",
      model: "glm-4.7:cloud",
      apiMode: "chat_completions",
      reasoningEffort: "medium",
      reasoningSummaryEnabled: true,
      modelContextLimit: 64000
    }
  },
```

- [ ] **Step 4: Run the preset test file to verify it passes**

Run: `npx vitest run tests/unit/provider-presets.test.ts`

Expected: PASS with all preset tests green, including the new OpenRouter checks.

- [ ] **Step 5: Commit the preset registry change**

```bash
git add lib/provider-presets.ts tests/unit/provider-presets.test.ts
git commit -m "feat: add openrouter provider preset"
```

### Task 2: Add a settings regression test for selecting the OpenRouter preset

**Files:**
- Test: `tests/unit/providers-section.test.tsx`

- [ ] **Step 1: Write the failing settings interaction test**

Add this test to `tests/unit/providers-section.test.tsx`:

```tsx
  it("applies the OpenRouter preset from the providers settings dropdown", async () => {
    const fetchMock = vi.mocked(global.fetch);
    const settings = makeSettings();

    render(React.createElement(ProvidersSection, { settings }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mcp-servers");
    });

    fireEvent.change(screen.getByLabelText("Provider preset"), {
      target: { value: "openrouter" }
    });

    expect(screen.getByDisplayValue("OpenRouter")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://openrouter.ai/api/v1")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("");
  });
```

- [ ] **Step 2: Run the settings interaction test to verify it fails**

Run: `npx vitest run tests/unit/providers-section.test.tsx -t "applies the OpenRouter preset from the providers settings dropdown"`

Expected: FAIL because the preset dropdown does not yet contain an `openrouter` option before Task 1 is implemented on a clean branch.

- [ ] **Step 3: Re-run after Task 1 and confirm no additional production code is needed**

No production code change should be necessary here because `ProvidersSection` already renders:

```tsx
{PROVIDER_PRESETS.map((preset) => (
  <option key={preset.id} value={preset.id}>
    {preset.label}
  </option>
))}
```

and already applies selection through:

```tsx
applyPresetToActiveProviderProfile(nextPresetId);
```

The expected outcome is that Task 1's preset registry change makes this UI test pass unchanged.

- [ ] **Step 4: Run the focused settings test to verify it passes**

Run: `npx vitest run tests/unit/providers-section.test.tsx -t "applies the OpenRouter preset from the providers settings dropdown"`

Expected: PASS, showing the dropdown now exposes OpenRouter and the selected draft updates to the OpenRouter values.

- [ ] **Step 5: Run the combined regression slice**

Run: `npx vitest run tests/unit/provider-presets.test.ts tests/unit/providers-section.test.tsx`

Expected: PASS with both the preset registry tests and the Providers settings tests green.

- [ ] **Step 6: Commit the regression coverage**

```bash
git add tests/unit/providers-section.test.tsx
git commit -m "test: cover openrouter preset in settings"
```

### Task 3: Verify the settings UI manually in the browser

**Files:**
- Verify: `components/settings/sections/providers-section.tsx`

- [ ] **Step 1: Start or reuse the dev server**

Run:

```bash
if [ -f .dev-server ]; then
  URL=$(head -n 1 .dev-server)
  curl -sf "$URL/settings/providers" >/dev/null || rm .dev-server
fi

if [ ! -f .dev-server ]; then
  npm run dev
fi
```

Then run:

```bash
until [ -f .dev-server ]; do sleep 1; done
head -n 1 .dev-server
```

Expected: a reachable local URL from `.dev-server` in the `3000`-`4000` range.

- [ ] **Step 2: Open the Providers settings page with agent-browser**

Run the browser workflow against the URL from `.dev-server`:

```bash
URL=$(head -n 1 .dev-server)
agent-browser open "$URL/settings/providers"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

Expected: the Providers settings page loads and exposes the provider list plus the provider detail form.

- [ ] **Step 3: Validate the OpenRouter preset visually and interactively**

Use the browser to:

```bash
agent-browser select <provider-preset-ref> "OpenRouter"
agent-browser screenshot --full .context/openrouter-preset-settings.png
agent-browser snapshot -i
```

Confirm all of the following in the page state:

- profile name becomes `OpenRouter`
- API base URL becomes `https://openrouter.ai/api/v1`
- model field is empty
- API key field remains empty
- model context limit displays `200000`

- [ ] **Step 4: Record verification evidence**

Run:

```bash
ls -l .context/openrouter-preset-settings.png
```

Expected: the screenshot file exists and can be referenced in the completion summary.

- [ ] **Step 5: Run the full required verification commands before claiming completion**

Run:

```bash
npx vitest run tests/unit/provider-presets.test.ts tests/unit/providers-section.test.tsx
npx vitest run --coverage
```

Expected:

- first command passes
- second command passes and reports overall coverage at or above the repository threshold

- [ ] **Step 6: Commit any remaining verification-driven changes**

```bash
git status --short
```

Expected: only the intended source and test files are staged or modified. Do not attempt to commit `.context/openrouter-preset-settings.png`.

## Self-Review

- Spec coverage: covered preset registry addition, settings dropdown exposure, OpenRouter-specific values, no new provider type, and regression testing.
- Placeholder scan: removed generic implementation language and replaced it with exact tests, commands, and code snippets.
- Type consistency: the plan consistently uses `openrouter` as the preset id, `OpenRouter` as the label/name, `https://openrouter.ai/api/v1` as the base URL, and `200000` as the context limit.
