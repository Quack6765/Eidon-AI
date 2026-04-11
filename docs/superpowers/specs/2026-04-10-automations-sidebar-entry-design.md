# Automations Sidebar Entry Design

## Summary

Promote the existing automations runs workspace into the main application sidebar so users can reach it without first going through Settings. The new top-level `Automations` entry should appear in the main sidebar above `Settings`, use the existing clock/ticker icon, and navigate to the existing `/automations` overview page on both desktop and mobile.

This is a navigation and discoverability change, not a workspace redesign. Automation creation, editing, enabling, disabling, and deletion remain in `Settings > Automations`.

## Goals

- Make automation run history discoverable from the main app navigation
- Preserve the existing separation between operational history and configuration
- Reuse the current `/automations` workspace rather than introducing new routes
- Keep the main sidebar behavior consistent across desktop and mobile

## Non-Goals

- Redesign the automations workspace layout
- Move automation creation into the main sidebar or `/automations`
- Change the existing settings ownership of automation authoring
- Rework the automations workspace back-link behavior beyond what is already shipped

## Product Decisions

### Primary entry point

- Add a new top-level `Automations` destination to the main sidebar
- Place `Automations` directly above `Settings`
- Keep `Settings` as the lowest sidebar option
- Show the new destination on both desktop and mobile

### Navigation target

- Clicking `Automations` always navigates to `/automations`
- Do not deep-link to the most recent automation or most recent run
- Do not route the main entry to `/settings/automations`

### Information architecture

Maintain the existing split:

- `Automations` means viewing automation runs and history
- `Settings > Automations` means managing automation definitions and schedule configuration

This preserves a clean mental model:

- operational monitoring lives in the automations workspace
- authoring and configuration live in settings

## UX Design

### Main sidebar

The main sidebar footer currently exposes `Settings` as a single destination. Replace that single-link footer with a simple stacked two-link block:

1. `Automations`
2. `Settings`

The new `Automations` row should:

- reuse the existing clock/ticker icon already associated with automations
- match the current footer-link visual treatment used by `Settings`
- use the same transition and navigation behavior as other top-level sidebar destinations
- close the mobile drawer after navigation, just like the existing settings link

### Automations workspace

No workspace restructure is required. The current route model remains the same:

- `/automations` for overview and automation selection
- `/automations/[automationId]` for per-automation run history
- `/automations/[automationId]/runs/[runId]` for viewing a run transcript

The overview page remains the default landing page for the new sidebar entry, even when no automations exist.

### Settings page

`/settings/automations` remains the only place where users can:

- create automations
- edit automation prompts and schedules
- enable or disable automations
- delete automations

No creation controls should be added to the main sidebar as part of this change.

## Implementation Shape

### Primary change surface

The main implementation surface is:

- [components/sidebar.tsx](/Users/charles/.codex/worktrees/18eb/Eidon-AI/components/sidebar.tsx)

That component should be updated to render both footer destinations in the agreed order while preserving the existing navigation helper behavior already used for `Settings`.

### Existing routes reused as-is

These existing pages remain the sources of truth:

- [app/automations/page.tsx](/Users/charles/.codex/worktrees/18eb/Eidon-AI/app/automations/page.tsx)
- [app/automations/[automationId]/page.tsx](/Users/charles/.codex/worktrees/18eb/Eidon-AI/app/automations/[automationId]/page.tsx)
- [app/settings/automations/page.tsx](/Users/charles/.codex/worktrees/18eb/Eidon-AI/app/settings/automations/page.tsx)

No new route is required for this feature.

## States And Edge Cases

- `Automations` must remain visible even when there are zero automation definitions
- In the zero-automation case, `/automations` should continue showing its existing empty state
- The sidebar entry should not be conditional on runtime data such as run count or enabled automations
- Mobile and desktop should expose the same destinations in the same order

## Testing

Add focused regression coverage for navigation behavior.

### Unit coverage

- Verify the main sidebar renders `Automations` and `Settings`
- Verify `Automations` is rendered above `Settings`
- Verify the `Automations` link points to `/automations`
- Verify the settings link still points to `/settings`

### Manual validation

- Confirm the new entry appears in the desktop sidebar
- Confirm the new entry appears in the mobile sidebar/menu
- Confirm clicking `Automations` lands on `/automations`
- Confirm the mobile drawer closes after navigation
- Confirm the existing zero-state behavior still works when no automations exist

## Risks

- The main risk is navigation inconsistency if the new link uses a different transition path than `Settings`
- A secondary risk is accidental scope expansion into automations workspace redesign; this work should stay limited to entry-point discoverability and tests
