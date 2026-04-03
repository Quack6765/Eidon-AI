# Server-Side Conversation Sync Design

## Problem

Conversations are tied to a single HTTP request. The client holds an SSE connection open for the entire assistant turn, accumulates state in React, and cannot reconnect. Closing the browser or switching devices loses the in-progress conversation. There is no mechanism for multiple clients to see the same conversation simultaneously.

## Goal

Move all conversation logic, streaming, and state management server-side. The client becomes a thin render layer. Any number of clients can connect, subscribe to a conversation, and see the same real-time state. Reconnecting (e.g., phone to desktop) gives a full state snapshot from the database, then live deltas going forward.

## Approach

WebSocket Room Manager — a `ConversationManager` singleton that manages per-conversation "rooms" of connected WebSocket clients, fans out events from the assistant runtime, and serves DB-backed snapshots on subscribe.

## Non-Goals

- Multi-user/multi-tenant support
- External pub/sub (Redis, etc.)
- Offline-first or offline-capable operation
- Changing the provider streaming layer, compaction, MCP, or title generation

---

## 1. Custom Server Entrypoint

Replace `next start` with a custom `server.ts` that wraps Next.js in a Node.js HTTP server and attaches a WebSocket server.

```typescript
// server.ts
import { createServer } from "http";
import { WebSocketServer } from "ws";
import next from "next";

const app = next({ dev: false });
const handle = app.getRequestHandler();

const server = createServer((req, res) => handle(req, res));

const wss = new WebSocketServer({ server, path: "/ws" });
setupWebSocketHandler(wss);

app.prepare().then(() => {
  server.listen(3000);
});
```

Docker CMD changes from `next start` to `node server.js`.

---

## 2. WebSocket Protocol

### Client -> Server

| Message | Fields | Description |
|---------|--------|-------------|
| `subscribe` | `conversationId` | Join a conversation room |
| `unsubscribe` | `conversationId` | Leave a conversation room |
| `message` | `conversationId`, `content`, `attachmentIds?` | Send a new user message |
| `edit` | `messageId`, `content` | Edit a previous user message (regenerate) |

### Server -> Client

| Message | Fields | Description |
|---------|--------|-------------|
| `ready` | `activeConversations: { id, title, status }[]` | Connection authenticated, lists conversations with in-progress turns |
| `snapshot` | `conversationId`, `messages`, `actions`, `segments` | Full conversation state from DB |
| `delta` | `conversationId`, `event` | Live update event (thinking_delta, answer_delta, action_start, etc.) |
| `error` | `message` | Protocol-level error |

### Connection Lifecycle

1. Client opens WebSocket to `/ws`
2. Server authenticates via JWT cookie
3. Server sends `ready` with active conversations
4. Client sends `subscribe(conversationId)`
5. Server sends `snapshot` with full current state
6. Server sends `delta` events as the assistant works
7. Client sends `message` to start a new turn
8. On disconnect: auto-reconnect with exponential backoff, re-subscribe, get fresh snapshot

---

## 3. ConversationManager

Singleton class managing rooms and broadcasting.

```typescript
class ConversationManager {
  private rooms: Map<string, Set<WebSocket>>;
  private activeTurns: Map<string, boolean>;

  subscribe(conversationId: string, ws: WebSocket): void;
  unsubscribe(conversationId: string, ws: WebSocket): void;
  broadcast(conversationId: string, event: DeltaEvent): void;
  getSnapshot(conversationId: string): ConversationSnapshot;
  isActive(conversationId: string): boolean;
  setActive(conversationId: string, active: boolean): void;
}
```

- Room created on first subscribe, destroyed on last unsubscribe
- Assistant runtime continues regardless of room existence
- Broadcast is a no-op if room has zero subscribers
- `activeTurns` tracks which conversations have an agent working

### Decoupling from Assistant Runtime

The assistant runtime does not import the ConversationManager. Instead, it emits events through a typed EventEmitter:

```typescript
// emitter.ts — simple typed event emitter
// assistant-runtime.ts emits after each DB write:
emitter.emit("delta", conversationId, { type: "answer_delta", text: delta });
emitter.emit("status", conversationId, "streaming" | "completed" | "error");
```

The ConversationManager subscribes to the emitter and handles broadcast. This keeps the runtime testable and the WebSocket layer pluggable.

---

## 4. Incremental DB Persistence

Write intermediate state to SQLite during streaming instead of only at completion.

### Write Cadence

