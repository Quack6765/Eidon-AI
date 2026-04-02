# Settings Page Redesign

## Problem

The current settings page is a monolithic 1280-line component (`components/settings-form.tsx`) using a two-column grid layout. All settings (providers, MCP servers, skills, account) are crammed into a single scrollable page with no navigation hierarchy. This makes it hard to find and manage settings, especially as the number of configurable options grows.

## Goal

Redesign the settings page to match a ChatGPT-style layout: a sidebar navigation with icon+label rows for each settings category, a main content area showing one section at a time, and a back button to return to the chat interface.

## Design Decisions

### Sidebar Style: Row List with Icons

Icon on the left, text label on the right, horizontal rows. Same pattern as VS Code and macOS System Settings. More readable than icon-top or icon-only layouts.

### Transition: Full Swap

Clicking "Settings" in the sidebar replaces the conversation list with the settings navigation. The back arrow at the top-left of the sidebar returns to the conversation list. Same 280px sidebar width — no layout shift.

### Routing: Nested Routes

Each settings section gets its own URL for deep-linking and browser back button support:

- `/settings` → redirects to `/settings/general`
- `/settings/general` → General (conversation defaults)
- `/settings/providers` → Provider profiles
- `/settings/mcp-servers` → MCP Servers
- `/settings/skills` → Skills
- `/settings/account` → Account & sign out

### Card Width: 55% max-width

Setting cards within the content area are capped at `max-width: 55%` to keep labels and controls close together without stretching across the full width.

## Architecture

### Routing Structure

```
app/settings/
├── layout.tsx          # Shared settings layout (sidebar nav + content area)
├── page.tsx            # Redirects to /settings/general
├── general/
│   └── page.tsx        # Conversation defaults section
├── providers/
│   └── page.tsx        # Provider profiles section
├── mcp-servers/
│   └── page.tsx        # MCP Servers section
├── skills/
│   └── page.tsx        # Skills section
└── account/
    └── page.tsx        # Account & sign out section
```

### Component Architecture

```
components/settings/
├── settings-nav.tsx    # Sidebar navigation (category list + back button)
├── sections/
│   ├── general-section.tsx
│   ├── providers-section.tsx
│   ├── mcp-servers-section.tsx
│   ├── skills-section.tsx
│   └── account-section.tsx
└── shared/
    ├── settings-card.tsx      # Reusable card wrapper
    └── setting-row.tsx        # Label + control row component
```

### Shell Changes

`components/shell.tsx` currently renders the sidebar unconditionally. Changes needed:

- Detect whether the current route starts with `/settings`
- On settings routes: render `<SettingsNav>` in the sidebar slot instead of `<Sidebar>`
- Animate the swap with framer-motion (crossfade)

The `Sidebar` component itself does not change. The `Shell` simply chooses which component to render in the sidebar area.

### Sidebar Navigation Component

`SettingsNav` renders:

1. **Back button** — circular button with left arrow icon, links to `/`
2. **"Settings" title** — below the back button
3. **Category list** — vertical list of 5 items, each with:
   - Colored icon badge (32x32, rounded-lg, section-specific accent color)
   - Text label
   - Active state: tinted background + subtle border in accent color
   - Hover state: subtle dark highlight
   - Links to the corresponding `/settings/[section]` route

Section colors (matching current accents):

| Section | Icon | Color |
|---------|------|-------|
| General | Settings | Purple (#8b5cf6) |
| Providers | Sparkles | Slate (#1e293b) |
| MCP Servers | Server | Sky (#0ea5e9) |
| Skills | Zap | Amber (#f59e0b) |
| Account | Shield | Sky-300 (#38bdf8) |

### Mobile Behavior

- Settings nav renders inside the same slide-in overlay as the current sidebar
- Selecting a section navigates to it and closes the sidebar overlay
- Back arrow closes the sidebar overlay and returns to the previous page
- No separate settings page on mobile — same pattern as desktop

## Settings Sections

### General

New section for conversation-wide defaults. Currently these settings are buried inside the provider profile config.

Settings:
- **Conversation retention** — dropdown: Forever, 90 days, 30 days, 7 days
- **Auto-compaction** — toggle on/off
- **Compaction threshold** — number input (token count)
- **Fresh tail count** — number input (number of recent messages to preserve)

Data source: New fields on `AppSettings` (stored in SQLite via `lib/settings.ts`).

Note: Compaction threshold and fresh tail count currently exist as per-provider settings. In General, these become global defaults that new providers inherit. Existing providers keep their current values.

### Providers

Extracted from current `settings-form.tsx` provider section. Same functionality:

- Provider profile cards with radio for default selection
- Add/edit/delete provider profiles
- Per-profile configuration: name, API base URL, API mode, model, API key, system prompt, workspace skills toggle, temperature, max output tokens, reasoning effort, reasoning summary toggle, model context limit
- Save and test connection buttons

### MCP Servers

Extracted from current `settings-form.tsx` MCP section. Same functionality:

- Server list with transport badge (stdio/http), URL/command display
- Per-server actions: retest, enable/disable, edit, delete
- Add/edit form with transport type, URL+headers (HTTP), command+args+env (stdio)
- Test button for draft servers

### Skills

Extracted from current `settings-form.tsx` skills section. Same functionality:

- Skill list with name, description, built-in badge
- Per-skill actions: enable/disable, edit, delete (built-in non-deletable)
- Add/edit form with name, description, SKILL.md instructions textarea

### Account

Extracted from current `settings-form.tsx` account section. Same functionality:

- Username input
- New password input
- Update account button
- Sign out button

## Data Flow

No changes to the data layer. Existing API routes (`/api/settings`, `/api/mcp-servers`, `/api/skills`, `/api/auth/account`) continue to serve all settings sections. Each section component calls the same APIs it currently uses.

The only new data is the General section settings (conversation retention, auto-compaction defaults), which need to be added to `AppSettings` in `lib/types.ts` and `lib/settings.ts`.

## Out of Scope

- Light theme toggle
- Accent color picker
- API behavior settings (timeout, retries)
- Any changes to the chat interface itself
- Any changes to the data layer or API routes (except adding General section fields)
