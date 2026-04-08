# Stop Button for Active Chat Turns

## Overview

When a conversation is actively streaming or running tool work, the composer action button should show a stop control instead of a spinner. Clicking stop cancels the entire in-flight turn, including model streaming and any downstream skill, MCP, or shell work that has not already finished. Any assistant text, thinking text, and timeline items already produced remain persisted in the conversation so they are still part of future prompt context. The interrupted assistant turn is visibly marked as stopped in the transcript.

---

## UI Changes

### ChatComposer (`components/chat-composer.tsx`)

Replace the current passive spinner state in the composer action button with an actionable stop button whenever a turn is active.

**States:**

| State | Icon | Behavior |
|-------|------|----------|
| idle | `ArrowUp` | Sends a new message |
| uploading only | `LoaderCircle` | Shows upload progress, no stop action |
| active turn | stop-square icon | Cancels the active turn |
| stop requested | stop-square icon disabled | Prevents duplicate stop requests until the turn resolves |

**Behavior:**
- A running assistant turn takes precedence over the normal send affordance
- Clicking stop immediately issues a cancel request for the active conversation
- The control should stay in place while the cancellation is being processed so the UI does not flicker back to send prematurely

### Message Bubble (`components/message-bubble.tsx`)

Stopped assistant turns remain visible as ordinary assistant messages, but with a compact interrupted-state indicator near the assistant metadata area.

**Transcript requirements:**
- Partial answer text remains readable as normal assistant content
- Partial thinking text remains available using the existing thinking UI
- Timeline rows remain in chronological order
- Any action still running at the moment of cancellation resolves to an interrupted terminal state instead of looking completed
- The stopped indicator should read as an intentional user action, not as a generic system failure

---

## Runtime Contract

### Turn Cancellation Registry

Each active conversation turn should register a server-owned cancellation handle when the turn starts and clear it when the turn finishes. The cancel handle is keyed by conversation id and is shared by both the websocket chat path and the HTTP streaming chat path.

**Responsibilities of the handle:**
- Abort provider streaming
- Prevent new tool, skill, or shell actions from starting after cancellation
- Surface cancellation checks at boundaries between compaction, provider streaming, tool execution, and final persistence
- Mark the active turn as resolved once cleanup completes

### Stop Semantics

Stopping a turn is a hard cancel for the entire active turn, not just for text rendering.

**On stop:**
1. Mark the turn as cancellation-requested
2. Abort in-flight provider requests
3. Stop scheduling any remaining tool, skill, MCP, or shell work
4. Finalize any running action rows as interrupted
5. Persist the current assistant text/thinking/timeline state
6. Finalize the assistant message with a `stopped` status
7. Clear the conversation active state and notify subscribers

The turn should never roll back already-persisted content. Whatever has been streamed or saved before the stop request remains part of the stored conversation.

---

## Data Model

### Message Status

Extend `MessageStatus` with a `stopped` terminal state for assistant messages that were intentionally cancelled by the user.

```ts
type MessageStatus = "idle" | "streaming" | "completed" | "error" | "stopped";
```

### Message Action Status

Add an interrupted-style terminal state for actions that were active when the user stopped the turn.

```ts
type MessageActionStatus = "running" | "completed" | "error" | "stopped";
```

This allows the timeline to distinguish:
- completed work
- execution failures
- user-requested interruption

### Stream Protocol

Add explicit stop support to the transport contract:

- Client websocket message for stop requests
- Shared turn-finalization event path that allows subscribed clients to reconcile a stopped turn
- If needed, a dedicated stop acknowledgement event so the initiating client can hold the stop control disabled until the server resolves the turn

---

## State Flow

1. User sends a message
2. Client inserts optimistic user message and shows assistant streaming shell
3. Server registers the active turn cancellation handle and marks the conversation active
4. Assistant turn streams normally through provider and action events
5. User clicks stop
6. Client sends a stop request for the active conversation and disables repeat stop clicks
7. Server resolves the request against the active cancellation handle
8. Provider streaming aborts and no new actions start
9. Running actions are finalized as stopped
10. Assistant message is persisted with the partial text/thinking/timeline already produced and status `stopped`
11. Conversation active state clears and all subscribed clients reconcile to the stopped message state

---

## Persistence And Context

Stopped assistant messages stay in the same conversation history as completed messages. Prompt reconstruction should not exclude them. This ensures that if the user stops a reply midway and asks a follow-up question, the model still receives the interrupted assistant turn as part of the stored transcript.

No special rollback or deletion path should run for stopped turns. The only distinction is terminal metadata and UI presentation.

---

## File Changes

| File | Change |
|------|--------|
| `components/chat-composer.tsx` | Replace active-turn spinner state with stop button support |
| `components/chat-view.tsx` | Send stop requests, track stop-pending UI state, reconcile stopped turns without clearing partial content |
| `components/message-bubble.tsx` | Render stopped assistant indicator and interrupted action states |
| `lib/types.ts` | Add `stopped` message and action statuses plus any new protocol types |
| `lib/ws-protocol.ts` | Add websocket client/server stop message shapes |
| `lib/ws-client.ts` | Expose stop-send support if needed |
| `lib/ws-handler.ts` | Handle client stop requests |
| `lib/chat-turn.ts` | Register active turn handles, honor cancellation, persist partial stopped turns |
| `app/api/conversations/[conversationId]/chat/route.ts` | Reuse the shared cancellation-aware turn runner for HTTP chat streaming |
| `lib/assistant-runtime.ts` | Check cancellation between provider/tool/action phases |
| `lib/provider.ts` | Accept external abort/cancel input so streaming can be interrupted cleanly |
| `lib/conversations.ts` | Persist stopped statuses and any interrupted action updates |

---

## Testing

### Automated Coverage

1. Stopping during answer streaming persists the partial assistant message and marks it `stopped`
2. Stopping before any answer text still leaves a stopped assistant shell in the transcript
3. Stopping during tool or shell execution prevents later actions from starting and finalizes active actions as `stopped`
4. Snapshot reconciliation preserves partial text after reconnect or refresh
5. The active conversation flag clears after a stopped turn

### Manual Validation

1. Send a message and verify the composer button changes from send to stop while the turn is active
2. Click stop mid-stream and verify the partial assistant reply remains visible
3. Confirm the assistant row shows a stopped indicator instead of an error banner
4. Ask a follow-up question and verify the conversation continues normally with the stopped message still present in history
5. Stop a turn during tool activity and verify the timeline shows interruption rather than completion

---

## Notes

- The stop affordance should only appear for an active assistant turn, not for attachment uploads alone
- Cancellation should be cooperative at execution boundaries, but the user-facing contract is a hard stop for the active turn
- The implementation should use one shared turn runner/cancellation model so websocket and HTTP chat behavior do not diverge
