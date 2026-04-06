# Compaction Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated visible compaction notice with a transient whisper-style `Compacting` separator that appears only while compaction is running and disappears completely once assistant output resumes.

**Architecture:** Clean the contract at the source by removing persisted visible compaction notices, emit explicit transient compaction lifecycle events from the streaming paths, and render the in-progress UI as a dedicated lightweight separator inside the assistant row instead of as a transcript message. Hide any legacy persisted `compaction_notice` rows at the visibility layer so historical conversations stop rendering the old text immediately.

**Tech Stack:** TypeScript, Next.js App Router, React 19, Tailwind CSS, Vitest, better-sqlite3

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types.ts` | MODIFY | Add transient `compaction_start` / `compaction_end` stream events and replace the old compaction notice return shape |
| `lib/compaction.ts` | MODIFY | Stop creating visible compaction notice messages, expose `didCompact`, and fire compaction lifecycle callbacks only during real compaction work |
| `lib/conversations.ts` | MODIFY | Hide legacy `compaction_notice` rows from visible transcript payloads |
| `lib/chat-turn.ts` | MODIFY | Emit transient compaction lifecycle events on the websocket path |
| `app/api/conversations/[conversationId]/chat/route.ts` | MODIFY | Emit the same transient events on the SSE path and move `message_start` before compaction |
| `components/chat-view.tsx` | MODIFY | Track ephemeral compaction UI state, sanitize legacy compaction rows, and clear the indicator on completion or first downstream assistant activity |
| `components/compaction-indicator.tsx` | NEW | Render the low-noise whisper separator |
| `components/message-bubble.tsx` | MODIFY | Show the separator instead of the typing bubble while the assistant shell is waiting on compaction |
| `app/globals.css` | MODIFY | Add subtle sweep animation, reduced-motion handling, and separator styles |
| `tests/unit/compaction.test.ts` | MODIFY | Cover `didCompact`, callback firing, and no persisted visible compaction notice |
| `tests/unit/conversations.test.ts` | MODIFY | Cover hidden legacy `compaction_notice` rows |
| `tests/unit/chat-view.test.ts` | MODIFY | Cover transient compaction state, cleanup, and defensive dedupe |
| `tests/unit/message-bubble.test.ts` | MODIFY | Cover separator rendering in the assistant waiting state |
| `agent-memory/frontend/ui.md` | MODIFY | Record the new transient compaction separator behavior in the UI memory |

## Type Changes

Apply these changes first so the rest of the tasks can reference stable names.

```typescript
// lib/types.ts
export type ChatStreamEvent =
  | { type: "message_start"; messageId: string }
  | { type: "thinking_delta"; text: string }
  | { type: "answer_delta"; text: string }
  | { type: "action_start"; action: MessageAction }
  | { type: "action_complete"; action: MessageAction }
  | { type: "action_error"; action: MessageAction }
  | { type: "compaction_start" }
  | { type: "compaction_end" }
  | { type: "system_notice"; text: string; kind: SystemMessageKind }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
    }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type EnsureCompactedContextResult = {
  promptMessages: PromptMessage[];
  promptTokens: number;
  didCompact: boolean;
};
```

The old `compactionNoticeEvent` field should be removed from the compaction result contract.

---

### Task 1: Remove Visible Compaction Notices From The Domain Layer

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/compaction.ts`
- Modify: `lib/conversations.ts`
- Test: `tests/unit/compaction.test.ts`
- Test: `tests/unit/conversations.test.ts`

- [ ] **Step 1: Write the failing tests**

Update `tests/unit/compaction.test.ts` by replacing the old notice assertion and adding callback coverage:

