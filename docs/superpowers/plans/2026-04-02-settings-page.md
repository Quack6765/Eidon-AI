# Settings Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic settings page with a ChatGPT-style layout: sidebar nav with icon+label rows for each section, one section at a time in the content area, and a back button to return to chat.

**Architecture:** Split `settings-form.tsx` (1280 lines) into 5 focused section components behind nested routes (`/settings/general`, `/settings/providers`, etc.). The `Shell` component conditionally renders either the conversation sidebar or a new `SettingsNav` component based on the current route. A shared `settings/layout.tsx` wraps all settings pages.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, framer-motion, lucide-react, SQLite (better-sqlite3)

---

## File Map

### New files
- `app/settings/layout.tsx` — Shared settings layout (server component, wraps children in `Shell`)
- `app/settings/general/page.tsx` — General section page
- `app/settings/providers/page.tsx` — Providers section page
- `app/settings/mcp-servers/page.tsx` — MCP Servers section page
- `app/settings/skills/page.tsx` — Skills section page
- `app/settings/account/page.tsx` — Account section page
- `components/settings/settings-nav.tsx` — Settings sidebar navigation
- `components/settings/sections/general-section.tsx` — General settings form
- `components/settings/sections/providers-section.tsx` — Provider profiles form
- `components/settings/sections/mcp-servers-section.tsx` — MCP servers form
- `components/settings/sections/skills-section.tsx` — Skills form
- `components/settings/sections/account-section.tsx` — Account form

### Modified files
- `components/shell.tsx` — Conditional sidebar rendering (chat vs settings nav)
- `app/settings/page.tsx` — Replace with redirect to `/settings/general`
- `lib/types.ts` — Add `ConversationRetention` type, extend `AppSettings`
- `lib/settings.ts` — Add DB migration for new columns, read/write new fields
- `lib/db.ts` — Add migration for new `app_settings` columns
- `lib/constants.ts` — Add default values for new settings

### Deleted files
- `components/settings-form.tsx` — Fully replaced by section components

---

### Task 1: Add General settings data fields

**Files:**
- Modify: `lib/types.ts:54-58`
- Modify: `lib/constants.ts`
- Modify: `lib/db.ts:299-306`
- Modify: `lib/settings.ts:17-31,37-65,67-71,92-98,250-372`

- [ ] **Step 1: Add `ConversationRetention` type and extend `AppSettings` in `lib/types.ts`**

Add after the `ApiMode` type (line 1):

```typescript
export type ConversationRetention = "forever" | "90d" | "30d" | "7d";
```

Update the `AppSettings` type (line 54-58) to include new fields:

```typescript
export type AppSettings = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  autoCompaction: boolean;
  updatedAt: string;
};
```

- [ ] **Step 2: Add default constants in `lib/constants.ts`**

Add after line 6 (`DEFAULT_SKILLS_ENABLED`):

```typescript
export const DEFAULT_CONVERSATION_RETENTION: ConversationRetention = "forever";
export const DEFAULT_AUTO_COMPACTION = true;
```

Import `ConversationRetention` from `@/lib/types`.

- [ ] **Step 3: Add DB migration for new columns in `lib/db.ts`**

In the `migrate` function, after the existing `settingsCols` migration block (after line 306), add:

```typescript
if (!settingsColNames.includes("conversation_retention")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN conversation_retention TEXT NOT NULL DEFAULT 'forever'");
}
if (!settingsColNames.includes("auto_compaction")) {
  db.exec("ALTER TABLE app_settings ADD COLUMN auto_compaction INTEGER NOT NULL DEFAULT 1");
}
```

- [ ] **Step 4: Update `lib/settings.ts` — schema, row type, and row mapper**

Update the `settingsSchema` (line 37-65) to include new fields:

