# MCP Timeout Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the General settings page show a default MCP tool call timeout of 120 seconds while still allowing users to save a different value.

**Architecture:** Keep the fix at the settings data boundary. `getSettings()` should return the persisted `mcp_timeout` value so server-rendered settings pages hydrate with the existing database default and any saved override. Add a regression test in the settings storage suite, then validate the rendered settings page end to end.

**Tech Stack:** Next.js App Router, React, TypeScript, SQLite, Vitest, Playwright/browser validation

---

### Task 1: Restore `mcp_timeout` in settings reads

**Files:**
- Modify: `tests/unit/settings.test.ts`
- Modify: `lib/settings.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("returns the default MCP timeout from persisted settings", () => {
  const alpha = buildProfile({
    id: "profile_alpha",
    name: "Alpha",
    apiKey: "sk-alpha"
  });

  updateSettings({
    defaultProviderProfileId: alpha.id,
    skillsEnabled: true,
    providerProfiles: [alpha]
  });

  expect(getSettings().mcpTimeout).toBe(120_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/settings.test.ts --runInBand`
Expected: FAIL on the new assertion because `getSettings()` returns `undefined` for `mcpTimeout`

- [ ] **Step 3: Write minimal implementation**

```ts
export function getSettings() {
  const row = getDb()
    .prepare(
      `SELECT
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        mcp_timeout,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as AppSettingsRow;

  return rowToSettings(row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/settings.test.ts --runInBand`
Expected: PASS

### Task 2: Validate the settings UI

**Files:**
- Verify: `components/settings/sections/general-section.tsx`

- [ ] **Step 1: Start or reuse the dev server**

Run: check `.dev-server`; if missing or stale, run `npm run dev`
Expected: a live local URL written to `.dev-server`

- [ ] **Step 2: Open the General settings page and confirm the default value**

Run: browser validation against `/settings/general`
Expected: the `Max tool call timeout` input shows `120`

- [ ] **Step 3: Confirm user editability still works**

Run: change the input to another valid value, save, and confirm the new value remains after refresh
Expected: user-entered timeout persists
