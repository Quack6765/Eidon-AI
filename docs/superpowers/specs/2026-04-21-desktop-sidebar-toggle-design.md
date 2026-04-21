# Desktop Sidebar Toggle

## Overview
Add a show/hide toggle button to the desktop sidebar so it can slide in and out from the left, giving the conversation viewport more width.

## Current State
- The `Shell` component (`components/shell.tsx`) renders a 280px sidebar on the left and a flex-1 main content area.
- Sidebar visibility is controlled by `isSidebarOpen` state (currently mobile-only).
- On desktop (`md:` breakpoints), the sidebar is always visible (`md:translate-x-0`).
- Mobile uses a hamburger menu + overlay (`bg-black/70 backdrop-blur-sm`).

## Proposed Design

### Layout Behavior
- Extend `isSidebarOpen` state to also control desktop visibility.
- Sidebar defaults to **open** on desktop (preserves existing behavior).
- When toggled off, sidebar slides out to the left using `md:-translate-x-full` with the existing `transition-transform duration-300 ease-out` classes.
- The main content area is `flex-1` and automatically expands to fill the freed space.

### Toggle Button
- **Position**: fixed/absolute at the sidebar's right edge, vertically centered.
- **Size**: ~28px wide, ~48px tall (pill shape).
- **Icon**: `ChevronLeft` when open, `ChevronRight` when closed.
- **Style**: subtle background (`bg-white/5`), border on the right edge, hover highlight.
- **Accessibility**: `aria-label="Collapse sidebar"` / `"Expand sidebar"`.
- **Visibility**: `hidden md:flex` so it only appears on desktop.

### State & Behavior
- Mobile behavior is **unchanged** — hamburger menu still controls the overlay sidebar.
- Desktop toggle is independent and hidden from mobile view.
- `isSidebarOpen` drives both mobile and desktop visibility.

### Testing
- Unit test: verify toggle button renders, toggles `isSidebarOpen`, and applies correct translate class.
- E2E: open a chat, click toggle → sidebar hides and viewport widens; click again → sidebar reappears.
