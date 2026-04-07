# Full Logo in Sidebar, Login, and Mobile Header — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded purple "E" icon + "Eidon" text with the full `logo.png` image in the sidebar, login card, and mobile header.

**Architecture:** Three independent edits to replace inline JSX branding markup with `next/image` `<Image>` components pointing to the existing `/logo.png`. No new files, no new dependencies.

**Tech Stack:** Next.js Image component, existing `public/logo.png`

---

### Task 1: Replace sidebar logo

**Files:**
- Modify: `components/sidebar.tsx:5` (add import)
- Modify: `components/sidebar.tsx:1020-1044` (replace markup)

- [ ] **Step 1: Add `next/image` import to sidebar.tsx**

At line 5 (after the `Link` import), add:

```tsx
import Image from "next/image";
```

- [ ] **Step 2: Replace the E + "Eidon" markup with the logo image**

Replace lines 1020-1044 (the `<div className="mb-4 px-1">` block) with:

```tsx
        <div className="mb-4 px-1">
          <Link
            href="/"
            onClick={(event) => {
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
              void navigateToHref("/");
            }}
            className="flex items-center rounded-lg px-2 py-1.5 hover:bg-white/[0.04] transition-colors duration-200"
          >
            <Image
              src="/logo.png"
              alt="Eidon"
              height={36}
              width={50}
              priority
            />
          </Link>
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat: use full logo image in sidebar"
```

---

### Task 2: Replace login card logo

**Files:**
- Modify: `components/login-form.tsx:3` (add import)
- Modify: `components/login-form.tsx:45-55` (replace markup)

- [ ] **Step 1: Add `next/image` import to login-form.tsx**

At line 3 (after the `useState` import), add:

```tsx
import Image from "next/image";
```

- [ ] **Step 2: Replace the E + "Eidon" markup with the logo image**

Replace lines 44-55 (the `<div className="space-y-3">` inner content — the flex row with E + Eidon text) with:

```tsx
      <div className="space-y-3">
        <Image
          src="/logo.png"
          alt="Eidon"
          height={80}
          width={110}
          priority
          className="mx-auto"
        />
```

Note: the closing `</div>` and `<p>` description that follow remain unchanged.

- [ ] **Step 3: Commit**

```bash
git add components/login-form.tsx
git commit -m "feat: use full logo image in login card"
```

---

### Task 3: Replace mobile header text with logo

**Files:**
- Modify: `components/shell.tsx:4` (add import)
- Modify: `components/shell.tsx:65` (replace markup)

- [ ] **Step 1: Add `next/image` import to shell.tsx**

At line 4 (after the `Menu` import), add:

```tsx
import Image from "next/image";
```

- [ ] **Step 2: Replace the "Eidon" text with the logo image**

Replace line 65:

```tsx
          <div className="font-semibold text-[var(--text)] text-sm tracking-wide">Eidon</div>
```

With:

```tsx
          <Image
            src="/logo.png"
            alt="Eidon"
            height={24}
            width={34}
            priority
            className="mx-auto"
          />
```

- [ ] **Step 3: Commit**

```bash
git add components/shell.tsx
git commit -m "feat: use full logo image in mobile header"
```

---

### Task 4: Visual validation

**Files:** None (testing only)

- [ ] **Step 1: Start dev server and validate all three locations**

Start the dev server, then use the browser agent to:
1. Open the app — verify the sidebar shows the full logo image at a comfortable size
2. Navigate to the login page — verify the logo appears above the form fields
3. Resize to mobile viewport — verify the logo appears in the top header bar
4. Confirm the logo looks good on the dark background and doesn't have visual artifacts
