# Routing

## Router
- **Library:** Next.js App Router
- **Type:** File-based

## Page Structure
| Route | Purpose |
|-------|---------|
| `/` | Logged-in home and empty-state dashboard |
| `/login` | Local username/password login |
| `/chat/[conversationId]` | Conversation workspace |
| `/settings` | Provider, auth, and context settings |

## Protected Routes
- **Auth Check:** `middleware.ts` verifies the signed session cookie and pages call `requireUser()`
- **Redirect:** Unauthenticated users go to `/login`

## Navigation
- **Pattern:** Sidebar conversation list with direct route navigation plus `router.refresh()` after mutations