```typescript
it("compacts older turns without creating a visible compaction notice message", async () => {
  updateDefaultProfile({
    modelContextLimit: 6000,
    compactionThreshold: 0.7
  });

  const conversation = createConversation();

  for (let index = 0; index < 18; index += 1) {
    createMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index} ${"dense context ".repeat(90)}`,
      thinkingContent: index % 2 === 1 ? "Reasoning " + "step ".repeat(24) : ""
    });
  }

  const lifecycle: string[] = [];
  const result = await ensureCompactedContext(
    conversation.id,
    getDefaultProviderProfileWithApiKey()!,
    {
      onCompactionStart() {
        lifecycle.push("start");
      },
      onCompactionEnd() {
        lifecycle.push("end");
      }
    }
  );
  const messages = listMessages(conversation.id);

  expect(result.didCompact).toBe(true);
  expect(lifecycle).toEqual(["start", "end"]);
  expect(messages.some((message) => message.systemKind === "compaction_notice")).toBe(false);
});
```

Update `tests/unit/conversations.test.ts`:

```typescript
it("hides compaction notices from visible message lists", () => {
  const conversation = createConversation();

  createMessage({
    conversationId: conversation.id,
    role: "system",
    content: "Compacted older messages into memory.",
    systemKind: "compaction_notice"
  });
  createMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Visible user message"
  });

  expect(listMessages(conversation.id)).toHaveLength(2);
  expect(listVisibleMessages(conversation.id).map((message) => message.content)).toEqual([
    "Visible user message"
  ]);
  expect(
    isVisibleMessage({
      role: "system",
      systemKind: "compaction_notice"
    })
  ).toBe(false);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/compaction.test.ts tests/unit/conversations.test.ts
```

Expected:

- `tests/unit/compaction.test.ts` fails because `ensureCompactedContext` still exposes `compactionNoticeEvent`
- `tests/unit/conversations.test.ts` fails because `compaction_notice` is still considered visible

- [ ] **Step 3: Update the compaction contract and visibility rules**

Modify `lib/compaction.ts`:

```typescript
import {
  bumpConversation,
  getConversation,
  isVisibleMessage,
  listMessages,
  markMessagesCompacted
} from "@/lib/conversations";
import type {
  EnsureCompactedContextResult,
  MemoryNode,
  Message,
  MessageAttachment,
  PromptContentPart,
  PromptMessage,
  ProviderProfileWithApiKey
} from "@/lib/types";

type CompactionLifecycleHooks = {
  onCompactionStart?: () => void;
  onCompactionEnd?: () => void;
};

async function compactLeafMessages(
  conversationId: string,
  messages: Message[],
  settings: ProviderProfileWithApiKey,
  hooks: Pick<CompactionLifecycleHooks, "onCompactionStart">
) {
  hooks.onCompactionStart?.();
  const summary = await summarizeBlocks(conversationId, prompt, settings);
  const summaryTokenCount = estimateTextTokens(summary);

  const node = insertMemoryNode({
    conversationId,
    type: "leaf_summary",
    depth: 0,
    content: summary,
    sourceStartMessageId: messages[0]!.id,
    sourceEndMessageId: messages.at(-1)!.id,
    sourceTokenCount,
    summaryTokenCount
  });

  markMessagesCompacted(messages.map((message) => message.id));
  bumpConversation(conversationId);

  return node;
}

export async function ensureCompactedContext(
  conversationId: string,
  settings: ProviderProfileWithApiKey,
  hooks: CompactionLifecycleHooks = {}
): Promise<EnsureCompactedContextResult> {
  if (!getConversation(conversationId)) {
    throw new Error("Conversation not found");
  }

  let didCompact = false;
  let compactionLifecycleOpen = false;

  const beginCompaction = () => {
    if (compactionLifecycleOpen) return;
    compactionLifecycleOpen = true;
    hooks.onCompactionStart?.();
  };

  const endCompaction = () => {
    if (!compactionLifecycleOpen) return;
    compactionLifecycleOpen = false;
    hooks.onCompactionEnd?.();
  };

  try {
    while (true) {
      const messages = listMessages(conversationId);
      const visibleMessages = messages.filter((message) => !message.compactedAt);
      const promptMessages = buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        messages: visibleMessages,
        activeMemoryNodes: getActiveMemoryNodes(conversationId),
        maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO)
      });

      if (estimatePromptTokens(promptMessages) <= compactionLimit) {
        return {
          promptMessages,
          promptTokens: estimatePromptTokens(promptMessages),
          didCompact
        };
      }

      const eligible = getCompactionEligibleMessages(messages, effectiveFreshTail);
      const compacted = await compactLeafMessages(conversationId, eligible, settings, {
        onCompactionStart: beginCompaction
      });

      if (compacted) {
        didCompact = true;
        effectiveFreshTail = settings.freshTailCount;
        await condenseMemoryNodes(conversationId, settings);
        bumpConversation(conversationId);
        continue;
      }
    }
  } finally {
    endCompaction();
  }
}
```

Remove the old notice creation block entirely:

```typescript
if (didCompact) {
  const notice = createMessage({
    conversationId,
    role: "system",
    content: "Older context compacted to stay within model limits.",
    systemKind: "compaction_notice",
    status: "completed"
  });
  noticeEvent = {
    type: "system_notice",
    text: notice.content,
    kind: "compaction_notice"
  };
}
```

Modify `lib/conversations.ts`:

```typescript
export function isVisibleMessage(
  message: Pick<Message, "role" | "systemKind">
) {
  if (message.role !== "system") {
    return true;
  }

  return message.systemKind !== null && message.systemKind !== "compaction_notice";
}
```

Modify `lib/types.ts` with the `EnsureCompactedContextResult` type and new stream event variants from the header.

- [ ] **Step 4: Run the targeted tests again**

Run:

```bash
npx vitest run tests/unit/compaction.test.ts tests/unit/conversations.test.ts
```

Expected:

- both files PASS
- no assertion references `compactionNoticeEvent`

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/compaction.ts lib/conversations.ts tests/unit/compaction.test.ts tests/unit/conversations.test.ts
git commit -m "refactor: remove visible compaction notice messages"
```

