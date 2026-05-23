# Rename Conversation & Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rename support for conversations via the sidebar three-dots menu, and unify both conversation and folder rename flows on a shared modal component.

**Architecture:** New `RenameModal` component shared between `ConversationItem` and `FolderItem`. API PATCH route extended to accept `title`. Server-side `renameConversation()` already exists. Event system already handles title updates.

**Tech Stack:** React 19, Next.js 15 App Router, TypeScript, Tailwind CSS 4, Vitest, Testing Library

---

### Task 1: Create the RenameModal component

**Files:**
- Create: `components/ui/rename-modal.tsx`
- Reference: `components/ui/text-edit-modal.tsx` (styling patterns)
- Test: `tests/unit/rename-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/rename-modal.test.tsx
// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RenameModal } from "@/components/ui/rename-modal";

describe("RenameModal", () => {
  it("renders with the current value pre-filled in the input", () => {
    render(
      <RenameModal
        open={true}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    const input = screen.getByDisplayValue("My Conversation");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
    expect(screen.getByText("Rename conversation")).toBeInTheDocument();
  });

  it("calls onSave with trimmed value when Save is clicked", () => {
    const onSave = vi.fn();
    render(
      <RenameModal
        open={true}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={onSave}
        title="Rename conversation"
      />
    );

    const input = screen.getByDisplayValue("My Conversation");
    fireEvent.change(input, { target: { value: "  New Title  " } });
    fireEvent.click(screen.getByText("Save"));

    expect(onSave).toHaveBeenCalledWith("New Title");
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <RenameModal
        open={true}
        onOpenChange={onOpenChange}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) when backdrop is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <RenameModal
        open={true}
        onOpenChange={onOpenChange}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    const backdrop = screen.getByRole("dialog").querySelector(".absolute.inset-0");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Save when input is empty or whitespace-only", () => {
    render(
      <RenameModal
        open={true}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    const input = screen.getByDisplayValue("My Conversation");
    const saveButton = screen.getByText("Save");

    expect(saveButton).toBeEnabled();

    fireEvent.change(input, { target: { value: "   " } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "a" } });
    expect(saveButton).toBeEnabled();
  });

  it("does not render when open is false", () => {
    render(
      <RenameModal
        open={false}
        onOpenChange={vi.fn()}
        value="My Conversation"
        onSave={vi.fn()}
        title="Rename conversation"
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/rename-modal.test.tsx`
Expected: FAIL — module `@/components/ui/rename-modal` not found

- [ ] **Step 3: Write the RenameModal component**

```tsx
// components/ui/rename-modal.tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type RenameModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (newValue: string) => void;
  title: string;
  maxLength?: number;
};

export function RenameModal({
  open,
  onOpenChange,
  value,
  onSave,
  title,
  maxLength = 48,
}: RenameModalProps) {
  const titleId = useId();
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(value);
      requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0;

  function handleSave() {
    if (!canSave) return;
    onSave(trimmed);
    onOpenChange(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#121214] p-6 shadow-2xl">
        <h3
          id={titleId}
          className="text-sm font-semibold text-[var(--text)] mb-4"
        >
          {title}
        </h3>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          maxLength={maxLength}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <Button
            type="button"
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/rename-modal.test.tsx`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/ui/rename-modal.tsx tests/unit/rename-modal.test.tsx
git commit -m "feat: add RenameModal component"
```

---

### Task 2: Add `title` support to the conversation PATCH API route

**Files:**
- Modify: `app/api/conversations/[conversationId]/route.ts:1-14,85-99,124-148`
- Test: `tests/unit/conversation-rename-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/conversation-rename-route.test.ts
import { createConversation, getConversation } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

