# Sidebar Compact Layout & Purple Toggle

## Problem

The sidebar wastes vertical space: the full-width "New Chat" button occupies a row, the FOLDERS section has excessive empty space beneath its heading, and the sidebar show/hide toggle uses a neutral ghost style that doesn't match the Eidon Violet accent used on other primary actions.

## Changes

### 1. Purple sidebar toggle button

**File:** `components/shell.tsx` (lines 322-346)

Restyle the desktop sidebar show/hide toggle from dark ghost to Eidon Violet accent, matching the design language of the "New Chat" and mobile header buttons.

- Background: `bg-[var(--accent)]` (#8b5cf6)
- Icon/text: `text-white`
- Shadow: `shadow-[0_0_20px_var(--accent-glow)]`
- Hover: `hover:opacity-90`
- Remove the neutral border, neutral bg, neutral text color, and the decorative vertical line accent

### 2. Replace full-width "New Chat" button with compact "+" icon button

**File:** `components/sidebar.tsx` (lines 1299-1312)

Remove the full-width "New Chat" pill button. Add a small 32x32px rounded purple "+" button at the far right of the "Eidon" logo row, matching the mobile header's "+" button style (`components/shell.tsx` lines 408-423).

- Position: inline with the Eidon wordmark, `justify-between` on the logo row
- Size: `h-8 w-8` with `rounded-lg`
- Styling: `bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)]`
- Icon: `Plus` from lucide-react, `h-4 w-4`
- Hover/active: `hover:opacity-90 hover:scale-[0.98] active:scale-[0.96]`
- Same `onClick` handler as the removed button (`handleCreate()`)
- Same `disabled` state logic (`mounted` check)

### 3. Tighter FOLDERS section spacing

**File:** `components/sidebar.tsx`

Reduce empty space in the FOLDERS area:

- FOLDERS heading `mb-3` to `mb-1.5` (line 1320)
- Scrollable container `space-y-8` to `space-y-4` (line 1317)
- Logo area `mb-8` to `mb-4` (line 1208)
- Search/buttons area `mb-8` to `mb-4` (line 1249)

## Files affected

- `components/shell.tsx` - toggle button restyling
- `components/sidebar.tsx` - "+" button relocation, spacing cleanup

## Platform scope

All changes apply across desktop, mobile, and PWA layouts:

- The `<Sidebar>` component is shared between mobile and desktop. The compact "+" button and tighter spacing apply universally.
- The desktop toggle button (shell.tsx) is `hidden md:flex` so it only appears on desktop. Mobile uses the hamburger menu in the header bar. Both platforms now use Eidon Violet for their primary actions.
- The mobile header "+" button (shell.tsx) already uses `bg-[var(--accent)]` and needs no changes.
- All accent colors use existing CSS custom properties (`--accent`, `--accent-glow`).
- Functional behavior unchanged (same click handlers, same disabled states).