---

### Task 2: Emit And Consume Transient Compaction Lifecycle Events

**Files:**
- Modify: `lib/chat-turn.ts`
- Modify: `app/api/conversations/[conversationId]/chat/route.ts`
- Modify: `components/chat-view.tsx`
- Test: `tests/unit/chat-view.test.ts`

- [ ] **Step 1: Write the failing chat view tests**

Add these tests to `tests/unit/chat-view.test.ts`:

```typescript
it("shows the transient compaction indicator and clears it when compaction ends", async () => {
  render(React.createElement(ChatView, { payload: createPayload() }));

  wsMock.onMessage!({
    type: "delta",
    conversationId: "conv_1",
    event: { type: "message_start", messageId: "msg_assistant" }
  });
  wsMock.onMessage!({
    type: "delta",
    conversationId: "conv_1",
    event: { type: "compaction_start" }
  });

  await waitFor(() => {
    expect(screen.getByText("Compacting")).toBeInTheDocument();
  });

  wsMock.onMessage!({
    type: "delta",
    conversationId: "conv_1",
    event: { type: "compaction_end" }
  });

  await waitFor(() => {
    expect(screen.queryByText("Compacting")).toBeNull();
  });
});

it("clears the transient compaction indicator on the first downstream assistant activity", async () => {
  render(React.createElement(ChatView, { payload: createPayload() }));

  wsMock.onMessage!({
    type: "delta",
    conversationId: "conv_1",
    event: { type: "message_start", messageId: "msg_assistant" }
  });
  wsMock.onMessage!({
    type: "delta",
    conversationId: "conv_1",
    event: { type: "compaction_start" }
  });

  await waitFor(() => {
    expect(screen.getByText("Compacting")).toBeInTheDocument();
  });

  wsMock.onMessage!({
    type: "delta",
    conversationId: "conv_1",
    event: { type: "thinking_delta", text: "Thinking through the answer" }
  });

  await waitFor(() => {
    expect(screen.queryByText("Compacting")).toBeNull();
  });
});

it("filters legacy persisted compaction notices from initial payload rendering", () => {
  const payload = createPayload();
  payload.messages = [
    {
      id: "msg_notice",
      conversationId: "conv_1",
      role: "system",
      content: "Older context compacted to stay within model limits.",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: "compaction_notice",
      compactedAt: null,
      createdAt: new Date().toISOString()
    },
    {
      id: "msg_user",
      conversationId: "conv_1",
      role: "user",
      content: "Hello",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString()
    }
  ];

  render(React.createElement(ChatView, { payload }));

  expect(screen.queryByText("Older context compacted to stay within model limits.")).toBeNull();
  expect(screen.getByText("Hello")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted chat view tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/chat-view.test.ts -t "compaction"
```

Expected:

- the new tests fail because `compaction_start` / `compaction_end` are not handled
- the legacy persisted `compaction_notice` still renders from payload state

- [ ] **Step 3: Wire the transient events through both streaming entry points**

Modify `lib/chat-turn.ts`:

```typescript
  manager.broadcast(conversationId, {
    type: "delta",
    conversationId,
    event: { type: "message_start", messageId: assistantMessage.id }
  });

  try {
    const compacted = await ensureCompactedContext(conversation.id, settings, {
      onCompactionStart() {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "compaction_start" }
        });
      },
      onCompactionEnd() {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "compaction_end" }
        });
      }
    });
```

