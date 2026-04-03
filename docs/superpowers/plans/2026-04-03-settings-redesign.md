# Settings Pages Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign all settings pages with pill sidebar navigation, split-pane layouts for list-management pages, and progressive disclosure for advanced settings.

**Architecture:** Create reusable `SettingsSplitPane`, `CollapsibleSection`, `ProfileCard`, and `Badge` components. Rewrite the settings sidebar nav to use pill-style items. Restructure the Providers, MCP Servers, and Skills sections as split-pane layouts. Lightly polish General and Account pages.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS v4, Lucide React icons, Framer Motion (already installed)

---

## File Structure

### New files to create:

| File | Responsibility |
|---|---|
| `components/settings/settings-split-pane.tsx` | Reusable two-panel layout with left list + right detail, responsive collapse |
| `components/settings/collapsible-section.tsx` | Clickable header + animated expand/collapse wrapper |
| `components/settings/badge.tsx` | Small colored label component (DEFAULT, NO KEY, BUILT-IN, HTTP, STDIO) |
| `components/settings/profile-card.tsx` | Left-panel list item (dot + name + subtitle + badges) |

### Files to modify:

| File | Change |
|---|---|
| `components/settings/settings-nav.tsx` | Replace colored swatch boxes with pill navigation |
| `app/settings/layout.tsx` | Remove `max-w-[55%]` constraint (let each page control its own width) |
| `components/settings/settings-card.tsx` | Update border-radius to 12px |
| `components/settings/sections/providers-section.tsx` | Full rewrite to split-pane layout |
| `components/settings/sections/mcp-servers-section.tsx` | Full rewrite to split-pane layout |
| `components/settings/sections/skills-section.tsx` | Full rewrite to split-pane layout |
| `components/settings/sections/general-section.tsx` | Visual polish, remove page header (sidebar provides context) |
| `components/settings/sections/account-section.tsx` | Visual polish, remove page header |

---

## Task 1: Create Badge Component

**Files:**
- Create: `components/settings/badge.tsx`

- [ ] **Step 1: Create the Badge component**

```tsx
import type { ReactNode } from "react";

type BadgeVariant = "default" | "no-key" | "builtin" | "http" | "stdio";

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  default:
    "bg-emerald-500/10 text-emerald-400",
  "no-key":
    "bg-amber-500/10 text-amber-400",
  builtin:
    "bg-amber-500/10 text-amber-400",
  http:
    "bg-sky-500/10 text-sky-400",
  stdio:
    "bg-emerald-500/10 text-emerald-400",
};

export function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${VARIANT_STYLES[variant]}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/badge.tsx
git commit -m "feat(settings): add Badge component"
```

---

## Task 2: Create CollapsibleSection Component

**Files:**
- Create: `components/settings/collapsible-section.tsx`

- [ ] **Step 1: Create the CollapsibleSection component**

Uses native HTML `<details>/<summary>` for zero-JS progressive enhancement, styled to match the dark theme. The chevron rotates on open via CSS.

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-white/6 overflow-hidden"
    >
      <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer bg-white/[0.01] hover:bg-white/[0.02] transition-colors select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2">
          {icon ? (
            <span className="text-[#71717a]">{icon}</span>
          ) : null}
          <span className="text-[0.82rem] font-medium text-[#a1a1aa]">{title}</span>
        </div>
        <ChevronDown className="h-3.5 w-3.5 text-[#52525b] transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 pt-2">
        {children}
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/collapsible-section.tsx
git commit -m "feat(settings): add CollapsibleSection component"
```

---

## Task 3: Create ProfileCard Component

**Files:**
- Create: `components/settings/profile-card.tsx`

- [ ] **Step 1: Create the ProfileCard component**

A generic left-panel list item. Used by Providers, MCP Servers, and Skills pages.

```tsx
import type { ReactNode } from "react";
import { Badge } from "./badge";

type ProfileCardProps = {
  isActive: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
  badges?: Array<{ variant: Parameters<typeof Badge>[0]["variant"]; label: string }>;
  rightSlot?: ReactNode;
};

