# Automations Sidebar Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level `Automations` entry to the main sidebar above `Settings`, visible on desktop and mobile, that opens the existing `/automations` overview while keeping automation creation in Settings.

**Architecture:** Keep the change isolated to the main sidebar footer. Extract the footer links into a small, testable client component so the new navigation can be validated without rendering the full drag-and-drop chat sidebar, then wire that component back into `Sidebar` using the existing `navigateToHref` helper so desktop and mobile behavior stay consistent.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, lucide-react, Vitest, Testing Library, agent-browser

---

## File Map

- `components/sidebar-footer-nav.tsx` — new focused footer navigation component for `Automations` and `Settings`
- `components/sidebar.tsx` — replace the inline settings footer with the extracted footer nav and reuse the existing sidebar route helper
- `tests/unit/sidebar-footer-nav.test.tsx` — focused regression coverage for order, href targets, and click delegation
- `.dev-server` — dev server discovery for browser validation

### Task 1: Add a focused footer-nav component with regression tests

**Files:**
- Create: `components/sidebar-footer-nav.tsx`
- Modify: `components/sidebar.tsx`
- Create: `tests/unit/sidebar-footer-nav.test.tsx`

- [ ] **Step 1: Write the failing footer-nav test**

Create `tests/unit/sidebar-footer-nav.test.tsx` with this content:

```tsx
// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { SidebarFooterNav } from "@/components/sidebar-footer-nav";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  )
}));

describe("SidebarFooterNav", () => {
  it("renders Automations above Settings with the correct hrefs", () => {
    render(<SidebarFooterNav onNavigateAction={vi.fn()} />);

    const automationsLink = screen.getByRole("link", { name: "Open automations" });
    const settingsLink = screen.getByRole("link", { name: "Open settings" });

    expect(automationsLink).toHaveAttribute("href", "/automations");
    expect(settingsLink).toHaveAttribute("href", "/settings");
    expect(
      automationsLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("delegates plain left-click navigation through the provided action", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open automations" }), { button: 0 });

    expect(onNavigateAction).toHaveBeenCalledWith("/automations");
  });

  it("does not intercept modified clicks", () => {
    const onNavigateAction = vi.fn();

    render(<SidebarFooterNav onNavigateAction={onNavigateAction} />);

    fireEvent.click(screen.getByRole("link", { name: "Open settings" }), {
      button: 0,
      metaKey: true
    });

    expect(onNavigateAction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/unit/sidebar-footer-nav.test.tsx
```

Expected: FAIL because `@/components/sidebar-footer-nav` does not exist yet.

- [ ] **Step 3: Implement the extracted footer-nav component**

Create `components/sidebar-footer-nav.tsx` with this implementation:

```tsx
"use client";

import Link from "next/link";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Clock3, Settings } from "lucide-react";

const baseLinkClassName =
  "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm text-white/30 transition-all duration-300 hover:bg-white/[0.03] hover:text-white/60";

type SidebarFooterNavProps = {
  onNavigateAction: (href: string) => void | Promise<void>;
};

function interceptNavigation(
  event: ReactMouseEvent<HTMLAnchorElement>,
  href: string,
  onNavigateAction: SidebarFooterNavProps["onNavigateAction"]
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  void onNavigateAction(href);
}

export function SidebarFooterNav({ onNavigateAction }: SidebarFooterNavProps) {
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-white/5 pt-6">
      <Link
        href="/automations"
        aria-label="Open automations"
        className={baseLinkClassName}
        onClick={(event) => interceptNavigation(event, "/automations", onNavigateAction)}
      >
        <Clock3 className="h-4.5 w-4.5 opacity-60" />
        <span className="font-medium">Automations</span>
      </Link>

      <Link
        href="/settings"
        aria-label="Open settings"
        className={baseLinkClassName}
        onClick={(event) => interceptNavigation(event, "/settings", onNavigateAction)}
      >
        <Settings className="h-4.5 w-4.5 opacity-60" />
        <span className="font-medium">Settings</span>
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Wire the new footer nav into the main sidebar**

Update `components/sidebar.tsx` in two places.

Add the import near the other component imports:

```tsx
import { SidebarFooterNav } from "@/components/sidebar-footer-nav";
```

Replace the existing single `Settings` footer block at the bottom of the component with:

```tsx
        <SidebarFooterNav onNavigateAction={navigateToHref} />