Modify `app/api/conversations/[conversationId]/chat/route.ts` so the assistant shell exists before compaction begins:

```typescript
      write({
        type: "message_start",
        messageId: assistantMessage.id
      });

      try {
        const compacted = await ensureCompactedContext(conversation.id, settings, {
          onCompactionStart() {
            write({ type: "compaction_start" });
          },
          onCompactionEnd() {
            write({ type: "compaction_end" });
          }
        });
```

Delete the old streamed notice branch:

```typescript
if (compacted.compactionNoticeEvent) {
  write(compacted.compactionNoticeEvent);
}
```

- [ ] **Step 4: Track ephemeral compaction state in the chat view**

Modify `components/chat-view.tsx`:

```typescript
function isLegacyCompactionNotice(message: Pick<Message, "role" | "systemKind">) {
  return message.role === "system" && message.systemKind === "compaction_notice";
}

function sanitizeMessages(messages: Message[]) {
  return messages.filter((message) => !isLegacyCompactionNotice(message));
}

function reconcileSnapshotMessages(
  current: Message[],
  snapshot: Message[],
  activeStreamMessageId: string | null
) {
  const sanitizedSnapshot = sanitizeMessages(snapshot);
  if (sanitizedSnapshot.length === 0) {
    return current.filter((message) => !isLegacyCompactionNotice(message));
  }

  const merged = sanitizedSnapshot.map((snapshotMsg) => {
    const currentMsg = current.find((m) => m.id === snapshotMsg.id);

    if (currentMsg && currentMsg.id === activeStreamMessageId) {
      return currentMsg;
    }

    if (currentMsg && currentMsg.status === "completed" && snapshotMsg.status === "streaming") {
      return currentMsg;
    }

    return snapshotMsg;
  });

  const snapshotMessageIds = new Set(sanitizedSnapshot.map((message) => message.id));
  const currentNonLocalIds = new Set(
    current.filter((message) => !message.id.startsWith("local_")).map((message) => message.id)
  );
  const newServerUserMessages = sanitizedSnapshot.filter(
    (message) => message.role === "user" && !currentNonLocalIds.has(message.id)
  );
  const pendingLocalUserMessages = current.filter(
    (message) => message.id.startsWith("local_") && message.role === "user" && !snapshotMessageIds.has(message.id)
  );

  const confirmCount = Math.min(pendingLocalUserMessages.length, newServerUserMessages.length);
  const confirmedLocalIds = new Set<string>();
  for (let index = 0; index < confirmCount; index += 1) {
    confirmedLocalIds.add(pendingLocalUserMessages[index]!.id);
  }

  const pendingLocalMessages = current.filter((message) => {
    if (snapshotMessageIds.has(message.id)) {
      return false;
    }

    if (confirmedLocalIds.has(message.id)) {
      return false;
    }

    return !isLegacyCompactionNotice(message);
  });

  return [...merged, ...pendingLocalMessages];
}

const [messages, setMessages] = useState(() => sanitizeMessages(payload.messages));
const [compactionInProgress, setCompactionInProgress] = useState(false);
const compactionInProgressRef = useRef(false);

useEffect(() => {
  setMessages(sanitizeMessages(payload.messages));
}, [payload.messages]);

useEffect(() => {
  compactionInProgressRef.current = compactionInProgress;
}, [compactionInProgress]);

function clearCompactionIndicator() {
  if (compactionInProgressRef.current) {
    setCompactionInProgress(false);
  }
}
```

Update `handleDelta`:

```typescript
    if (event.type === "compaction_start") {
      setCompactionInProgress(true);
      return;
    }

    if (event.type === "compaction_end") {
      setCompactionInProgress(false);
      return;
    }

    if (event.type === "thinking_delta") {
      clearCompactionIndicator();
      setHasReceivedFirstToken(true);
      const nextThinking = `${streamThinkingTargetRef.current}${event.text}`;
      streamThinkingTargetRef.current = nextThinking;
      setStreamThinkingTarget(nextThinking);
      if (!thinkingStartTimeRef.current) {
        thinkingStartTimeRef.current = Date.now();
      }
    }

    if (event.type === "answer_delta") {
      clearCompactionIndicator();
      setHasReceivedFirstToken(true);
      const nextAnswer = `${streamAnswerTargetRef.current}${event.text}`;
      streamAnswerTargetRef.current = nextAnswer;
      setStreamAnswerTarget(nextAnswer);
      if (thinkingStartTimeRef.current && !thinkingDuration) {
        const duration = (Date.now() - thinkingStartTimeRef.current) / 1000;
        setThinkingDuration(duration);
      }
    }

    if (event.type === "action_start" || event.type === "action_complete" || event.type === "action_error") {
      clearCompactionIndicator();
    }

    if (event.type === "done" || event.type === "error") {
      clearCompactionIndicator();
    }
```

