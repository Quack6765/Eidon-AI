# Sidebar Compact Layout & Purple Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the sidebar toggle to purple, replace the full-width "New Chat" button with a compact "+" icon in the logo row, and tighten vertical spacing in the FOLDERS section.

**Architecture:** Three independent UI changes across two files (`shell.tsx`, `sidebar.tsx`). Each task modifies a distinct section of the UI with no shared state between tasks.

**Tech Stack:** React, Tailwind CSS, lucide-react icons, CSS custom properties (`--accent`, `--accent-glow`)

---

### Task 1: Purple sidebar toggle button

**Files:**
- Modify: `components/shell.tsx:322-346`

- [ ] **Step 1: Replace the toggle button classes**

In `components/shell.tsx`, replace the `<button>` element at lines 322-346 with the following. This changes the button from dark ghost to Eidon Violet and removes the decorative vertical line.

Find the `<button` starting with `type="button"` and `onClick={() => setIsSidebarOpen...` (the sidebar toggle, around line 322). Replace the entire `<button>...</button>` block with:

```tsx
        <button
          type="button"
          onClick={() => setIsSidebarOpen((prev) => { if (prev) sessionStorage.setItem("eidon:sidebar:user-closed", "true"); else sessionStorage.removeItem("eidon:sidebar:user-closed"); return !prev; })}
          className={`group/sidebar-toggle hidden md:flex fixed top-[72px] z-[80] h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)] transition-[left,opacity,transform] duration-200 ease-out hover:opacity-90 hover:scale-[0.98] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${
            isSidebarOpen ? "left-[262px]" : "left-3"
          }`}
          aria-label={sidebarToggleLabel}
          aria-pressed={isSidebarOpen}
          title={sidebarToggleLabel}
        >
          {isSidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
          <span
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#161616] px-2 py-1 text-[11px] font-medium text-white/70 opacity-0 shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition-opacity duration-150 group-hover/sidebar-toggle:opacity-100 group-focus-visible/sidebar-toggle:opacity-100 ${
              isSidebarOpen ? "right-11" : "left-11"
            }`}
          >
            {isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          </span>
        </button>
```

Key changes from original:
- Removed `border border-white/10 bg-[var(--background)]/95 text-white/45` (neutral ghost)
- Removed `shadow-[0_2px_8px_rgba(0,0,0,0.18)] backdrop-blur-sm`
- Removed hover states `hover:border-white/18 hover:bg-[#171717] hover:text-white/75`
- Added `bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)]`
- Added `hover:opacity-90 hover:scale-[0.98] active:scale-[0.96]`
- Updated transition from `transition-[left,background-color,border-color,color]` to `transition-[left,opacity,transform]`
- Removed the decorative `<span>` with the vertical line (`absolute left-1.5 top-2 h-5 w-px...`)

- [ ] **Step 2: Verify no lint errors**

Run: `npx eslint components/shell.tsx --no-error-on-unmatched-pattern`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add components/shell.tsx
git commit -m "style: purple sidebar toggle button"
```

---

### Task 2: Replace "New Chat" button with compact "+" in logo row

**Files:**
- Modify: `components/sidebar.tsx:1208-1247` (logo row)
- Modify: `components/sidebar.tsx:1299-1312` (remove New Chat button)

- [ ] **Step 1: Add "+" button to the Eidon logo row**

In `components/sidebar.tsx`, find the logo container div (line 1208):

```tsx
        <div className="mb-8 px-2">
          <Link
```

Replace the opening `<div className="mb-8 px-2">` with a flex row that includes the "+" button:

```tsx
        <div className="mb-4 px-2 flex items-center justify-between">
          <Link
```

The rest of the `<Link>` block remains unchanged. After the closing `</Link>` on line 1246, add the "+" button before the closing `</div>` on line 1247:

Find:
```tsx
          </Link>
        </div>
```

Replace with:
```tsx
          </Link>
          <button
            onClick={() => handleCreate()}
            disabled={!mounted}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-200 ${
              mounted
                ? "bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)] hover:opacity-90 hover:scale-[0.98] active:scale-[0.96]"
                : "cursor-not-allowed bg-white/[0.04] text-white/30"
            }`}
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
```

- [ ] **Step 2: Remove the full-width "New Chat" button**

In the same file, find and delete the entire "New Chat" button block (approximately lines 1299-1312):

```tsx
          <button
            onClick={() => handleCreate()}
            disabled={!mounted}
            className={`mt-1 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-all duration-300 ${
              mounted
                ? "bg-[var(--accent)] text-white shadow-[0_0_20px_var(--accent-glow)] hover:opacity-90 hover:scale-[0.98] active:scale-[0.96]"
                : "cursor-not-allowed bg-white/[0.04] text-white/30"
            }`}
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4 stroke-[3px]" />
            <span>New Chat</span>
          </button>
```

- [ ] **Step 3: Verify no lint errors**

Run: `npx eslint components/sidebar.tsx --no-error-on-unmatched-pattern`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat: compact + button in sidebar logo row"
```

---

### Task 3: Tighter FOLDERS section spacing

**Files:**
- Modify: `components/sidebar.tsx:1249,1317,1320`

- [ ] **Step 1: Reduce search/buttons area bottom margin**

In `components/sidebar.tsx`, find the search/buttons container div (line 1249):

```tsx
        <div className="flex flex-col gap-2 mb-8">
```

Replace with:
```tsx
        <div className="flex flex-col gap-2 mb-4">
```

- [ ] **Step 2: Reduce scrollable container section spacing**

Find the scrollable container div (line 1317):

```tsx
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 -mr-1 space-y-8"
```

Replace with:
```tsx
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 -mr-1 space-y-4"
```

- [ ] **Step 3: Reduce FOLDERS heading bottom margin**

Find the FOLDERS heading row (line 1320):

```tsx
            <div className="flex items-center justify-between px-2 mb-3">
```

Replace with:
```tsx
            <div className="flex items-center justify-between px-2 mb-1.5">
```

- [ ] **Step 4: Verify no lint errors**

Run: `npx eslint components/sidebar.tsx --no-error-on-unmatched-pattern`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add components/sidebar.tsx
git commit -m "style: tighter sidebar spacing"
```
