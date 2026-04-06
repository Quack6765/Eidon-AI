# Compaction Indicator Design

## Overview

Hermes currently shows the compaction notice as visible transcript text: `Older context compacted to stay within model limits.` During live turns this can appear twice because the UI receives both a streamed notice and a persisted system message. The desired behavior is different from both the current text and the current persistence model.

This design replaces the visible compaction notice with a transient in-progress separator. While compaction is running, the chat transcript shows a faint horizontal divider with the label `Compacting` and a low-contrast animated sweep. Once compaction finishes and normal assistant output continues, the separator disappears entirely and does not remain in the transcript.

## Approved UX

### Visual treatment

- Render the indicator as a transcript separator, not as a chat bubble
- Use a low-noise horizontal divider with a centered `Compacting` label
- Keep the label small, uppercase, and visually subordinate to real messages
- Animate a soft left-to-right sweep that reverses direction, using the existing accent family and subtle opacity
- Avoid spinners, pills, or heavy status chrome

### Lifecycle

- Show the separator only while compaction is actively in progress
- Remove it as soon as compaction completes and assistant streaming proceeds
- Do not persist the separator as a visible transcript artifact
- Do not render any replacement completed state

### User-selected option

The approved direction is the `Whisper Separator` option:

- faint horizontal lines extending left and right
- compact centered label
- very soft sweep animation
- visually closer to a system transition than a message row

## Root Cause

The duplicate compaction text is caused by two distinct data paths:

1. `ensureCompactedContext` persists a visible system message with `systemKind: "compaction_notice"`
2. The streaming path also emits a websocket `system_notice` event, and the client appends that as another visible message

Because the websocket notice uses a synthetic client id and the persisted message has a different server id, snapshot reconciliation does not collapse them. Both survive and render as separate rows.

This is a state-model problem, not a rendering-only problem.

## Architecture

### Current model

```
compaction starts
  -> persist visible system message
  -> emit websocket notice
  -> client appends live system message
  -> snapshot sync returns persisted system message
  -> transcript can contain two compaction rows
```

### Target model

```
compaction starts
  -> emit transient websocket compaction-start event
  -> client renders ephemeral separator state
compaction ends
  -> emit transient websocket compaction-end event, or clear on first assistant output
  -> client removes separator
  -> no visible persisted compaction message remains
```

## Recommended Approach

Use a hybrid cleanup that changes both the server contract and the client reconciliation logic.

### Server

- Stop treating compaction progress as a visible persisted message
- Replace the current streamed `system_notice` usage for compaction with an explicit transient event for compaction activity
- Keep compaction internals and memory-node persistence unchanged
- Ensure the API and websocket paths share the same transient event semantics

### Client

- Track compaction as ephemeral stream UI state rather than as a `Message`
- Render the whisper separator inline in the chat timeline while that state is active
- Clear the separator immediately when:
  - compaction completion is signaled, or
  - the first assistant thinking/answer/action event that follows compaction arrives
- Add a defensive dedupe path so any stray compaction notice cannot survive reconciliation by semantic kind

## Rendering Design

### Placement

- Render the separator in the assistant flow area, between existing transcript rows
- It should sit naturally in the transcript stack and respect current chat spacing
- It should not affect assistant bubble ordering, thinking shells, or action rows after it is removed

### Styling

- Use Hermes dark theme tokens from `app/globals.css`
- Reuse the existing accent and border language rather than introducing a new palette
- Implement the sweep with CSS keyframes in the global stylesheet or another shared styling location
- Keep the effect understated:
  - low opacity
  - narrow sweep band
  - no large glow bloom
  - no dramatic shadow

### Accessibility and motion

- The label text must remain readable without depending on the animation
- The animation should be decorative only and not required to understand state
- Respect reduced-motion preferences by disabling the sweep and leaving a static separator

## State and Event Contract

### New transient event shape

The compaction UI should use explicit streaming events instead of overloading visible system messages:

- `compaction_start`
- `compaction_end`

These events exist only to drive transient UI state and must not be stored as visible transcript messages.

### Reconciliation rule

If the client receives any persisted compaction notice during snapshot sync, it should either:

- filter it from visible transcript rendering, or
- semantically merge it away

The goal is that the transcript never shows the old textual notice again.

## Files Expected To Change

| File | Purpose |
|------|---------|
| `lib/compaction.ts` | Remove visible persisted compaction notice behavior and expose transient compaction activity |
| `lib/chat-turn.ts` | Emit compaction lifecycle events on the websocket path |
| `app/api/conversations/[conversationId]/chat/route.ts` | Keep API streaming behavior aligned with the websocket contract |
| `lib/types.ts` | Add the transient compaction event type |
| `components/chat-view.tsx` | Track ephemeral compaction state and clear it at the right time |
| `components/message-bubble.tsx` or a new local chat UI primitive | Render the whisper separator |
| `app/globals.css` | Add the subtle sweep animation and separator styling |
| `tests/unit/chat-view.test.ts` | Cover transient visibility and cleanup |
| `tests/unit/message-bubble.test.ts` or a new component test | Cover rendering of the separator |

## Risks

### Streaming order

Compaction can occur before assistant streaming begins. The transient state must not block or reorder assistant timeline items once output starts.

### Snapshot races

If snapshot sync lands while the transient separator is still visible, the sync path must not reintroduce persisted compaction text or accidentally clear the indicator too early.

### Reduced motion

The sweep should not create visual noise or fail accessibility expectations when motion is reduced.

## Testing

### Unit tests

- compaction indicator appears when the transient start event is received
- compaction indicator disappears when compaction ends
- compaction indicator disappears when assistant output starts after compaction
- snapshot reconciliation does not leave duplicate compaction UI behind
- old persisted compaction notice text does not render as a visible transcript row

### Verification

- `npm run lint`
- `npm run typecheck`
- `npm run test`
- run focused tests covering chat view and compaction behavior

## Non-Goals

- changing the underlying memory-node compaction algorithm
- changing compaction thresholds or provider settings
- introducing a completed compaction transcript artifact
- redesigning other system notices or tool activity rows