```typescript
const settingsSchema = z
  .object({
    defaultProviderProfileId: z.string().min(1),
    skillsEnabled: z.coerce.boolean(),
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]),
    autoCompaction: z.coerce.boolean(),
    providerProfiles: z.array(providerProfileInputSchema).min(1)
  })
  .superRefine(/* same as existing */);
```

Update `AppSettingsRow` type (line 67-71):

```typescript
type AppSettingsRow = {
  default_provider_profile_id: string;
  skills_enabled: number;
  conversation_retention: string;
  auto_compaction: number;
  updated_at: string;
};
```

Update `rowToSettings` (line 92-98):

```typescript
function rowToSettings(row: AppSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention as AppSettings["conversationRetention"],
    autoCompaction: Boolean(row.auto_compaction),
    updatedAt: row.updated_at
  };
}
```

Update `updateSettings` to save new fields in the SQL (the `UPDATE app_settings` statement around line 354-366):

```typescript
getDb()
  .prepare(
    `UPDATE app_settings
     SET default_provider_profile_id = ?,
         skills_enabled = ?,
         conversation_retention = ?,
         auto_compaction = ?,
         updated_at = ?
     WHERE id = ?`
  )
  .run(
    parsed.defaultProviderProfileId,
    parsed.skillsEnabled ? 1 : 0,
    parsed.conversationRetention,
    parsed.autoCompaction ? 1 : 0,
    timestamp,
    SETTINGS_ROW_ID
  );
```

Update `getSettings` query (line 191-203) to include new columns:

```typescript
export function getSettings() {
  const row = getDb()
    .prepare(
      `SELECT
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as AppSettingsRow;

  return rowToSettings(row);
}
```

Update `getSanitizedSettings` query similarly to include the new columns.

- [ ] **Step 5: Verify the app starts without errors**

Run: `npm run dev`
Expected: App starts, settings page loads with no console errors

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/constants.ts lib/db.ts lib/settings.ts
git commit -m "feat: add general settings data fields (conversation retention, auto-compaction)"
```

---

### Task 2: Create shared settings UI components

**Files:**
- Create: `components/settings/settings-card.tsx`
- Create: `components/settings/setting-row.tsx`

- [ ] **Step 1: Create `components/settings/settings-card.tsx`**

```tsx
export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/settings/setting-row.tsx`**

```tsx
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-xs text-[var(--muted)]">{description}</div>
        ) : null}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/settings-card.tsx components/settings/setting-row.tsx
git commit -m "feat: add shared settings UI components (SettingsCard, SettingRow)"
```

---

### Task 3: Create the SettingsNav sidebar component

**Files:**
- Create: `components/settings/settings-nav.tsx`

