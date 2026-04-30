# Jumping Dots Idle Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show jumping dots below the assistant's last message when the agent is working but not actively streaming visible output.

**Architecture:** Timer-based gap detection in ChatView. A 300ms timeout resets on every streaming event; when it fires, `isAgentIdle` becomes true and the existing `TypingIndicator` component renders below the streaming MessageBubble. Instant hide on new activity. No changes to MessageBubble internals.

**Tech Stack:** React (useState, useEffect, useRef), Tailwind CSS, existing TypingIndicator component

---

### Task 1: Export TypingIndicator from message-bubble.tsx

**Files:**
- Modify: `components/message-bubble.tsx:252`

The `TypingIndicator` is currently a local function component inside `message-bubble.tsx`. Export it so `ChatView` can import it.

- [ ] **Step 1: Export TypingIndicator**

Change line 252 from:

```tsx
function TypingIndicator({ compact = false }: { compact?: boolean }) {
```

to:

```tsx
export function TypingIndicator({ compact = false }: { compact?: boolean }) {
```

- [ ] **Step 2: Verify no compile errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to TypingIndicator

- [ ] **Step 3: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "Export TypingIndicator component from message-bubble"
```

---

### Task 2: Add isAgentIdle state and timer logic to ChatView

**Files:**
- Modify: `components/chat-view.tsx`

Add the idle detection state and the timer effect that resets on every streaming event.

- [ ] **Step 1: Add state declaration**

Add after line 508 (after `const [queueBannerHeight, setQueueBannerHeight] = useState(0);`):

```tsx
const [isAgentIdle, setIsAgentIdle] = useState(false);
const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 2: Add the idle timer reset effect**

Add a new function after `handleDelta` (after line ~1016, before `useWebSocket`):

```tsx
function resetIdleTimer() {
  if (idleTimerRef.current !== null) {
    clearTimeout(idleTimerRef.current);
  }
  setIsAgentIdle(false);
  idleTimerRef.current = setTimeout(() => {
    setIsAgentIdle(true);
  }, 300);
}

function clearIdleTimer() {
  if (idleTimerRef.current !== null) {
    clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }
  setIsAgentIdle(false);
}
```

- [ ] **Step 3: Call resetIdleTimer on every streaming event in handleDelta**

In the `handleDelta` function, add `resetIdleTimer()` calls at each event handler. Specifically, add it:

1. Inside `compaction_start` handler (after `setCompactionInProgress(true);`, before `return;`)
2. Inside `compaction_end` handler (after `setCompactionInProgress(false);`, before `return;`)
3. Inside `message_start` handler (after `setHasReceivedFirstToken(false);`, before the other resets)
4. Inside `thinking_delta` handler (after `setHasReceivedFirstToken(true);`)
5. Inside `answer_delta` handler (after `setHasReceivedFirstToken(true);`)
6. Inside `action_start` handler (at the top of the block, after `clearCompactionIndicator();`)
7. Inside `action_complete` / `action_error` handler (after `clearCompactionIndicator();`)
8. Inside `done` handler — call `clearIdleTimer()` instead of `resetIdleTimer()` (after `clearCompactionIndicator();`)
9. Inside `error` handler — call `clearIdleTimer()` instead of `resetIdleTimer()` (after `clearCompactionIndicator();`)

For `done` and `error`, use `clearIdleTimer()` because the turn is over — we want to clear the timer and reset idle state entirely, not start a new timer.

- [ ] **Step 4: Add cleanup for the idle timer**

Add a cleanup effect to clear the timer on unmount:

```tsx
useEffect(() => {
  return () => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
  };
}, []);
```

- [ ] **Step 5: Verify no compile errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to isAgentIdle or idleTimerRef

- [ ] **Step 6: Commit**

```bash
git add components/chat-view.tsx
git commit -m "Add isAgentIdle state and timer-based gap detection"
```

---

### Task 3: Render TypingIndicator below the streaming message

**Files:**
- Modify: `components/chat-view.tsx:1965-2013`

Add the jumping dots as a sibling element below the streaming `MessageBubble` when idle conditions are met.

- [ ] **Step 1: Add import at the top of the file**

At the top of `components/chat-view.tsx`, add `TypingIndicator` to the import from `./message-bubble`:

```tsx
import { MessageBubble, TypingIndicator } from "./message-bubble";
```

(Find the existing `MessageBubble` import and add `TypingIndicator` to the named imports.)

- [ ] **Step 2: Render dots below the streaming message bubble**

Inside the message rendering loop (around line 2010, after the `</MessageBubble>` closing tag and before the closing `</div>`), add the dots. The current code renders each message like:

```tsx
return (
  <div
    key={message.id}
    className="animate-slide-up"
    style={{ animationFillMode: "forwards" }}
  >
    <MessageBubble ... />
  </div>
);
```

Change to:

```tsx
return (
  <div
    key={message.id}
    className="animate-slide-up"
    style={{ animationFillMode: "forwards" }}
  >
    <MessageBubble ... />
    {isStreamingMessage && isAgentIdle && hasReceivedFirstToken && (
      <div className="animate-fade-in pl-4 pt-1">
        <TypingIndicator compact />
      </div>
    )}
  </div>
);
```

The condition `isStreamingMessage && isAgentIdle && hasReceivedFirstToken` ensures:
- Only shows for the currently-streaming message
- Only shows when the idle timer has fired (300ms gap)
- Only shows after first token received (pre-first-token gap is already handled by `awaitingFirstToken` inside MessageBubble)

The `compact` prop renders smaller dots with less padding, appropriate for appearing below existing content.

- [ ] **Step 3: Verify no compile errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add components/chat-view.tsx
git commit -m "Render jumping dots below streaming message during idle gaps"
```

---

### Task 4: Manual testing and verification

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Wait for `.dev-server` file to appear, then read the URL.

- [ ] **Step 2: Test the idle dots appear during tool call gaps**

1. Open the chat in a browser
2. Send a message that will trigger tool calls (e.g. "read the package.json file and explain the dependencies")
3. Watch the assistant message during tool execution
4. Verify: when a tool call completes and there's a >300ms gap before the next event, jumping dots appear below the message bubble
5. Verify: dots disappear immediately when the next streaming event arrives

- [ ] **Step 3: Test dots don't appear during active streaming**

1. Send a simple question that produces a direct answer (no tool calls)
2. Verify: no dots appear while text is streaming
3. Verify: the existing `awaitingFirstToken` dots still work correctly before first token

- [ ] **Step 4: Test dots disappear on turn completion**

1. Send any message
2. Wait for the turn to complete fully
3. Verify: dots are not visible after completion

- [ ] **Step 5: Test stop button clears dots**

1. Send a message that will trigger tool calls
2. Wait for idle dots to appear
3. Click the stop button
4. Verify: dots disappear immediately

- [ ] **Step 6: Take a screenshot to confirm visual appearance**

Use agent-browser to take a screenshot during an idle gap and verify the dots look correct — small, below the bubble, with smooth fade-in.

- [ ] **Step 7: Final commit if any adjustments are needed**

```bash
git add -A
git commit -m "Polish jumping dots idle indicator"
```
