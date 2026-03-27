# State

## Client State
- **Solution:** Local React state in client components
- **Location:** `components/chat-view.tsx`, `components/settings-form.tsx`, `components/login-form.tsx`

## Server State
- **Data Fetching:** Server components read directly from SQLite-backed helpers in `lib/`
- **Caching:** No separate client cache layer
- **Revalidation:** Client actions call route handlers and then `router.refresh()`

## Form State
- **Library:** Native forms plus React state
- **Validation:** Server-side `zod` schemas with minimal client-side required attributes

## Conventions
- **Loading States:** Buttons disable during pending work; composer shows inline spinner on send
- **Streaming State:** `components/chat-view.tsx` tracks whether the first token has arrived so the assistant placeholder can show a waiting spinner before any reasoning or answer text appears
- **Error States:** Inline error copy near the active form or composer