describe("PATCH /api/conversations/[conversationId] — rename", () => {
  let userId: string;

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM conversations");
    db.exec("DELETE FROM users");
    const user = createLocalUser("rename-test@example.com", "pass");
    userId = user.id;
    requireUserMock.mockResolvedValue({ id: userId });
  });

  it("renames a conversation via PATCH with title", async () => {
    const conversation = createConversation();
    requireUserMock.mockResolvedValue({ id: userId });

    const { PATCH } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    const request = new Request("http://localhost/api/conversations/" + conversation.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed Title" }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ conversationId: conversation.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.conversation.title).toBe("Renamed Title");

    const updated = getConversation(conversation.id, userId);
    expect(updated?.title).toBe("Renamed Title");
    expect(updated?.titleGenerationStatus).toBe("completed");
  });

  it("rejects empty title", async () => {
    const conversation = createConversation();
    requireUserMock.mockResolvedValue({ id: userId });

    const { PATCH } = await import(
      "@/app/api/conversations/[conversationId]/route"
    );

    const request = new Request("http://localhost/api/conversations/" + conversation.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ conversationId: conversation.id }),
    });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/conversation-rename-route.test.ts`
Expected: FAIL — `title` is not in the update schema, so Zod validation rejects it

- [ ] **Step 3: Modify the PATCH route to accept `title`**

In `app/api/conversations/[conversationId]/route.ts`:

**3a.** Add `renameConversation` to the import from `@/lib/conversations` (line 4-14). The current import block is:

```ts
import {
  deleteConversation,
  deleteConversationIfEmpty,
  getConversation,
  listQueuedMessages,
  listVisibleMessages,
  moveConversationToFolder,
  setConversationActive,
  setConversationTemporary,
  updateConversationProviderProfile
} from "@/lib/conversations";
```

Add `renameConversation` to this import.

**3b.** Update `updateSchema` (lines 85-99) to include `title`:

```ts
const updateSchema = z
  .object({
    folderId: z.string().nullable().optional(),
    providerProfileId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    isTemporary: z.boolean().optional(),
    title: z.string().min(1).max(200).optional()
  })
  .refine(
    (value) =>
      value.folderId !== undefined ||
      value.providerProfileId !== undefined ||
      value.isActive !== undefined ||
      value.isTemporary !== undefined ||
      value.title !== undefined,
    "Invalid conversation update"
  );
```

**3c.** Add title handling in the PATCH handler, after the `isTemporary` block (after line 148), before `const updated = ...` (line 150):

```ts
if (body.data.title !== undefined) {
  renameConversation(conversation.id, body.data.title);
  try {
    getConversationManager().broadcastAll({
      type: "conversation_title_updated",
      conversationId: conversation.id,
      title: body.data.title
    }, user.id);
  } catch { /* WS server may not be running */ }
}
```

This broadcasts a `conversation_title_updated` WS event specifically, which the sidebar's existing WS listener (lines 936-945) catches for real-time title sync across tabs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/conversation-rename-route.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run existing conversation tests to check no regressions**

Run: `npx vitest run tests/unit/conversations.test.ts`
Expected: All tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add app/api/conversations/[conversationId]/route.ts tests/unit/conversation-rename-route.test.ts
git commit -m "feat: accept title in conversation PATCH API route"
```

---

### Task 3: Add "Rename" to ConversationItem three-dots menu

**Files:**
- Modify: `components/sidebar.tsx` — `ConversationItem` function (lines 165-399)

- [ ] **Step 1: Add rename state to ConversationItem**

Inside `ConversationItem` (after line 186, after `const [confirmDelete, setConfirmDelete] = useState(false);`), add:

```ts
const [renameOpen, setRenameOpen] = useState(false);
```

- [ ] **Step 2: Add handleRenameConversation function**

After `handleMoveToFolder` (after line 271), add:

```ts
async function handleRenameConversation(newTitle: string) {
  const response = await fetch(`/api/conversations/${conversation.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: newTitle })
  });
  if (response.ok) {
    dispatchConversationTitleUpdated({
      conversationId: conversation.id,
      title: newTitle
    });
  }
  router.refresh();
}
```

- [ ] **Step 3: Add "Rename" menu item to the dropdown**

In the non-confirmed-delete section of the menu (between the folder separator at line 383 and the Delete button at line 386), add the Rename button:

```tsx
<button
  onClick={() => { setRenameOpen(true); setMenuOpen(false); }}
  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
>
  <Pencil className="h-4 w-4 opacity-50" />
  Rename
</button>
```

This goes immediately after the `{allFolders.length > 0 && ( ... )}` block and before the Delete button. The structure becomes:

```tsx
<>
  {allFolders.length > 0 && (
    <>
      {/* ... existing folder move buttons ... */}
      <div className="my-1.5 border-t border-white/5" />
    </>
  )}
  <button
    onClick={() => { setRenameOpen(true); setMenuOpen(false); }}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/40 hover:bg-white/[0.04] hover:text-white transition-colors duration-200"
  >
    <Pencil className="h-4 w-4 opacity-50" />
    Rename
  </button>
  <button
    onClick={handleDelete}
    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-400/80 hover:bg-red-500/10 hover:text-red-400 transition-colors duration-200"
  >
    <Trash2 className="h-4 w-4 opacity-70" />
    Delete
  </button>
