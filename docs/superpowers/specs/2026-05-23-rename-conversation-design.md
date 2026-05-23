# Rename Conversation & Folder

## Summary

Add a "Rename" option to the conversation three-dots menu in the sidebar, and unify both conversation and folder rename flows to use a shared small modal popup instead of inline editing.

## Motivation

Users cannot rename conversations from the sidebar. Folders support rename via an inline input, but a modal provides a clearer, more intentional UX. Unifying both on a single modal component reduces code duplication and creates a consistent pattern.

## New Component: `RenameModal`

**File:** `components/ui/rename-modal.tsx`

A compact modal dialog for renaming items:

- Single-line text input pre-filled with the current name
- Title label ("Rename conversation" / "Rename folder")
- Save and Cancel buttons
- Backdrop overlay with blur
- Auto-focuses and selects the input text on open
- Closes on Escape key, backdrop click, or Cancel
- Enforces `maxLength` prop (default 48 for conversations)
- Trims whitespace before saving; rejects empty strings
- Returns the new value via `onSave` callback; caller handles the API call

### Props

```typescript
type RenameModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSave: (newValue: string) => void;
  title: string;
  maxLength?: number;
};
```

### Styling

Matches existing dark theme: `bg-[#121214]`, `border-white/[0.08]`, rounded-2xl, backdrop blur. Consistent with `TextEditModal` and the three-dots dropdown styling.

## Conversation Rename

### UI Changes in `ConversationItem` (`components/sidebar.tsx`)

1. Add a "Rename" menu item with `Pencil` icon in the three-dots dropdown, placed **before** the Delete button
2. Clicking "Rename" closes the dropdown and opens the `RenameModal`
3. On save: calls `PATCH /api/conversations/{id}` with `{ title: newValue }`, then dispatches `CONVERSATION_TITLE_UPDATED_EVENT` and calls `router.refresh()`
4. On cancel or backdrop click: modal closes with no changes

### API Changes (`app/api/conversations/[conversationId]/route.ts`)

1. Add `title: z.string().min(1).max(200).optional()` to `updateSchema`
2. Update the `.refine()` to include `title` in the check
3. When `title` is present, call `renameConversation(conversation.id, body.data.title)` (already exists in `lib/conversations.ts`)
4. Broadcast a `conversation_title_updated` WS event (with `{ conversationId, title }`) in addition to the existing `conversation_updated` broadcast, so the sidebar's existing WS listener picks it up for real-time sync

### Server-side

No new functions needed. `renameConversation()` in `lib/conversations.ts` already handles the SQL UPDATE and sets `titleGenerationStatus` to `"completed"`.

### Event flow

1. `RenameModal` onSave triggers PATCH request
2. Server calls `renameConversation()`
3. Server broadcasts `conversation_title_updated` WS event
4. Client dispatches `CONVERSATION_TITLE_UPDATED_EVENT` custom DOM event
5. Sidebar's existing listeners update local state (both the custom event listener at lines 804-842 and the WS listener at lines 936-945)

## Folder Rename Refactor

### UI Changes in `FolderItem` (`components/sidebar.tsx`)

1. Remove inline rename state (`renaming`, `renameValue`, `renameRef`) and the inline `<input>` element
2. Replace with `RenameModal`: clicking "Rename" in the folder menu opens the modal instead of switching to inline edit
3. On save: calls `PATCH /api/folders/{id}` with `{ name: newValue }` (existing API), then `router.refresh()`
4. The folder's `handleRename` function is simplified to just the API call (no DOM interaction)

### No API changes needed

The folder PATCH endpoint already accepts `{ name }`.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `components/ui/rename-modal.tsx` | Create | New shared rename modal component |
| `components/sidebar.tsx` | Modify | Add rename menu item + modal to `ConversationItem`; refactor `FolderItem` to use modal |
| `app/api/conversations/[conversationId]/route.ts` | Modify | Add `title` to update schema, handle rename, broadcast title update WS event |

## Files NOT Changed

- `lib/conversations.ts` — `renameConversation()` already exists
- `lib/conversation-events.ts` — `dispatchConversationTitleUpdated()` already exists
- `lib/types.ts` — `Conversation.title` already exists
- `lib/ws-protocol.ts` — `conversation_title_updated` message type already defined

## Edge Cases

- **Empty title:** Modal rejects empty/whitespace-only input; Save button disabled when trimmed value is empty
- **No change:** If user saves without modifying, the PATCH still fires but is a no-op effectively
- **Concurrent rename:** If an AI-generated title update arrives while the modal is open, the modal's local state takes precedence on save
- **Mobile:** The modal works on touch devices with the same tap-to-open, tap-to-save interaction
- **Active conversation:** Renaming the currently active conversation updates the sidebar title immediately via the event system