Pass the new prop into the active assistant shell:

```typescript
              <MessageBubble
                message={message}
                streamingTimeline={message.id === streamMessageId ? streamTimeline : undefined}
                streamingThinking={message.id === streamMessageId ? streamThinkingDisplay : undefined}
                streamingAnswer={message.id === streamMessageId ? streamAnswerDisplay : undefined}
                awaitingFirstToken={
                  message.id === streamMessageId
                    ? !hasReceivedFirstToken &&
                      !streamAnswerDisplay &&
                      !message.content &&
                      !(message.timeline?.length ?? 0)
                    : false
                }
                compactionInProgress={message.id === streamMessageId ? compactionInProgress : false}
```

- [ ] **Step 5: Run the targeted chat view tests again**

Run:

```bash
npx vitest run tests/unit/chat-view.test.ts -t "compaction"
```

Expected:

- all new `compaction` tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/chat-turn.ts app/api/conversations/[conversationId]/chat/route.ts components/chat-view.tsx tests/unit/chat-view.test.ts
git commit -m "feat: stream transient compaction lifecycle events"
```

---

### Task 3: Render The Whisper Separator In The Assistant Waiting State

**Files:**
- Create: `components/compaction-indicator.tsx`
- Modify: `components/message-bubble.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/message-bubble.test.ts`

- [ ] **Step 1: Write the failing rendering test**

Add this test to `tests/unit/message-bubble.test.ts`:

```typescript
it("renders a compaction separator instead of typing dots while compaction is active", () => {
  const { container } = render(
    React.createElement(StreamingPlaceholder, {
      createdAt: new Date().toISOString(),
      thinking: "",
      answer: "",
      awaitingFirstToken: true,
      thinkingInProgress: false,
      compactionInProgress: true,
      timeline: []
    })
  );

  expect(screen.getByText("Compacting")).toBeInTheDocument();
  expect(container.querySelector(".compaction-indicator")).not.toBeNull();
  expect(container.querySelector(".typing-dot")).toBeNull();
});
```

- [ ] **Step 2: Run the targeted rendering test to verify it fails**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "compaction separator"
```

Expected:

- FAIL because `StreamingPlaceholder` and `MessageBubble` do not accept `compactionInProgress`

- [ ] **Step 3: Create the separator component**

Create `components/compaction-indicator.tsx`:

```typescript
"use client";

import React from "react";

export function CompactionIndicator() {
  return (
    <div
      className="compaction-indicator flex w-full items-center gap-3 py-1.5"
      data-testid="compaction-indicator"
      aria-live="polite"
    >
      <span className="compaction-indicator__line" aria-hidden="true" />
      <span className="compaction-indicator__label">Compacting</span>
      <span className="compaction-indicator__line" aria-hidden="true" />
    </div>
  );
}
```

- [ ] **Step 4: Use the separator in the assistant shell**

Modify `components/message-bubble.tsx`:

```typescript
import { CompactionIndicator } from "@/components/compaction-indicator";

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-2 px-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="typing-dot h-1.5 w-1.5 rounded-full bg-white/40"
          style={{
            animation: "typing-dot 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`
          }}
        />
      ))}
    </div>
  );
}
```

Extend the props:

```typescript
export function MessageBubble({
  message,
  streamingTimeline,
  streamingThinking,
  streamingAnswer,
  awaitingFirstToken = false,
  compactionInProgress = false,
  thinkingInProgress = false,
  thinkingDuration,
  hasThinking = false,
  onUpdateUserMessage,
  isUpdating = false
}: {
  message: Message;
  streamingTimeline?: MessageTimelineItem[];
  streamingThinking?: string;
  streamingAnswer?: string;
  awaitingFirstToken?: boolean;
  compactionInProgress?: boolean;
  thinkingInProgress?: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
  onUpdateUserMessage?: (messageId: string, content: string) => Promise<void>;
  isUpdating?: boolean;
}) {
```

Replace the waiting branch:

```typescript
            {awaitingFirstToken ? (
              compactionInProgress ? (
                <CompactionIndicator />
              ) : (
                <div className={`${ASSISTANT_MAX_WIDTH} ${ASSISTANT_BUBBLE}`} data-testid="assistant-message-bubble">
                  <TypingIndicator />
                </div>
              )
            ) : assistantBlocks.length || content ? (
```

Update `StreamingPlaceholder`:

```typescript
export function StreamingPlaceholder({
  createdAt,
  thinking,
  answer,
  timeline,
  awaitingFirstToken,
  compactionInProgress = false,
  thinkingInProgress,
  thinkingDuration,
  hasThinking = false
}: {
  createdAt: string;
  thinking: string;
  answer: string;
  timeline: MessageTimelineItem[];
  awaitingFirstToken: boolean;
  compactionInProgress?: boolean;
  thinkingInProgress: boolean;
  thinkingDuration?: number;
  hasThinking?: boolean;
}) {
```

Pass the prop through:

```typescript
      compactionInProgress={compactionInProgress}
```

- [ ] **Step 5: Add the whisper separator styling**

Append this to `app/globals.css`:

```css
@keyframes compaction-sweep {
  from {
    transform: translateX(-120%);
  }
  to {
    transform: translateX(220%);
  }
}

.compaction-indicator__line {
  position: relative;
  display: block;
  flex: 1;
  height: 1px;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0),
    rgba(255, 255, 255, 0.06),
    rgba(255, 255, 255, 0)
  );
}

.compaction-indicator__line::after {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 32%;
  background: linear-gradient(
    90deg,
    rgba(139, 92, 246, 0),
    rgba(139, 92, 246, 0.2),
    rgba(139, 92, 246, 0)
  );
  animation: compaction-sweep 2.2s ease-in-out infinite alternate;
}

.compaction-indicator__label {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.02);
  padding: 0.35rem 0.7rem;
  color: rgba(255, 255, 255, 0.46);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .compaction-indicator__line::after {
    animation: none;
  }
}
```

- [ ] **Step 6: Run the targeted rendering tests again**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts -t "compaction separator"
```

Expected:

- the new rendering test PASSes
- all earlier `message-bubble` waiting-state tests remain green

- [ ] **Step 7: Commit**

```bash
git add components/compaction-indicator.tsx components/message-bubble.tsx app/globals.css tests/unit/message-bubble.test.ts
git commit -m "feat: render whisper compaction indicator"
```

---

### Task 4: Update Project Memory And Run Full Verification

**Files:**
- Modify: `agent-memory/frontend/ui.md`

- [ ] **Step 1: Update the UI memory**

Append this bullet under the chat rendering section in `agent-memory/frontend/ui.md`:

```md
- **Compaction Indicator:** When long-context compaction runs before an assistant turn, the waiting assistant shell shows a transient whisper-style `Compacting` separator with a subtle sweep instead of a visible system notice. The separator disappears entirely once normal assistant streaming begins.
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected:

- command exits `0`

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

- command exits `0`

- [ ] **Step 4: Run the unit test suite**

Run:

```bash
npm run test
```

Expected:

- Vitest exits `0`
- the new compaction tests remain green alongside the rest of the suite

- [ ] **Step 5: Commit**

```bash
git add agent-memory/frontend/ui.md
git commit -m "docs: record transient compaction indicator behavior"
```

---

## Self-Review

### Spec coverage

- Transient whisper separator while compaction runs: covered by Task 2 and Task 3
- Duplicate text root cause removed at source: covered by Task 1
- Explicit transient `compaction_start` / `compaction_end` contract: covered by Task 2
- Hide legacy persisted compaction notices: covered by Task 1 and Task 2
- Disappear entirely after completion: covered by Task 2 tests
- Reduced motion handling: covered by Task 3 CSS
- Memory update requirement from AGENTS: covered by Task 4

No uncovered spec requirements remain.

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” markers remain
- All code-changing steps include concrete code blocks
- All verification steps include exact commands and expected outcomes

### Type consistency

- Event names are consistently `compaction_start` and `compaction_end`
- The compaction return shape is consistently `didCompact`
- The client prop name is consistently `compactionInProgress`