- [ ] **Step 1: Create `components/settings/settings-nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Settings, Sparkles, Server, Zap, Shield } from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings, color: "bg-[#8b5cf6]", activeBg: "bg-[#8b5cf6]/15", activeBorder: "border-[#8b5cf6]/30" },
  { href: "/settings/providers", label: "Providers", icon: Sparkles, color: "bg-[#1e293b]", activeBg: "bg-[#1e293b]", activeBorder: "border-[#1e293b]" },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server, color: "bg-[#0ea5e9]", activeBg: "bg-[#0ea5e9]/15", activeBorder: "border-[#0ea5e9]/30" },
  { href: "/settings/skills", label: "Skills", icon: Zap, color: "bg-[#f59e0b]", activeBg: "bg-[#f59e0b]/15", activeBorder: "border-[#f59e0b]/30" },
  { href: "/settings/account", label: "Account", icon: Shield, color: "bg-[#38bdf8]", activeBg: "bg-[#38bdf8]/15", activeBorder: "border-[#38bdf8]/30" },
] as const;

export function SettingsNav({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <Link
          href="/"
          onClick={(event) => {
            if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && event.button === 0) {
              event.preventDefault();
              onClose();
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors duration-200"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-white/60" />
        </Link>
        <span className="text-sm font-semibold text-[var(--text)]">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => {
                if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && event.button === 0) {
                  event.preventDefault();
                  window.location.href = item.href;
                }
              }}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-all duration-200 ${
                isActive
                  ? `${item.activeBg} border ${item.activeBorder}`
                  : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]"
              }`}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.color}`}>
                <Icon className="h-4 w-4 text-white" />
              </div>
              <span className={`text-[13px] ${isActive ? "text-[var(--text)] font-medium" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/settings-nav.tsx
git commit -m "feat: add SettingsNav sidebar component"
```

---

### Task 4: Modify Shell to conditionally render settings nav

**Files:**
- Modify: `components/shell.tsx`

- [ ] **Step 1: Add settings nav rendering to Shell**

Update `components/shell.tsx`:

1. Add import for `SettingsNav`:
```typescript
import { SettingsNav } from "@/components/settings/settings-nav";
```

2. Add an `isSettingsPage` derived variable after the existing pathname usage (after line 18):
```typescript
const isSettingsPage = pathname.startsWith("/settings");
```

3. Replace the `<Sidebar>` rendering (line 44) with conditional rendering:

```tsx
{isSettingsPage ? (
  <SettingsNav onClose={() => setIsSidebarOpen(false)} />
) : (
  <Sidebar conversationPage={conversationPage} folders={folders} onClose={() => setIsSidebarOpen(false)} />
)}
```

- [ ] **Step 2: Verify the sidebar swaps correctly**

Run: `npm run dev`
Navigate to `/settings` — should see the SettingsNav instead of conversation list.
Navigate to `/` — should see the conversation list.
Open on mobile — settings nav should appear in the slide-in overlay.

- [ ] **Step 3: Commit**

```bash
git add components/shell.tsx
git commit -m "feat: conditionally render SettingsNav in Shell on settings routes"
```

---

### Task 5: Create settings layout and redirect

**Files:**
- Create: `app/settings/layout.tsx`
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Create `app/settings/layout.tsx`**

```tsx
import { Shell } from "@/components/shell";
import { listConversationsPage } from "@/lib/conversations";
import { listFolders } from "@/lib/folders";
import { requireUser } from "@/lib/auth";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const conversationPage = listConversationsPage();
  const folders = listFolders();

  return (
    <Shell conversationPage={conversationPage} folders={folders}>
      <main className="flex-1 overflow-y-auto p-6 md:p-8 animate-fade-in">
        <div className="max-w-[55%]">
          {children}
        </div>
      </main>
    </Shell>
  );
}
```

- [ ] **Step 2: Replace `app/settings/page.tsx` with redirect**

Replace the entire content of `app/settings/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function SettingsPage() {
  redirect("/settings/general");
}
```

- [ ] **Step 3: Commit**

```bash
git add app/settings/layout.tsx app/settings/page.tsx
git commit -m "feat: add settings layout with redirect to /settings/general"
```

---

### Task 6: Extract the General section component

**Files:**
- Create: `app/settings/general/page.tsx`
- Create: `components/settings/sections/general-section.tsx`

- [ ] **Step 1: Create `components/settings/sections/general-section.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingRow } from "@/components/settings/setting-row";
import type { AppSettings, ConversationRetention } from "@/lib/types";

