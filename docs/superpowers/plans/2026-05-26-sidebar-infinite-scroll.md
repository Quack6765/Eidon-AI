# Sidebar Infinite Scroll Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Load more" button in the sidebar with automatic infinite scroll using Intersection Observer.

**Architecture:** Add an invisible sentinel `<div>` at the bottom of the conversation list. A `useEffect` with `IntersectionObserver` watches the sentinel and calls the existing `loadMoreConversations()` when it enters the viewport. The scroll container (`scrollContainerRef`) serves as the observer root.

**Tech Stack:** React (useState, useRef, useEffect, useCallback), native IntersectionObserver API, existing cursor-based pagination backend.

---

### Task 1: Add sentinel ref and Intersection Observer effect

**Files:**
- Modify: `components/sidebar.tsx:752` (add ref after existing refs)
- Modify: `components/sidebar.tsx:890` (add useEffect after `loadMoreConversations`)

- [ ] **Step 1: Add the sentinel ref**

In `components/sidebar.tsx`, after line 753 (`const dragPointerRef = ...`), add:

```tsx
const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Add the IntersectionObserver useEffect**

In `components/sidebar.tsx`, after the `loadMoreConversations` callback (after line 890, before the `useEffect` for `CONVERSATION_TITLE_UPDATED_EVENT`), add:

```tsx
useEffect(() => {
  const sentinel = loadMoreSentinelRef.current;
  const scrollRoot = scrollContainerRef.current;
  if (!sentinel || !scrollRoot || !hasMoreConversations) return;

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        void loadMoreConversations();
      }
    },
    { root: scrollRoot, rootMargin: "200px" }
  );

  observer.observe(sentinel);
  return () => observer.disconnect();
}, [hasMoreConversations, loadMoreConversations]);
```

The `rootMargin: "200px"` triggers loading slightly before the sentinel is fully visible for a smoother experience.

- [ ] **Step 3: Run typecheck to verify**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat: add IntersectionObserver ref and effect for infinite scroll"
```

---

### Task 2: Replace "Load more" button with sentinel element

**Files:**
- Modify: `components/sidebar.tsx:1226-1241` (replace loading indicator + button with sentinel)

- [ ] **Step 1: Replace the "Load more" button and loading indicator**

In `renderConversationSections()`, replace lines 1226-1241 (the `isLoadingMore` indicator block and the `hasMoreConversations` button block) with:

```tsx
            {hasMoreConversations && !searchResults ? (
              <div ref={loadMoreSentinelRef} className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/20">
                {isLoadingMore ? "Loading older chats" : ""}
              </div>
            ) : null}
```

This single element serves dual purpose: it's the observer sentinel AND the loading indicator. When loading, it shows "Loading older chats". When not loading but more pages exist, it renders as an empty div that the observer watches.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run tests/unit/sidebar.test.tsx`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat: replace Load more button with infinite scroll sentinel"
```

---

### Task 3: Add test for infinite scroll behavior

**Files:**
- Modify: `tests/unit/sidebar.test.tsx`

- [ ] **Step 1: Add test verifying no Load more button and sentinel presence**

Add a new test to the `Sidebar` describe block in `tests/unit/sidebar.test.tsx`:

```tsx
describe("Sidebar infinite scroll", () => {
  const pagedConversationPage: ConversationListPage = {
    conversations: [
      {
        id: "conversation-1",
        title: "First chat",
        titleGenerationStatus: "completed",
        folderId: null,
        providerProfileId: null,
        automationId: null,
        automationRunId: null,
        conversationOrigin: "manual",
        sortOrder: 0,
        createdAt: "2026-05-07T12:00:00.000Z",
        updatedAt: "2026-05-07T12:00:00.000Z",
        isActive: false,
        shareEnabled: false,
        shareToken: null,
        sharedAt: null,
        isTemporary: false
      }
    ],
    hasMore: true,
    nextCursor: "eyJ1cGRhdGVkQXQiOiIyMDI2LTA1LTA2VDEyOjAwOjAwLjAwMFoiLCJpZCI6ImNvbnZlcnNhdGlvbi0wIn0="
  };

  it("does not render a Load more button when hasMore is true", () => {
    render(<Sidebar conversationPage={pagedConversationPage} folders={[]} />);
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/sidebar.test.tsx`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/unit/sidebar.test.tsx
git commit -m "test: verify Load more button replaced by infinite scroll"
```

---

### Task 4: Run full test suite and lint

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run lint**

Run: `npx eslint components/sidebar.tsx`
Expected: No errors

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors
