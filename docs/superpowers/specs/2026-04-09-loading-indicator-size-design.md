# Loading Indicator Size Adjustment

**Date:** 2026-04-09
**Status:** Draft

## Problem

The assistant's initial pre-stream loading state uses the standard assistant bubble container, which makes the three-dot indicator noticeably larger than the compact thinking shell that appears immediately after reasoning begins. This creates an avoidable visual jump between the "waiting for first token" state and the "thinking" state.

## Design

### Recommended Approach

Introduce a dedicated compact loading shell for the `awaitingFirstToken && !compactionInProgress` branch in `MessageBubble`.

### Behavior

- The loading state remains dots-only.
- The dot animation timing and behavior remain unchanged.
- The compact loading shell should be visually close to the existing thinking shell in footprint and density.
- The thinking shell remains unchanged.
- The compaction indicator path remains unchanged.

### Styling Direction

- Replace the large assistant bubble wrapper for the initial loading state with a small shell that uses:
  - tight horizontal padding
  - short vertical padding
  - compact border radius
  - the same subdued border and background treatment already used by the thinking shell
- Keep the three animated dots centered inside the shell.
- Slightly tighten the dot spacing if needed so the shell width stays close to the thinking card width.

### Scope

- Update the loading shell styling in `components/message-bubble.tsx`.
- Keep the rest of the assistant bubble styling untouched.

## Testing

- Add or update a unit test covering the awaiting-first-token loading shell so the compact loading state is distinguishable from the larger assistant message bubble.
- Validate the chat UI in the browser and capture a screenshot showing the smaller loading shell before streaming begins.

## Out of Scope

- Changing the thinking card layout
- Changing the dot animation itself
- Changing streamed assistant message bubble sizing
- Any broader chat layout refactor
