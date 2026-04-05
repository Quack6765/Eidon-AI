# State

## Client State
- **Solution:** Local React state in client components
- **Location:** `components/chat-view.tsx`, `components/settings-form.tsx`, `components/login-form.tsx`

## Server State
- **Data Fetching:** Server components read directly from SQLite-backed helpers in `lib/`
- **Caching:** No separate client cache layer
- **Revalidation:** Client actions call route handlers and then `router.refresh()`
- **Chat Turn Sync:** `components/chat-view.tsx` no longer forces a full `router.refresh()` after each streamed assistant turn; it rehydrates the active conversation in place via `GET /api/conversations/[conversationId]` to avoid visible page reloads and preserve local stream UX
- **Stream Sync Guard:** `components/chat-view.tsx` ignores stale poll responses that report `isActive: false` while local streamed thinking, answer, or timeline state is already in progress, preventing mid-turn refreshes from wiping the live assistant shell

## Form State
- **Library:** Native forms plus React state
- **Validation:** Server-side `zod` schemas with minimal client-side required attributes

## Conventions
- **Loading States:** Buttons disable during pending work; composer shows inline spinner on send
- **Streaming State:** `components/chat-view.tsx` tracks whether the first token has arrived so the assistant placeholder can show a waiting spinner before any reasoning or answer text appears
- **Assistant Turn Finalization:** `components/chat-view.tsx` now inserts an optimistic assistant row into `messages` before streaming begins, updates that same row in place as tokens arrive, and only uses the post-stream conversation fetch to reconcile server metadata like real persisted ids and debug/title fields
- **Error States:** Inline error copy near the active form or composer
- **Sidebar Data:** `components/sidebar.tsx` hydrates the newest conversation page only, keeps the rest of the history behind an explicit `Load more` button, and leaves search backed by `/api/conversations/search` so queries still span all stored chats even when older pages are not loaded into the sidebar
- **Conversation Titles:** `components/chat-view.tsx` keeps a local `conversationTitle` plus `titleGenerationStatus`. On the first user turn for a fresh thread it silently polls `/api/conversations/[conversationId]` until the background auto-title flow reaches `completed` or `failed`, then broadcasts a browser event so the sidebar can update the matching row without a full refresh
- **Draft Thread Cleanup:** `components/chat-view.tsx` issues a guarded `DELETE /api/conversations/[conversationId]?onlyIfEmpty=1` during route changes away from a thread, so brand-new conversations with zero messages are removed if the user leaves before sending anything
- **Home-to-Chat Bootstrap:** `lib/chat-bootstrap.ts` keeps the home composer payload in `sessionStorage` until `components/chat-view.tsx` actually submits it over the WebSocket. The chat page reads the bootstrap payload on mount, clears it only when the send begins, and uses the queued WebSocket client in `lib/ws-client.ts` so the first prompt survives route transitions and dev remounts
- **Sidebar Sync:** `components/sidebar.tsx` applies conversation delete and move mutations to local sidebar state immediately, while `CONVERSATION_ACTIVITY_UPDATED_EVENT` and `CONVERSATION_TITLE_UPDATED_EVENT` keep the row’s active spinner and title in sync with streamed turns without requiring a manual page refresh
