# Queued Chat Follow-Ups Design

## Overview

Add a durable per-conversation follow-up queue so users can submit additional prompts while the assistant is still streaming or executing tools. Queued items are not real transcript messages yet. They are deferred user intents that wait for the active turn to finish, then automatically dispatch through the existing chat turn pipeline.

The queue must be server-side so it survives reloads, reconnects, and app restarts. The user can edit or delete pending queue items before they send, and can force any pending item to send next with a `Send now` action that stops the active turn and promotes the chosen item to the front of the queue.

## Goals

- Let users queue multiple follow-up prompts during an active assistant turn.
- Persist the queue on the server per conversation.
- Keep queued items out of the transcript until they are actually dispatched.
- Reuse the existing `startChatTurn(...)` flow so queued sends behave like normal user messages at dispatch time.
- Support inline edit, delete, and `Send now` actions on pending queue items.

## Non-Goals

- Queuing attachments together with follow-up items.
- Freezing the current provider profile, persona, tool set, or transcript state at queue time.
- Turning queued follow-ups into a generic automation system.
- Supporting multiple simultaneously active assistant turns within one conversation.

## Product Behavior

### Queue creation

If the conversation is idle, composer submission behaves exactly as it does today and starts a chat turn immediately.

If the conversation already has an active turn, composer submission creates a queued follow-up item instead of sending a websocket `message` event. The new queue item is appended to the end of the conversation queue.

Queued items store only:

- conversation id
- queued text
- queue order
- queue state
- timestamps
- optional failure metadata for recoverable dispatch failures

Queued items do not snapshot:

- the current transcript
- attachments
- persona selection
- provider profile
- tool call state
- any other runtime inputs

At dispatch time, the queued item is treated as if the user had just submitted that text at that moment.

### Queue presentation

The queue is rendered as a banner stack above the composer and below the transcript. It is visually separate from transcript messages so pending follow-ups do not read like already-sent conversation history.

Behavioral requirements:

- The first pending item is visually emphasized as the next item to send.
- Additional pending items remain visible in stack order.
- The banner uses a capped height with internal scrolling once the stack grows beyond the available vertical space.
- Pending items support inline edit.
- Pending items support delete.
- Pending items support `Send now`.
- Processing items are visible in the banner but are not editable.
- Failed items stay visible with a recoverable error state.

### Automatic dispatch

Each conversation may have:

- zero or one active assistant turn
- zero or more queued follow-up items

When the active turn finishes with status `completed`, `stopped`, or `failed`, the server checks whether the conversation has a pending queued item. If so, it promotes the oldest pending item to `processing` and dispatches it through the same `startChatTurn(...)` path used for immediate sends.

Only one queue item can be `processing` for a conversation at a time.

### Send now

`Send now` is available for pending queue items only.

When invoked during an active turn:

1. The server requests stop for the active turn.
2. The chosen queue item is promoted to the front of the pending queue.
3. The rest of the queue keeps its relative order behind it.
4. Once the active turn fully resolves, the promoted queue item dispatches next through the normal queue dispatcher.

When invoked while the conversation is idle:

1. The chosen queue item is promoted to the front.
2. The dispatcher starts it immediately.

`Send now` does not bypass the existing stop/finalize flow. It changes queue order, then waits for the conversation to become idle before dispatching.

### Edit and delete

Only queue items in the `pending` state are editable or deletable.

Once a queue item enters `processing`, it is no longer editable because it has already crossed into the real chat pipeline. After `startChatTurn(...)` successfully creates the real user message and assistant placeholder, the queue row is deleted. From that point onward, the actual user message and assistant turn live in the transcript.

### Failures

There are two failure classes:

1. Queue dispatch failure before a real user message is created.
   The queue item moves to `failed`, keeps its banner row, and exposes retry behavior through existing queue actions.

2. Chat turn failure after dispatch has already created the real user message.
   This is no longer a queue failure. The queue item is considered consumed, and the failure appears as the normal chat turn failure inside the transcript.

## Architecture

### Data model

Add a new conversation-scoped queue table instead of overloading `messages`.

Proposed shape:

```ts
type QueuedMessageStatus = "pending" | "processing" | "failed" | "cancelled";

type QueuedMessage = {
  id: string;
  conversationId: string;
  content: string;
  status: QueuedMessageStatus;
  sortOrder: number;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  processingStartedAt: string | null;
};
```

Database responsibilities:

- durable storage of queue items
- stable FIFO ordering
- single-item processing state
- reorder support for `Send now`
- recovery after server restart

`messages` remains reserved for actual transcript history only.

### Server dispatcher

Add a small queue dispatcher responsible for deciding when a queued follow-up should start. The dispatcher is conversation-scoped and must enforce single dispatch per conversation even if multiple websocket clients are subscribed.

Responsibilities:

- check whether the conversation is idle
- pick the next pending item
- atomically move it to `processing`
- call `startChatTurn(...)` with the queued content
- remove or finalize the queue item once dispatch succeeds
- mark the queue item `failed` if dispatch fails before the user message is created
- kick off the next pending item when the active turn clears

The dispatcher is invoked from:

- websocket queue creation
- queue edit/delete/send-now actions when relevant
- chat turn completion/finalization
- startup or reconnect recovery paths when a conversation has pending queue items and no active turn