export function GeneralSection({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [isPending] = useTransition();
  const [conversationRetention, setConversationRetention] = useState<ConversationRetention>(
    settings.conversationRetention
  );
  const [autoCompaction, setAutoCompaction] = useState(settings.autoCompaction);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setError("");
    setSuccess("");

    const current = await fetch("/api/settings").then((r) => r.json()) as {
      settings: { defaultProviderProfileId: string; skillsEnabled: boolean; providerProfiles: unknown[] };
    };

    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultProviderProfileId: current.settings.defaultProviderProfileId,
        skillsEnabled: current.settings.skillsEnabled,
        conversationRetention,
        autoCompaction,
        providerProfiles: current.settings.providerProfiles,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Unable to save settings");
      return;
    }
    setSuccess("Settings saved.");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
          General
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Configure default conversation behavior and preferences.
        </p>
      </div>

      <SettingsCard title="Conversation Retention">
        <SettingRow
          label="Keep conversations for"
          description="Older conversations will be automatically deleted"
        >
          <select
            value={conversationRetention}
            onChange={(e) => setConversationRetention(e.target.value as ConversationRetention)}
            className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]/30 transition-all duration-200"
          >
            <option value="forever">Forever</option>
            <option value="90d">90 days</option>
            <option value="30d">30 days</option>
            <option value="7d">7 days</option>
          </select>
        </SettingRow>
      </SettingsCard>

      <SettingsCard title="Auto-Compaction">
        <SettingRow
          label="Enable auto-compaction"
          description="Compact long conversations to stay within context limits"
        >
          <label className="relative inline-flex h-5 w-9 cursor-pointer items-center">
            <input
              type="checkbox"
              checked={autoCompaction}
              onChange={(e) => setAutoCompaction(e.target.checked)}
              className="peer sr-only"
            />
            <div className="h-5 w-9 rounded-full bg-white/10 transition-colors peer-checked:bg-[var(--accent)] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
          </label>
        </SettingRow>
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={isPending}>
          Save settings
        </Button>
        {success ? <span className="text-sm text-emerald-400">{success}</span> : null}
      </div>

      {error ? (
        <div className="rounded-xl bg-red-500/8 border border-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create `app/settings/general/page.tsx`**

```tsx
import { GeneralSection } from "@/components/settings/sections/general-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function GeneralPage() {
  await requireUser();
  const settings = getSanitizedSettings();

  return <GeneralSection settings={settings} />;
}
```

- [ ] **Step 3: Verify the General section renders**

Run: `npm run dev`
Navigate to `/settings/general` — should see the General section with conversation retention dropdown and auto-compaction toggle.

- [ ] **Step 4: Commit**

```bash
git add app/settings/general/page.tsx components/settings/sections/general-section.tsx
git commit -m "feat: add General settings section with conversation retention and auto-compaction"
```

---

### Task 7: Extract the Providers section component

**Files:**
- Create: `app/settings/providers/page.tsx`
- Create: `components/settings/sections/providers-section.tsx`

- [ ] **Step 1: Create `components/settings/sections/providers-section.tsx`**

Extract the provider-related logic from `components/settings-form.tsx` (lines 51-283, 530-881) into a standalone component. This includes:

- Types: `SettingsPayload`, `ProviderProfileDraft`
- State: `defaultProviderProfileId`, `skillsEnabled`, `selectedProviderProfileId`, `providerProfiles`
- Computed: `activeProviderProfile`, `visibleReasoningSupported`, `activeProviderPresetId`
- Functions: `updateActiveProviderProfile`, `addProviderProfile`, `applyPresetToActiveProviderProfile`, `removeProviderProfile`, `handleSettings`, `runConnectionTest`
- JSX: The entire provider form (profile cards, preset selector, all input fields, save/test buttons)

The component receives `{ settings }` as a prop (same `SettingsPayload` type from the current code).

Key differences from the monolith:
- Only renders the provider card (lines 533-881), not MCP/Skills/Account
- The `skillsEnabled` toggle stays inside providers since it's a provider-level setting
- Card structure uses the existing `rounded-2xl border border-white/6 bg-white/[0.02] p-6` pattern but is wrapped inside the 55% max-width from the layout
- The section heading and description are added at the top:
```tsx
<h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
  Providers
</h1>
<p className="mt-1 text-sm text-[var(--muted)]">
  Manage provider profiles and runtime configuration.
</p>
```

The form fields use the existing `Input`, `Label`, `Textarea`, `Button` components and the same select styling.

- [ ] **Step 2: Create `app/settings/providers/page.tsx`**

```tsx
import { ProvidersSection } from "@/components/settings/sections/providers-section";
import { getSanitizedSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";

export default async function ProvidersPage() {
  await requireUser();
  const settings = getSanitizedSettings();

  return <ProvidersSection settings={settings} />;
}
```

- [ ] **Step 3: Verify providers section works**

Run: `npm run dev`
Navigate to `/settings/providers` — should see the provider profile list, configuration form, save/test buttons. Should be able to add/edit/delete profiles and save.

- [ ] **Step 4: Commit**

```bash
git add app/settings/providers/page.tsx components/settings/sections/providers-section.tsx
git commit -m "feat: extract Providers section from monolithic settings form"
```

---

### Task 8: Extract the MCP Servers section component

**Files:**
- Create: `app/settings/mcp-servers/page.tsx`
- Create: `components/settings/sections/mcp-servers-section.tsx`

- [ ] **Step 1: Create `components/settings/sections/mcp-servers-section.tsx`**

Extract the MCP-related logic from `components/settings-form.tsx` (lines 94-107, 285-467, 883-1076) into a standalone component. This includes:

- State: `mcpServers`, `showMcpForm`, `mcpTransport`, `mcpName`, `mcpUrl`, `mcpHeaders`, `mcpCommand`, `mcpArgs`, `mcpEnv`, `editingMcpId`, `mcpDraftTestResult`, `mcpRowTestResults`, `mcpTestingTarget`
- Functions: `saveMcpServer`, `testMcpServer`, `deleteMcpServer`, `toggleMcpServer`, `editMcpServer`, `resetMcpForm`
- JSX: The MCP servers card (lines 883-1076)
- The `error` state and `setError` call from `testMcpServer`

This is a self-contained component — it receives no props and manages its own data via `/api/mcp-servers` endpoints. It fetches servers on mount with `useEffect`.

Section heading:
```tsx
<h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
  MCP Servers
</h1>
<p className="mt-1 text-sm text-[var(--muted)]">
  Add HTTP streamable or local stdio MCP servers to make external tools available in chat.
</p>
```

Uses existing `Server` icon from lucide-react, same card styling.

- [ ] **Step 2: Create `app/settings/mcp-servers/page.tsx`**

```tsx
import { McpServersSection } from "@/components/settings/sections/mcp-servers-section";
import { requireUser } from "@/lib/auth";

export default async function McpServersPage() {
  await requireUser();
  return <McpServersSection />;
}
```

- [ ] **Step 3: Verify MCP servers section works**

Run: `npm run dev`
Navigate to `/settings/mcp-servers` — should see the server list, add/edit form, test/delete buttons.

- [ ] **Step 4: Commit**

```bash
git add app/settings/mcp-servers/page.tsx components/settings/sections/mcp-servers-section.tsx
git commit -m "feat: extract MCP Servers section from monolithic settings form"
```

---

### Task 9: Extract the Skills section component

**Files:**
- Create: `app/settings/skills/page.tsx`
- Create: `components/settings/sections/skills-section.tsx`

- [ ] **Step 1: Create `components/settings/sections/skills-section.tsx`**

Extract the Skills-related logic from `components/settings-form.tsx` (lines 108-113, 469-528, 1078-1198) into a standalone component. This includes:

- State: `skills`, `showSkillForm`, `skillName`, `skillDescription`, `skillContent`, `editingSkillId`
- Functions: `saveSkill`, `deleteSkill`, `toggleSkill`, `editSkill`, `resetSkillForm`
- JSX: The Skills card (lines 1078-1198)

Self-contained component — fetches skills via `/api/skills` on mount.

Section heading:
```tsx
<h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
  Skills
</h1>
<p className="mt-1 text-sm text-[var(--muted)]">
  Skills expose name and description first, then load full instructions when the agent requests them.
</p>
```

Uses existing `Zap` icon, same card styling.

- [ ] **Step 2: Create `app/settings/skills/page.tsx`**

```tsx
import { SkillsSection } from "@/components/settings/sections/skills-section";
import { requireUser } from "@/lib/auth";

export default async function SkillsPage() {
  await requireUser();
  return <SkillsSection />;
}
```

- [ ] **Step 3: Verify skills section works**

Run: `npm run dev`
Navigate to `/settings/skills` — should see the skill list, add/edit form.

- [ ] **Step 4: Commit**

```bash
git add app/settings/skills/page.tsx components/settings/sections/skills-section.tsx
git commit -m "feat: extract Skills section from monolithic settings form"
```

---

### Task 10: Extract the Account section component

**Files:**
- Create: `app/settings/account/page.tsx`
- Create: `components/settings/sections/account-section.tsx`

- [ ] **Step 1: Create `components/settings/sections/account-section.tsx`**

Extract the Account-related logic from `components/settings-form.tsx` (lines 63, 247-267, 280-283, 1201-1278) into a standalone component. This includes:

- State: `error`, `accountSuccess`
- Functions: `handleAccount`, `logout`
- JSX: The account form and sign out card (lines 1201-1278)

Props: `{ user: AuthUser }`

Section heading:
```tsx
<h1 className="text-2xl font-semibold text-[var(--text)]" style={{ fontFamily: "var(--font-display)" }}>
  Account
</h1>
<p className="mt-1 text-sm text-[var(--muted)]">
  Manage your local access credentials and session.
</p>
```

Uses existing `Shield`, `LogOut` icons, same card styling.

- [ ] **Step 2: Create `app/settings/account/page.tsx`**

```tsx
import { AccountSection } from "@/components/settings/sections/account-section";
import { requireUser } from "@/lib/auth";

export default async function AccountPage() {
  const user = await requireUser();
  return <AccountSection user={user} />;
}
```

- [ ] **Step 3: Verify account section works**

Run: `npm run dev`
Navigate to `/settings/account` — should see the username/password form and sign out button.

- [ ] **Step 4: Commit**

```bash
git add app/settings/account/page.tsx components/settings/sections/account-section.tsx
git commit -m "feat: extract Account section from monolithic settings form"
```

---

### Task 11: Delete the monolithic settings form

**Files:**
- Delete: `components/settings-form.tsx`

- [ ] **Step 1: Remove `components/settings-form.tsx`**

```bash
rm components/settings-form.tsx
```

- [ ] **Step 2: Search for any remaining imports of `settings-form`**

Run: `grep -r "settings-form" --include="*.ts" --include="*.tsx" .`
Expected: No results (the old `app/settings/page.tsx` was replaced in Task 5)

- [ ] **Step 3: Verify all settings pages still work**

Run: `npm run dev`
Navigate to each settings route and verify:
- `/settings` redirects to `/settings/general`
- `/settings/general` renders General section
- `/settings/providers` renders Providers section
- `/settings/mcp-servers` renders MCP Servers section
- `/settings/skills` renders Skills section
- `/settings/account` renders Account section
- Back arrow in settings nav returns to `/`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove monolithic settings-form.tsx"
```

---

### Task 12: UI validation and polish

**Files:**
- Potentially modify: any settings section components for visual consistency

- [ ] **Step 1: Start dev server and validate with agent-browser**

Run: `npm run dev`
Use `agent-browser` skill to:
1. Open `http://localhost:3000/settings/general`
2. Take screenshot to verify layout, sidebar nav, card styling
3. Test clicking each sidebar nav item
4. Test the back arrow returns to chat
5. Test on mobile viewport (responsive)
6. Verify the 55% max-width on cards
7. Test form interactions (dropdown, toggle, inputs)

- [ ] **Step 2: Fix any visual inconsistencies found during validation**

Common things to check:
- Card spacing and padding matches the mockups
- Active sidebar item has correct tinted background and border
- Hover states work on inactive sidebar items
- Section headings and descriptions use correct typography
- Mobile sidebar opens/closes correctly
- Transition between chat and settings is smooth

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix: polish settings page layout and interactions"
```