| When | DB Write |
|------|----------|
| Stream starts | `messages` row: `status: "streaming"`, empty content |
| Answer delta arrives | Batched: `message_text_segments` row every ~100ms or ~500 chars |
| Thinking delta | Accumulate in memory only (not persisted incrementally) |
| Action event | `message_actions` row created/updated (existing behavior) |
| Stream completes | `messages.content` = concatenated text, `status: "completed"` |
| Stream errors | `messages.content` = partial text, `status: "error"` |

No schema changes required. The existing `message_text_segments` table already supports per-segment storage.

### Batching Strategy

Accumulate answer deltas in a buffer. Flush to DB as a single `message_text_segments` row when:
- 100ms timer fires, OR
- Buffer reaches 500 characters

This gives sub-second granularity for reconnection snapshots with reasonable write volume. WebSocket deltas to clients remain unthrottled (per-character).

### Snapshot Query

`getConversationSnapshot(conversationId)` — queries the DB and returns:
- All visible messages with content and status
- Text segments for any in-progress streaming message
- All message actions for the current turn
- Conversation metadata (is_active, provider_profile_id, etc.)

---

## 5. Client-Side Changes

### Removed

- SSE consumption logic (`response.body.getReader()`, `parseSseChunk()`)
- Optimistic local message creation (server creates the message)
- `syncConversationState()` and `mergeMessages()` reconciliation
- `conversation-events.ts` (browser CustomEvent dispatching)
- `chat-bootstrap.ts` (sessionStorage cross-page passing)

### Changed

- `chat-view.tsx`: Connect to WebSocket instead of POST. Receive data via `snapshot` + `delta` events instead of SSE. Simplify state management — no more local vs server ID mapping.
- Typewriter throttle: Becomes optional client-side decoration, not tied to data pipeline.

### New

- WebSocket connection management: connect on app load, authenticate, auto-reconnect with exponential backoff
- Subscription management: subscribe/unsubscribe as the user navigates between conversations

### Kept

- All UI components (message-bubble, sidebar, chat-composer, etc.)
- React state management (useState/useReducer for rendering)
- Markdown rendering, user interactions, scrolling

---

## 6. Error Recovery

1. **WebSocket disconnect**: Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
2. **On reconnect**: Re-authenticate, re-subscribe to current conversation, receive fresh snapshot
3. **Assistant turn in progress**: Snapshot includes partial message with segments and `status: "streaming"`
4. **Turn errored while disconnected**: Snapshot shows `status: "error"` with partial content
5. **User action**: "Retry" button on errored messages (existing UI behavior)

No SSE fallback. This is self-hosted software — WebSocket support is assumed.

---

## 7. Migration Strategy

### Phase 1: Add Infrastructure

- Add custom server entrypoint (`server.ts`)
- Add WebSocket handler, ConversationManager, emitter
- Modify `assistant-runtime.ts` to emit events after DB writes
- Keep existing SSE endpoint functional
- Both paths work simultaneously

### Phase 2: Switch Client

- Modify `chat-view.tsx` to use WebSocket instead of SSE
- Remove optimistic message logic, merge logic
- Test multi-client sync and reconnection

### Phase 3: Cleanup

- Remove SSE chat endpoint (`POST /api/conversations/[id]/chat`)
- Remove `sse.ts`, `conversation-events.ts`, `chat-bootstrap.ts`
- Remove any remaining SSE-related client code

At no point is the application in a broken state — the SSE fallback exists throughout Phase 1 and 2.

---

## 8. Scope Summary

### New Files (~290 lines total)

- `server.ts` — Custom server entrypoint (~30 lines)
- `lib/conversation-manager.ts` — Room management + broadcast (~80 lines)
- `lib/ws-handler.ts` — WebSocket connection handler + auth (~100 lines)
- `lib/ws-protocol.ts` — Protocol message types + serialization (~60 lines)
- `lib/emitter.ts` — Typed EventEmitter (~20 lines)

### Modified Files

- `lib/assistant-runtime.ts` — Emit events after DB writes
- `lib/conversations.ts` — Add snapshot query, batched segment writes
- `components/chat-view.tsx` — Replace SSE with WebSocket

### Eventually Removed (Phase 3)

- `lib/sse.ts`
- `lib/conversation-events.ts`
- `lib/chat-bootstrap.ts`

### New Dependency

- `ws` — WebSocket library for Node.js

### Database Changes

- None (no schema migrations)
