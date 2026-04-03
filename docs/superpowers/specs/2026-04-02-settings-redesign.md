# Settings Pages Redesign

**Date**: 2026-04-02
**Status**: Approved

## Problem

The settings/providers page is cramped and visually heavy. All fields for a provider profile are visible at once in a dense 2-column grid with no progressive disclosure. The settings sidebar uses colored swatch boxes that feel inconsistent. Other settings pages (MCP Servers, Skills, Account, General) lack visual cohesion.

## Goals

- Reduce information density on the Providers page through progressive disclosure
- Unify the visual style across all settings sub-pages
- Upgrade the settings sidebar to a cleaner, more modern pill navigation
- Apply consistent split-pane UX to all list-management pages

## Design

### 1. Settings Sidebar — Pill Navigation

**File**: `components/settings/settings-nav.tsx`

Replace the current colored swatch boxes with pill-shaped nav items:

- Each item: `border-radius: 10px`, inline Lucide outline icon (16px) + text label
- **Active state**: `background: rgba(139,92,246,0.10)`, `border: 1px solid rgba(139,92,246,0.25)`, icon and text in accent purple
- **Inactive state**: transparent border/background, `color: #a1a1aa`, icon in `#71717a`
- Remove the `h-8 w-8 rounded-lg bg-[color]` swatch boxes entirely
- Keep the back arrow + "Settings" header as-is
- Padding between items: `4px` gap

**Navigation items** (unchanged routes and icons):

| Label | Lucide Icon | Route |
|---|---|---|
| General | `Settings` | `/settings/general` |
| Providers | `Sparkles` | `/settings/providers` |
| MCP Servers | `Server` | `/settings/mcp-servers` |
| Skills | `Zap` | `/settings/skills` |
| Account | `Shield` | `/settings/account` |

### 2. Providers Page — Split Pane

**Files**: `app/settings/providers/page.tsx`, `components/settings/sections/providers-section.tsx`

Replace the single-card form with a two-panel layout.

#### Left Panel — Profile List (~260px fixed)

- Header: "Providers" title + profile count + "Add" button (icon-only `+` circle)
- Each profile card shows:
  - Small dot indicator (accent purple for active, `#3b3b3b` for inactive)
  - Profile name (font-weight 500 when active, normal when inactive)
  - Subtitle: `model · apiMode` in muted text
  - Badges: "DEFAULT" (emerald background/text) or "NO KEY" (amber background/text)
- Active card: `background: rgba(139,92,246,0.08)`, `border: 1px solid rgba(139,92,246,0.2)`
- Inactive cards: `border: 1px solid rgba(255,255,255,0.04)`, hover effect
- Background: `#0e0e0e`, separated from content area by `border-right: 1px solid rgba(255,255,255,0.06)`

#### Right Panel — Profile Settings (flex, fills remaining)

- **Profile header**: name (semibold), subtitle (`baseUrl · model · mode`), Test + Delete action buttons
- **Essential fields** (always visible, single column):
  - Provider preset (dropdown)
  - Profile name (input)
  - API Base URL + Model (2-column grid)
  - API Key (password input with show/hide eye icon)
- **Collapsible: Advanced Settings** (collapsed by default, 2-column grid):
  - Temperature, Max Output Tokens, Reasoning Effort, Context Limit, Compaction Threshold, Fresh Tail Count
  - Reasoning Summary checkbox
  - API Mode dropdown
- **Collapsible: System Prompt & Skills** (collapsed by default):
  - System prompt textarea
  - Workspace skills checkbox
- **Footer**: Save Changes button

### 3. MCP Servers Page — Split Pane

**Files**: `app/settings/mcp-servers/page.tsx`, `components/settings/sections/mcp-servers-section.tsx`

Apply the same split-pane pattern.

#### Left Panel — Server List (~260px fixed)

- Header: "MCP Servers" title + server count + "Add" button
- Each server card shows:
  - Server name
  - Transport badge ("HTTP" or "STDIO")
  - URL or command in muted text
  - Status indicator (online/offline dot)
- Active card uses same accent purple styling as Providers
- Each card has a toggle (on/off) visible inline

#### Right Panel — Server Config

- **Server header**: name, transport type, Retest + Delete buttons
- **Essential fields**:
  - Name (input)
  - Transport type (dropdown: streamable_http / stdio)
- **Conditional section** (based on transport):
  - If `streamable_http`: URL input, Headers (JSON textarea)
  - If `stdio`: Command input, Args, Environment variables (JSON textarea)
- **Footer**: Save + Test Connection buttons

### 4. Skills Page — Split Pane

**Files**: `app/settings/skills/page.tsx`, `components/settings/sections/skills-section.tsx`

Apply the same split-pane pattern.

#### Left Panel — Skill List (~260px fixed)

- Header: "Skills" title + skill count + "Add" button
- Each skill card shows:
  - Skill name
  - "Built-in" badge where applicable
  - One-line description in muted text
  - On/Off toggle inline
- Active card uses same accent purple styling

#### Right Panel — Skill Editor

- **Skill header**: name, "Built-in" badge if applicable, Delete button (hidden for built-in)
- **Fields**:
  - Name (input)
  - Description (input)
  - SKILL.md instructions (textarea)
- **Footer**: Save button

### 5. General Page — Single Column

**Files**: `app/settings/general/page.tsx`, `components/settings/sections/general-section.tsx`

Minimal changes — already well-structured. Apply visual polish to match updated style:

- Same card styling (`border-radius: 10-12px`, subtle borders)
- Same label/input styling as other pages
- Two cards: Conversation Retention, Auto-Compaction

### 6. Account Page — Single Column

**Files**: `app/settings/account/page.tsx`, `components/settings/sections/account-section.tsx`

Minimal changes — already well-structured. Apply visual polish:

- Same card styling
- Two cards: Local Access (credentials), Sign Out

### 7. Icons

Stay with **Lucide** (already installed). It provides outline-style, single-color icons that match the desired Font Awesome aesthetic. No new dependency.

### 8. Shared Component Updates

These existing components get updated to match the new visual style:

| Component | Changes |
|---|---|
| `SettingsCard` | Update border-radius to `12px`, ensure consistent border/bg |
| `SettingRow` | No changes needed |
| `Button` | No changes needed |
| `Input` | No changes needed |

New components to create:

| Component | Purpose |
|---|---|
| `SettingsSplitPane` | Reusable split-pane layout (left list + right detail). Handles mobile responsive behavior internally — collapses to single column with overlay on < 768px |
| `CollapsibleSection` | Clickable header + animated expand/collapse for advanced settings |
| `ProfileCard` | Left-panel list item (dot + name + subtitle + badges) |
| `Badge` | Small colored label (DEFAULT, NO KEY, BUILT-IN, HTTP, STDIO) |

### 9. Responsive Behavior

- On mobile (< 768px): split-pane collapses to a single column — list view shown by default, tapping an item navigates to the detail view (or slides it in as an overlay)
- Sidebar becomes the existing hamburger overlay (already implemented)

## Scope

- Settings sidebar navigation visual update
- Providers page split-pane with progressive disclosure
- MCP Servers page split-pane
- Skills page split-pane
- General and Account pages visual polish only
- New reusable components (SettingsSplitPane, CollapsibleSection, ProfileCard, Badge)
- No changes to functionality, data layer, or routes
- No new dependencies

## Out of Scope

- Changes to the main chat sidebar
- Changes to the Shell component (except minor styling if needed)
- New settings pages or features
- Backend/data layer changes
- Dark/light theme switching