```

Do not change:

- `navigateToHref`
- conversation rendering
- folder drag-and-drop logic
- the mobile shell header in `components/shell.tsx`

- [ ] **Step 5: Run the focused sidebar tests**

Run:

```bash
npx vitest run tests/unit/sidebar-footer-nav.test.tsx
```

Expected: PASS with all three footer-nav tests passing.

- [ ] **Step 6: Run adjacent regression tests**

Run:

```bash
npx vitest run tests/unit/sidebar-footer-nav.test.tsx tests/unit/settings-layout.test.tsx tests/unit/automations-section.test.tsx
```

Expected: PASS. This confirms the new sidebar link is covered, the settings shell behavior still works, and the settings automations page still links to `/automations`.

- [ ] **Step 7: Commit the focused sidebar change**

Run:

```bash
git add components/sidebar-footer-nav.tsx components/sidebar.tsx tests/unit/sidebar-footer-nav.test.tsx
git commit -m "feat: add automations entry to sidebar"
```

Expected: a single commit containing only the new footer-nav component, the sidebar integration, and the focused unit test.

### Task 2: Validate desktop and mobile behavior in the browser

**Files:**
- Review: `.dev-server`
- Review: `components/sidebar-footer-nav.tsx`
- Review: `components/sidebar.tsx`

- [ ] **Step 1: Reuse or start the dev server using the project convention**

If `.dev-server` exists, read and test the first line first:

```bash
if [ -f .dev-server ]; then
  sed -n '1p' .dev-server
fi
```

If the URL does not load, remove the stale file and start a fresh server:

```bash
rm -f .dev-server
npm run dev > .context/automations-sidebar-dev.log 2>&1 &
while [ ! -f .dev-server ]; do sleep 1; done
sed -n '1p' .dev-server
```

Expected: a localhost URL in the `3000-4000` range.

- [ ] **Step 2: Open the app with agent-browser and verify desktop sidebar placement**

Run:

```bash
agent-browser open "$(sed -n '1p' .dev-server)"
agent-browser wait --load networkidle
agent-browser snapshot -i
```

If the app redirects to `/login`, authenticate with the local workspace credentials before continuing. If those credentials are not available in the workspace, stop and ask the user for them.

On desktop, verify:

- `Automations` appears above `Settings`
- both entries use the footer-link treatment
- clicking `Automations` opens `/automations`

Capture a screenshot:

```bash
agent-browser screenshot .context/automations-sidebar-desktop.png
```

- [ ] **Step 3: Resize to a mobile viewport and verify the same destination order**

Use the browser tooling to switch to a narrow mobile viewport, open the sidebar/menu, and confirm:

- `Automations` is visible on mobile
- it still appears above `Settings`
- tapping `Automations` closes the drawer and opens `/automations`

Capture a second screenshot:

```bash
agent-browser screenshot .context/automations-sidebar-mobile.png
```

- [ ] **Step 4: Re-run the critical local checks**

Run:

```bash
npx vitest run tests/unit/sidebar-footer-nav.test.tsx tests/unit/settings-layout.test.tsx tests/unit/automations-section.test.tsx
npm run typecheck
```

Expected: both commands pass.

- [ ] **Step 5: Record verification evidence**

If browser validation matches the spec and no additional code changes were needed, do not create another commit. Keep these artifacts for review:

- `.context/automations-sidebar-desktop.png`
- `.context/automations-sidebar-mobile.png`