</>
```

- [ ] **Step 4: Add the RenameModal component to ConversationItem**

After the closing `</div>` of the `menuOpen` dropdown block (after line 396, before the final `</div>` of the component), add:

```tsx
<RenameModal
  open={renameOpen}
  onOpenChange={setRenameOpen}
  value={conversation.title}
  onSave={handleRenameConversation}
  title="Rename conversation"
/>
```

- [ ] **Step 5: Add the import for RenameModal and dispatchConversationTitleUpdated**

At the top of `sidebar.tsx`, add to the existing imports:

```ts
import { RenameModal } from "@/components/ui/rename-modal";
```

And add `dispatchConversationTitleUpdated` to the existing import from `@/lib/conversation-events` (check if it's already imported — it may already be there for other uses).

- [ ] **Step 6: Verify the Pencil icon is imported**

`Pencil` is already imported in the file (used by `FolderItem`). Verify the lucide-react import includes it.

- [ ] **Step 7: Run existing sidebar tests to check no regressions**

Run: `npx vitest run tests/unit/sidebar.test.tsx`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat: add rename option to conversation sidebar menu"
```

---

### Task 4: Refactor FolderItem to use RenameModal

**Files:**
- Modify: `components/sidebar.tsx` — `FolderItem` function (lines 401-634)

- [ ] **Step 1: Replace inline rename state with modal state**

In `FolderItem`, remove these three state declarations (lines 427-428):

```ts
// REMOVE:
const [renaming, setRenaming] = useState(false);
const [renameValue, setRenameValue] = useState(folder.name);
```

And remove the ref (line 432):

```ts
// REMOVE:
const renameRef = useRef<HTMLInputElement>(null);
```

Add:

```ts
const [renameOpen, setRenameOpen] = useState(false);
```

- [ ] **Step 2: Remove the useEffect that focuses the rename input**

Remove the useEffect at lines 454-459:

```ts
// REMOVE:
useEffect(() => {
  if (renaming && renameRef.current) {
    renameRef.current.focus();
    renameRef.current.select();
  }
}, [renaming]);
```

- [ ] **Step 3: Simplify handleRename**

Replace the existing `handleRename` function (lines 472-481):

```ts
async function handleRename(newName: string) {
  await fetch(`/api/folders/${folder.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName })
  });
  router.refresh();
}
```

- [ ] **Step 4: Remove the inline input from the folder row**

Replace the conditional rendering block (lines 521-540). The current code is:

```tsx
{renaming ? (
  <input
    ref={renameRef}
    value={renameValue}
    onChange={(e) => setRenameValue(e.target.value)}
    onBlur={handleRename}
    onKeyDown={(e) => {
      if (e.key === "Enter") handleRename();
      if (e.key === "Escape") setRenaming(false);
    }}
    className="flex-1 bg-transparent border-b border-white/20 text-sm text-white outline-none px-1"
  />
) : (
  <span
    className="flex-1 truncate font-medium"
    onClick={() => setCollapsed(!collapsed)}
  >
    {folder.name}
  </span>
)}
```

Replace with just the span (always show the folder name, no inline input):

```tsx
<span
  className="flex-1 truncate font-medium"
  onClick={() => setCollapsed(!collapsed)}
>
  {folder.name}
</span>
```

- [ ] **Step 5: Update the folder menu Rename button to use modal**

The existing Rename button in the folder menu (lines 593-598) currently does:

```tsx
<button
  onClick={() => { setRenaming(true); setFolderMenuOpen(false); }}
  ...
```

Change to:

```tsx
<button
  onClick={() => { setRenameOpen(true); setFolderMenuOpen(false); }}
  ...
```

- [ ] **Step 6: Add the RenameModal component to FolderItem**

After the closing `</div>` of the `FolderItem` component's outer container (before the collapsed conversations section, around line 614), add:

```tsx
<RenameModal
  open={renameOpen}
  onOpenChange={setRenameOpen}
  value={folder.name}
  onSave={handleRename}
  title="Rename folder"
  maxLength={100}
/>
```

This should be placed right after the folder menu closing tags and before the `{!collapsed && conversations.length > 0 && (` block. It needs to be a sibling at the same level — wrap it together with the existing content in a fragment or place it inside the outer `<div ref={setNodeRef}>`.

- [ ] **Step 7: Run existing sidebar tests to check no regressions**

Run: `npx vitest run tests/unit/sidebar.test.tsx`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add components/sidebar.tsx
git commit -m "refactor: folder rename uses shared RenameModal"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linter**

Run: `npx next lint`
Expected: No errors