### Chat turn integration

Queued dispatch must use the same `startChatTurn(...)` entry point used by live user sends. That preserves:

- prompt construction
- compaction behavior
- skill/tool availability
- current provider/profile lookup
- current persona handling
- streaming events
- stop semantics

This avoids introducing a second execution path for queued sends.

### Transport and snapshot model

Conversation snapshots include queue state in addition to transcript messages so reconnecting clients can rehydrate the banner stack.

Queue operations are exposed through the transport layer:

- create queued item
- edit queued item
- delete queued item
- send queued item now
- snapshot queue contents

The websocket `message` event should remain reserved for immediate sends only. When the conversation is busy, the client should call a queue-specific operation instead of pretending an immediate send occurred.

## UI Design

### Chat view

`components/chat-view.tsx` becomes responsible for two adjacent but separate states:

- real transcript messages
- queued follow-up banner state

The transcript remains unchanged except for existing stop behavior continuing to work with queue promotion.

Queue-specific requirements:

- fetch queue state from the conversation snapshot
- optimistically reflect queue edits where safe
- preserve queue state across reconnects via snapshot reconciliation
- keep queue UI independent from transcript reconciliation

### Composer

The composer keeps its current drafting behavior, but submit logic branches:

- idle conversation: immediate send
- active conversation: create queue item

The composer does not need to freeze current attachments or runtime metadata into queue rows. If attachments are currently pending in the composer, they remain composer-local and are not bundled into queued follow-ups.

### Banner stack

The banner stack sits above the composer and contains:

- queue count
- ordered queue rows
- inline edit affordance
- delete affordance
- `Send now` affordance
- error rendering for failed queue items

The UI must communicate clearly that these rows are scheduled next steps, not already-sent messages.

## Ordering and concurrency rules

- FIFO is the default order.
- `Send now` promotes a chosen pending item to the front.
- Only one queue item may be `processing` per conversation.
- Only one active assistant turn may exist per conversation.
- Queue dispatch must be idempotent against reconnects and duplicate client actions.
- Multi-client viewing of the same conversation must converge on the same server-owned queue order.

## Recovery behavior

Because the queue is server-owned, recovery must not depend on the browser tab surviving.

On startup or conversation rehydration:

- if the conversation is active, do not dispatch a queued item yet
- if the conversation is idle and has pending queue items, dispatch the next item
- if a queue row is stuck in `processing` with no active conversation turn, downgrade it to `failed` or back to `pending` according to the chosen recovery policy

Recommended recovery policy:

- mark orphaned `processing` rows as `failed` with a recovery message

This is safer than silently retrying after an unexpected crash because it avoids accidental duplicate sends.

## File changes

Expected primary files:

- `lib/db.ts`
  Add queue table migration and indexes.
- `lib/types.ts`
  Add queue row types and statuses.
- `lib/conversations.ts`
  Add CRUD and reorder helpers for queued follow-ups.
- `lib/chat-turn.ts`
  Trigger dispatcher checks when a turn finalizes.
- `lib/ws-protocol.ts`
  Add queue message shapes to the client/server protocol.
- `lib/ws-handler.ts`
  Handle queue create/edit/delete/send-now websocket events.
- `components/chat-view.tsx`
  Render and reconcile the queue banner stack.
- `components/chat-composer.tsx`
  Support branch between immediate send and queueing behavior.
- `tests/unit/chat-view.test.ts`
  Add queue UI and client-flow coverage.
- `tests/unit/ws-handler.test.ts`
  Add queue transport coverage.
- `tests/unit/conversations.test.ts` or a new queue-focused unit test file
  Cover queue persistence/order helpers.

If queue actions are easier to expose through REST rather than websocket-only mutations, add dedicated conversation queue routes under `app/api/conversations/[conversationId]/...`.

## Testing

### Automated

Required coverage:

1. Submitting during an active turn creates a queue item instead of sending immediately.
2. Multiple queued items preserve FIFO order.
3. Pending queue items can be edited.
4. Pending queue items can be deleted.
5. `Send now` stops the active turn, promotes the selected item, and dispatches it next.
6. Queue rows survive snapshot refresh and page reload.
7. Completed, stopped, and failed turns all trigger next-item dispatch when appropriate.
8. Only one queued item dispatches at a time even with repeated reconnect or duplicate triggers.
9. Orphaned `processing` rows recover safely after restart.
10. Failed queue items remain editable or retryable according to the selected action design.

### Manual validation

1. Start a long assistant response and submit three follow-ups.
2. Confirm the follow-ups appear in the banner stack, not in the transcript.
3. Edit the second queued item and delete the third.
4. Use `Send now` on the second queued item and confirm the current turn stops and that item dispatches next.
5. Reload the page during an active turn with pending queue items and confirm the queue rehydrates.
6. Quit and relaunch the app, then confirm the queue still exists and continues from server state.
7. Let queued items dispatch automatically and confirm they appear as ordinary user messages only when actually sent.

## Open decisions resolved

- Queue scope: multiple queued items per conversation
- Queue ordering: FIFO with `Send now` promotion
- Queue editing: pending items are editable and deletable
- Queue payload semantics: deferred user intent only, no snapshot of current runtime state
- Queue persistence: server-side and durable across reloads/app restarts
- Queue UI placement: banner stack above the composer
