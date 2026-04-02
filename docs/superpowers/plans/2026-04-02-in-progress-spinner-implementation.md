# Implementation Plan: In-Progress Spinner for Sidebar Conversations

## Overview

Add a spinner icon to sidebar conversations when they are actively streaming or running in the background. The spinner replaces the chat bubble icon and fades smoothly when state changes.

## Steps

### Step 1: Database Migration

**File:** `lib/db.ts`

Add migration to add `is_active` column to the conversations table with default `0`.

```typescript
// In the migrate() function, after existing column checks:
if (!convColNames.includes("is_active")) {
  db.exec("ALTER TABLE conversations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0");
}
```

### Step 2: Type Update

**File:** `lib/types.ts`

Add `isActive: boolean` to the `Conversation` type:

```typescript
export type Conversation = {
  id: string;
  title: string;
  titleGenerationStatus: ConversationTitleGenerationStatus;
  folderId: string | null;
  providerProfileId: string | null;
  toolExecutionMode: ToolExecutionMode;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;  // NEW
};
```

### Step 3: Database Row Mapping

**File:** `lib/conversations.ts`

Update `ConversationRow` type and `rowToConversation` function to include `is_active`:

```typescript
type ConversationRow = {
  // ... existing fields ...
  is_active: number;  // 0 or 1
};

function rowToConversation(row: ConversationRow): Conversation {
  return {
    // ... existing fields ...
    isActive: row.is_active === 1,  // NEW
  };
}
```

Also update all SQL queries that select from conversations to include `is_active`:
- `listConversations()` (line 207-226)
- `listConversationsPage()` (line 229-288)
- `getConversation()` (line 291-323)
- `searchConversations()` (line 1174-1212)

### Step 4: Library Functions

**File:** `lib/conversations.ts`

Add helper functions to set conversation active state:

```typescript
export function setConversationActive(conversationId: string, active: boolean) {
  const timestamp = nowIso();
  getDb()
    .prepare("UPDATE conversations SET is_active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, timestamp, conversationId);
}
```

Also update `createConversation()` to ensure `is_active` is always `0` (default).

### Step 5: API Route

**File:** `app/api/conversations/[conversationId]/route.ts`

Add `PATCH` handler to update conversation fields including `isActive`.

### Step 6: Sidebar Component

**File:** `components/sidebar.tsx`

1. Import `LoaderCircle` from lucide-react (already imported in message-bubble.tsx, line 4)

2. Update `ConversationItem` component (line 126) to accept and display spinner based on `conversation.isActive`:

```typescript
// Inside ConversationItem, replace the icon:
{conversation.isActive ? (
  <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-white/45 transition-opacity duration-200" />
) : (
  <MessageSquare className="h-4 w-4 shrink-0 opacity-40 transition-opacity duration-200" />
)}
```

Note: Use `h-3 w-3` (12px) for sidebar spinner to be slightly smaller than the thinking card spinner.

### Step 7: Server Logic (When to Set Active)

The server should call `setConversationActive(conversationId, true)` when:
- A new message starts streaming
- Title generation starts (`claimConversationTitleGeneration`)

The server should call `setConversationActive(conversationId, false)` when:
- Message streaming completes (`/done` event)
- Title generation completes (`completeConversationTitleGeneration`)

**Files to modify:** `app/api/conversations/[conversationId]/chat/route.ts`

Add calls to `setConversationActive` at appropriate points in the streaming logic.

---

## File Changes Summary

| File | Changes |
|------|---------|
| `lib/db.ts` | Add `is_active` column migration |
| `lib/types.ts` | Add `isActive: boolean` to Conversation type |
| `lib/conversations.ts` | Update row mapping, SQL queries, add `setConversationActive()` |
| `app/api/conversations/[conversationId]/route.ts` | Add PATCH handler for isActive |
| `components/sidebar.tsx` | Render spinner when `isActive` is true |
| `app/api/conversations/[conversationId]/chat/route.ts` | Set active state during streaming lifecycle |

---

## Testing Checklist

- [ ] Database migration runs without error on existing data
- [ ] New conversations default to `isActive: false`
- [ ] Spinner appears when conversation `isActive = true`
- [ ] Spinner fades to chat bubble when `isActive = false`
- [ ] Active conversations can be navigated away from
- [ ] Spinner persists after page refresh (database-backed)
