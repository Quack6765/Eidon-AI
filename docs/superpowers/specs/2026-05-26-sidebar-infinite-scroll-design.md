# Sidebar Infinite Scroll Pagination

## Problem

The sidebar loads conversations in pages of 10 via cursor-based pagination. Currently, users must click a "Load more" button to load older conversations. This should be replaced with automatic infinite scroll.

## Requirements

1. Conversations load automatically as the user scrolls down in the sidebar
2. On page reload, the list resets to page 1 (no persisted scroll position)
3. The active conversation is always visible in the list on load, even if it naturally falls beyond page 1
4. Search queries all conversations server-side, regardless of what's currently loaded
5. Once loaded, conversations remain in the list (accumulative)

## Current State

- Backend: Cursor-based pagination via `GET /api/conversations?cursor=X&limit=10` in `lib/conversations.ts`
- Server component: `app/chat/[conversationId]/page.tsx` uses `ensureConversationInPage()` to inject the active conversation into page 1
- Client state: `localConversations`, `hasMoreConversations`, `nextCursor`, `isLoadingMore` in `components/sidebar.tsx`
- Trigger: `loadMoreConversations()` fetches the next page and merges via `mergeConversations()`
- UI: Explicit "Load more" button at the bottom of the conversation list
- Search: `GET /api/conversations/search?q=X` queries all conversations server-side — already satisfies requirement 4

## Design

### Intersection Observer on sentinel element

Replace the "Load more" button with an invisible `<div>` sentinel at the bottom of the conversation list. A `useEffect` with `IntersectionObserver` watches this sentinel and triggers `loadMoreConversations()` when it enters the viewport.

**Changes are limited to `components/sidebar.tsx`:**

1. Add a `sentinelRef = useRef<HTMLDivElement>(null)`
2. Add a `useEffect` that creates an `IntersectionObserver` targeting `sentinelRef.current`, with the scroll container (`scrollContainerRef.current`) as the root. On intersection, call `loadMoreConversations()`
3. In `renderConversationSections()`, replace the "Load more" button with a `<div ref={sentinelRef}>` that is rendered only when `hasMoreConversations && !searchResults`

### Active conversation guarantee (no change needed)

The server component already injects the active conversation into page 1 via `ensureConversationInPage()`. The conversation appears with its correct date header because `buildConversationSections()` groups by date. On client-side navigation, the existing `useEffect` on `conversationPage` merges incoming data while retaining loaded pages.

### Search (no change needed)

Search already queries all conversations server-side. The sentinel is hidden when search results are active (same condition as before: `!searchResults`).

## Files Changed

| File                | Change                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| `components/sidebar.tsx` | Add sentinel ref, IntersectionObserver effect, replace button with sentinel div |
