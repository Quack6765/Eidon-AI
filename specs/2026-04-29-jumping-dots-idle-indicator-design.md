# Jumping Dots Idle Indicator

## Problem

When the agent is working but not actively streaming text (e.g. between tool call executions), the chat UI shows no activity indicator. The last message bubble sits idle with no visual feedback that the agent is still working. This makes the app feel frozen.

## Solution

Show the existing `TypingIndicator` (triple jumping dots) below the last assistant message bubble during gaps in streaming activity. The dots appear after a 300ms silence and disappear instantly when new streaming activity begins.

## Mechanism

### Gap Detection (ChatView-level)

A timer-based approach in ChatView:

- New state: `isAgentIdle: boolean`
- A `useEffect` resets a 300ms timeout on every streaming event (thinking_delta, answer_delta, action_start, action_complete, compaction_start, compaction_end)
- When the timeout fires, set `isAgentIdle = true`
- When a new streaming event arrives, set `isAgentIdle = false` immediately

### Condition for Showing Dots

```
isStreamingMessage && isAgentIdle && hasReceivedFirstToken
```

The `hasReceivedFirstToken` check ensures we don't double up with the existing `awaitingFirstToken` dots that appear inside MessageBubble for fresh messages.

### Rendering

The dots render as a sibling element below the streaming `MessageBubble` in the message list. Reuse the existing `TypingIndicator` component. Add a CSS fade-in (opacity 0 to 1 over 150ms) for smooth appearance. Instant hide on new activity.

No changes to MessageBubble internals.

## Lifecycle

### Dots Appear When

- Between tool call completions and the next event (> 300ms gap)
- After compaction ends, before thinking/answer starts
- Any mid-turn silence > 300ms

### Dots Disappear When

- Any new streaming event arrives
- Turn completes (done event)
- Turn stops (user clicks stop)
- Turn errors out

### No-Dots Cases

- Pre-first-token on a fresh message (handled by existing awaitingFirstToken)
- Text actively streaming (events reset timer continuously)
- Tool call action row visible and in progress (action_start resets timer)

## Files Changed

- `components/chat-view.tsx` — add isAgentIdle state, timer logic, render dots below streaming MessageBubble
- `components/message-bubble.tsx` — extract TypingIndicator to a standalone export so ChatView can import it
- `app/globals.css` — add fade-in animation class for the dots container