export function ProfileCard({
  isActive,
  onClick,
  title,
  subtitle,
  badges,
  rightSlot,
}: ProfileCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl px-3 py-3 transition-all duration-200 cursor-pointer ${
        isActive
          ? "bg-[rgba(139,92,246,0.08)] border border-[rgba(139,92,246,0.2)]"
          : "border border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`h-2 w-2 rounded-full flex-shrink-0 ${
              isActive ? "bg-[#8b5cf6]" : "bg-[#3b3b3b]"
            }`}
          />
          <span
            className={`text-[0.82rem] truncate ${
              isActive ? "text-[#f4f4f5] font-medium" : "text-[#a1a1aa]"
            }`}
          >
            {title}
          </span>
          {badges?.map((badge) => (
            <Badge key={badge.label} variant={badge.variant}>
              {badge.label}
            </Badge>
          ))}
        </div>
        {rightSlot}
      </div>
      {subtitle ? (
        <p className="mt-1 truncate text-[0.7rem] text-[#52525b] pl-4">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/profile-card.tsx
git commit -m "feat(settings): add ProfileCard component"
```

---

## Task 4: Create SettingsSplitPane Component

**Files:**
- Create: `components/settings/settings-split-pane.tsx`

- [ ] **Step 1: Create the SettingsSplitPane component**

A responsive two-panel layout. On mobile (<768px), shows the list by default and overlays the detail panel when an item is selected.

```tsx
"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

type SettingsSplitPaneProps = {
  listPanel: ReactNode;
  detailPanel: ReactNode;
  isDetailVisible: boolean;
  onBack: () => void;
  listHeader: ReactNode;
};

export function SettingsSplitPane({
  listPanel,
  detailPanel,
  isDetailVisible,
  onBack,
  listHeader,
}: SettingsSplitPaneProps) {
  return (
    <div className="flex rounded-2xl border border-white/6 overflow-hidden bg-white/[0.02] md:h-full">
      {/* Left: List panel */}
      <div
        className={`w-full md:w-[280px] md:flex-shrink-0 md:border-r border-white/6 bg-[#0e0e0e] flex flex-col ${
          isDetailVisible ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="p-4 pb-2 flex items-center justify-between">
          {listHeader}
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-3 space-y-1">
          {listPanel}
        </div>
      </div>

      {/* Right: Detail panel */}
      <div
        className={`flex-1 overflow-y-auto bg-[#0a0a0a] ${
          isDetailVisible ? "flex flex-col" : "hidden md:flex md:flex-col"
        }`}
      >
        {/* Mobile back button */}
        <div className="md:hidden p-3 border-b border-white/6">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[0.78rem] text-[#71717a] hover:text-[#f4f4f5] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to list
          </button>
        </div>
        <div className="p-6 md:p-8">
          {detailPanel}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/settings-split-pane.tsx
git commit -m "feat(settings): add SettingsSplitPane component"
```

---

## Task 5: Update SettingsCard border-radius

**Files:**
- Modify: `components/settings/settings-card.tsx`

- [ ] **Step 1: Update border-radius from `rounded-2xl` to `rounded-xl` (12px)**

Change line in `components/settings/settings-card.tsx`:

Old: `<div className="rounded-2xl border border-white/6 bg-white/[0.02] p-6 space-y-5">`
New: `<div className="rounded-xl border border-white/6 bg-white/[0.02] p-6 space-y-5">`

- [ ] **Step 2: Commit**

```bash
git add components/settings/settings-card.tsx
git commit -m "style(settings): update SettingsCard border-radius to 12px"
```

---

## Task 6: Redesign Settings Sidebar Nav (Pill Navigation)

**Files:**
- Modify: `components/settings/settings-nav.tsx`

- [ ] **Step 1: Rewrite settings-nav.tsx with pill navigation**

Replace the entire file contents. Key changes:
- Remove per-item `color`, `activeBg`, `activeBorder` fields from `NAV_ITEMS`
- Remove the `h-8 w-8 rounded-lg bg-[color]` swatch box
- Add pill-style items with consistent accent purple active state
- Keep the back arrow + "Settings" header unchanged
- Switch from `window.location.href` to `router.push` for client-side navigation

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Settings,
  Sparkles,
  Server,
  Zap,
  Shield,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/providers", label: "Providers", icon: Sparkles },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server },
  { href: "/settings/skills", label: "Skills", icon: Zap },
  { href: "/settings/account", label: "Account", icon: Shield },
] as const;

export function SettingsNav({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3">
        <Link
          href="/"
          onClick={(event) => {
            if (
              !event.defaultPrevented &&
              !event.metaKey &&
              !event.ctrlKey &&
              event.button === 0
            ) {
              event.preventDefault();
              onClose();
              router.push("/");
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors duration-200"
          aria-label="Back to chat"
        >
          <ArrowLeft className="h-3.5 w-3.5 text-white/60" />
        </Link>
        <span className="text-sm font-semibold text-[var(--text)]">
          Settings
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => {
                if (
                  !event.defaultPrevented &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  event.button === 0
                ) {
                  event.preventDefault();
                  router.push(item.href);
                }
              }}
              className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 transition-all duration-200 ${
                isActive
                  ? "bg-[rgba(139,92,246,0.10)] border border-[rgba(139,92,246,0.25)]"
                  : "border border-transparent text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)]"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${
                  isActive ? "text-[#8b5cf6]" : "text-[#71717a]"
                }`}
              />
              <span
                className={`text-[13px] ${
                  isActive
                    ? "text-[var(--text)] font-medium"
                    : ""
                }`}
              >
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

- [ ] **Step 2: Verify sidebar renders correctly**

Start dev server and navigate to `/settings/general`. Confirm:
- Pill-shaped nav items with rounded corners
- Active item has purple background tint + border
- Inactive items are muted with transparent borders
- No colored swatch boxes remain
- Back arrow and "Settings" header still work

- [ ] **Step 3: Commit**

```bash
git add components/settings/settings-nav.tsx
git commit -m "feat(settings): redesign sidebar with pill navigation"
```

---

## Task 7: Update Settings Layout

**Files:**
- Modify: `app/settings/layout.tsx`

- [ ] **Step 1: Remove max-width constraint from settings layout**

The split-pane pages need the full width. Change `app/settings/layout.tsx`:

Old:
```tsx
<main className="flex-1 overflow-y-auto p-6 md:p-8 animate-fade-in">
  <div className="max-w-[55%]">
    {children}
  </div>
</main>
```

New:
```tsx
<main className="flex-1 overflow-y-auto animate-fade-in">
  {children}
</main>
```

Each page section will manage its own padding and max-width internally. Single-column pages (General, Account) will add their own `max-w-[55%] p-6 md:p-8` wrapper. Split-pane pages will fill the available space.

- [ ] **Step 2: Commit**

```bash
git add app/settings/layout.tsx
git commit -m "refactor(settings): remove global max-width constraint from layout"
```

---

## Task 8: Rewrite Providers Section (Split Pane)

**Files:**
- Modify: `components/settings/sections/providers-section.tsx`

This is the largest task. The component goes from a 570-line single-card form to a split-pane layout with progressive disclosure.

- [ ] **Step 1: Rewrite providers-section.tsx**

Key changes:
- Remove the page-level header (`h1` + subtitle) — the sidebar provides context now
- Wrap everything in `SettingsSplitPane`
- Left panel: list of `ProfileCard` items with "Add" button
- Right panel: essential fields always visible + two `CollapsibleSection` blocks
- Move advanced fields (temperature, tokens, reasoning, etc.) into "Advanced Settings" collapsible
- Move system prompt + workspace skills into "System Prompt & Skills" collapsible
- Keep all existing state management, API calls, and form logic unchanged
- Add `isDetailVisible`/`onBack` state for mobile responsive behavior
- Wrap in a full-height container with own padding

The component should look like this structure:

```
<div className="h-full p-6 md:p-8">
  <SettingsSplitPane
    listHeader={... "Providers" title + count + add button ...}
    listPanel={... ProfileCard for each profile ...}
    isDetailVisible={selectedId !== null on mobile}
    onBack={() => setMobileDetailVisible(false)}
    detailPanel={
      <div className="max-w-[560px]">
        {/* Profile header with name, actions */}
        {/* Essential fields: preset, name, URL+model, API key */}
        <CollapsibleSection title="Advanced Settings" icon={<SettingsIcon />}>
          {/* 2-col grid: temperature, tokens, reasoning, etc. */}
        </CollapsibleSection>
        <CollapsibleSection title="System Prompt & Skills" icon={<FileTextIcon />}>
          {/* system prompt textarea, skills checkbox */}
        </CollapsibleSection>
        {/* Save button */}
      </div>
    }
  />
</div>
```

All existing state variables (`providerProfiles`, `selectedProviderProfileId`, `defaultProviderProfileId`, `skillsEnabled`, etc.) and all existing functions (`handleSettings`, `runConnectionTest`, `addProviderProfile`, `removeProviderProfile`, `updateActiveProviderProfile`, `applyPresetToActiveProviderProfile`) remain unchanged. Only the JSX return structure changes.

The left panel renders one `ProfileCard` per profile in `providerProfiles`. Each card shows:
- `title`: `profile.name`
- `subtitle`: `${profile.model} · ${profile.apiMode}`
- `badges`: `DEFAULT` if `profile.id === defaultProviderProfileId`, `NO KEY` if `!profile.hasApiKey && !profile.apiKey`
- `isActive`: `profile.id === selectedProviderProfileId`
- `onClick`: `() => { setSelectedProviderProfileId(profile.id); setMobileDetailVisible(true); }`

The right panel shows the editor for `activeProviderProfile`. Essential fields (provider preset, profile name, API base URL + model in 2-col, API key) are always visible. Advanced fields go in a `CollapsibleSection`. System prompt + skills go in a second `CollapsibleSection`.

The "Default" radio and delete button move to the right panel header (next to Test and profile name).

- [ ] **Step 2: Verify Providers page renders correctly**

Navigate to `/settings/providers`. Confirm:
- Left panel shows profile list with badges
- Clicking a profile shows its settings on the right
- Essential fields are always visible
- Advanced sections are collapsed by default, expand on click
- Save, Test, and Delete still work
- Adding a new profile works
- Setting default profile works

- [ ] **Step 3: Commit**

```bash
git add components/settings/sections/providers-section.tsx
git commit -m "feat(settings): rewrite providers page as split-pane with progressive disclosure"
```

---

## Task 9: Rewrite MCP Servers Section (Split Pane)

**Files:**
- Modify: `components/settings/sections/mcp-servers-section.tsx`

- [ ] **Step 1: Rewrite mcp-servers-section.tsx**

Key changes:
- Remove page-level header
- Wrap in `SettingsSplitPane`
- Left panel: list of `ProfileCard` items for each server, with on/off toggle as `rightSlot`, and `HTTP`/`STDIO` badge
- Right panel: server config form (always visible, no collapsible needed — MCP server configs are short)
- Keep all existing state management and API calls
- "Add MCP server" becomes the add button in list header
- When adding, a new empty entry is added to the list and auto-selected

The left panel renders one `ProfileCard` per server in `mcpServers`. Each card shows:
- `title`: `server.name`
- `subtitle`: server URL or command
- `badges`: `HTTP` or `STDIO` based on `server.transport`
- `isActive`: `server.id === selectedServerId`
- `rightSlot`: on/off checkbox toggle
- `onClick`: `() => { setSelectedServerId(server.id); setMobileDetailVisible(true); }`

The right panel shows the editor form for the selected server (or a new server form). Fields: Name, Transport dropdown, then conditional fields (URL+Headers for HTTP, Command+Args+Env for stdio).

Move the existing form state (currently shown/hidden via `showMcpForm`) into the right panel permanently — when no server is selected and not adding, show an empty state message.

- [ ] **Step 2: Verify MCP Servers page renders correctly**

Navigate to `/settings/mcp-servers`. Confirm:
- Left panel shows server list with transport badges and toggles
- Clicking a server shows its config on the right
- Add, Edit, Delete, Test all work
- Toggling server on/off works from the left panel

- [ ] **Step 3: Commit**

```bash
git add components/settings/sections/mcp-servers-section.tsx
git commit -m "feat(settings): rewrite MCP servers page as split-pane"
```

---

## Task 10: Rewrite Skills Section (Split Pane)

**Files:**
- Modify: `components/settings/sections/skills-section.tsx`

- [ ] **Step 1: Rewrite skills-section.tsx**

Key changes:
- Remove page-level header
- Wrap in `SettingsSplitPane`
- Left panel: list of `ProfileCard` items for each skill, with on/off toggle as `rightSlot`, and `BUILT-IN` badge where applicable
- Right panel: skill editor form (name, description, instructions textarea)
- Keep all existing state management and API calls
- "Add skill" becomes the add button in list header
- Delete button hidden for built-in skills

The left panel renders one `ProfileCard` per skill in `skills`. Each card shows:
- `title`: `skill.name`
- `subtitle`: `skill.description` (truncated)
- `badges`: `BUILT-IN` if `skill.id.startsWith("builtin-")`
- `isActive`: `skill.id === selectedSkillId`
- `rightSlot`: on/off checkbox toggle
- `onClick`: `() => { setSelectedSkillId(skill.id); setMobileDetailVisible(true); }`

The right panel shows the editor for the selected skill. For built-in skills, show name and description read-only with no delete button.

- [ ] **Step 2: Verify Skills page renders correctly**

Navigate to `/settings/skills`. Confirm:
- Left panel shows skill list with built-in badges and toggles
- Clicking a skill shows its content on the right
- Add, Edit, Delete work for custom skills
- Built-in skills show read-only, no delete

- [ ] **Step 3: Commit**

```bash
git add components/settings/sections/skills-section.tsx
git commit -m "feat(settings): rewrite skills page as split-pane"
```

---

## Task 11: Polish General Page

**Files:**
- Modify: `components/settings/sections/general-section.tsx`

- [ ] **Step 1: Add padding wrapper and remove page-level header**

Since the layout no longer provides padding or max-width, wrap the content in a padded, max-width container. Remove the `h1` + subtitle (sidebar provides context). Update card styling.

Replace the return JSX. Keep all state and `save()` logic unchanged. Changes to the JSX:

1. Wrap everything in `<div className="max-w-[55%] p-6 md:p-8 space-y-6">`
2. Remove the page header block (`h1` "General" + subtitle)
3. Keep the two `SettingsCard` blocks as-is (border-radius was already updated in Task 5)
4. Keep the save button and error display

- [ ] **Step 2: Verify General page renders correctly**

Navigate to `/settings/general`. Confirm:
- Cards display with updated border-radius
- Save still works
- No page-level header (sidebar context is sufficient)

- [ ] **Step 3: Commit**

```bash
git add components/settings/sections/general-section.tsx
git commit -m "style(settings): polish general page layout"
```

---

## Task 12: Polish Account Page

**Files:**
- Modify: `components/settings/sections/account-section.tsx`

- [ ] **Step 1: Add padding wrapper and remove page-level header**

Same pattern as General. Wrap in padded max-width container. Remove the `h1` + subtitle. Keep the two cards (Local Access form + Sign Out).

Replace the return JSX. Keep all state and handlers unchanged. Changes:

1. Wrap everything in `<div className="max-w-[55%] p-6 md:p-8 space-y-6">`
2. Remove the page header block (`h1` "Account" + subtitle)
3. Keep both cards as-is

- [ ] **Step 2: Verify Account page renders correctly**

Navigate to `/settings/account`. Confirm:
- Cards display correctly
- Update account and Sign out still work

- [ ] **Step 3: Commit**

```bash
git add components/settings/sections/account-section.tsx
git commit -m "style(settings): polish account page layout"
```

---

## Task 13: Final Visual Validation

- [ ] **Step 1: Start dev server and visit every settings page**

Visit in order:
1. `/settings/general` — cards look clean, no header, save works
2. `/settings/providers` — split pane, profile list, progressive disclosure, save/test
3. `/settings/mcp-servers` — split pane, server list, add/edit/test
4. `/settings/skills` — split pane, skill list, add/edit
5. `/settings/account` — cards clean, update/sign-out work

- [ ] **Step 2: Test sidebar navigation**

Click each sidebar item in order. Confirm:
- Pill active state switches correctly
- Client-side navigation (no full page reload)
- Back arrow returns to chat

- [ ] **Step 3: Test responsive behavior**

Resize browser to mobile width (<768px). Confirm:
- Split-pane pages show list by default
- Tapping an item shows the detail with a back button
- Back button returns to list

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix(settings): final visual polish and responsive fixes"
```
