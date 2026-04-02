# In-Progress Spinner for Sidebar Conversations

## Overview

When a conversation is actively streaming (message being generated) or running in the background, the sidebar shows a spinner icon instead of the chat bubble. This lets users know the conversation is still active even when they've navigated away.

---

## UI Changes

### ConversationItem Component (sidebar.tsx)

Conditionally render `LoaderCircle` (spinner) OR `MessageSquare` (chat bubble) based on `isActive` field.

**Styling:**
- Spinner: `h-3 w-3 animate-spin text-white/45` (same as thinking card)
- Chat bubble: `h-4 w-4 shrink-0 opacity-40` (existing)

**Transition:**
- 200ms fade when state changes between spinner ↔ chat bubble

**States:**
| State | Icon | Visual |
|-------|------|--------|
| `isActive = true` | `LoaderCircle` spinner | Animated, `text-white/45` |
| `isActive = false` | `MessageSquare` chat bubble | Static, `opacity-40` |

---

## Data Model

### Type Update

```ts
type Conversation = {
  // ... existing fields ...
  isActive: boolean;  // true when streaming or processing
}
```

### Database

- Add `isActive` column to `conversations` table
- Default value: `false`

---

## State Flow

1. **Streaming starts** → Server sets `conversation.isActive = true`
2. **Sidebar reads** `isActive` from conversation list query
3. **Streaming completes** → Server sets `conversation.isActive = false`
4. **UI updates** via query invalidation/refetch

---

## Behavior

- When a conversation is `isActive = true`, users can click on another conversation to switch
- The previous conversation continues "in the background" server-side
- The spinner icon indicates the conversation is still processing
- When processing completes, spinner fades back to chat bubble icon

---

## Implementation Scope

1. Database migration: add `isActive` boolean to conversations table
2. API mutation: set `isActive` (true/false)
3. Type update: add `isActive` to `Conversation` type
4. Sidebar: update `ConversationItem` to conditionally render spinner with fade transition
5. Server logic: set `isActive = true` when streaming starts, `false` when complete

---

## File Changes

| File | Change |
|------|--------|
| `components/sidebar.tsx` | Update ConversationItem to render spinner when isActive |
| `lib/types.ts` | Add `isActive: boolean` to Conversation type |
| `convex/conversations.ts` | Add mutation to update isActive status |
| Database migration | Add isActive column |

---

## Notes

- The spinner style matches the existing thinking card spinner for visual consistency
- Fade transition prevents jarring UI changes
- The boolean flag is simple and sufficient for the use case
