# Queued Chat Follow-Ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users queue multiple follow-up prompts during an active chat turn, edit or delete pending items, and force any pending item to send next via `Send now`, with the queue persisted server-side per conversation.

**Architecture:** Add a dedicated `queued_messages` persistence layer and a conversation-scoped dispatcher that claims one pending queue item at a time and feeds it into the existing `startChatTurn(...)` pipeline. Extend websocket snapshots and chat page payloads to include queue state, then render a banner stack above the composer that manages pending items without polluting the transcript.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 19, `better-sqlite3`, `ws`, Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-04-13-queued-chat-followups-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `lib/queued-chat-dispatcher.ts` | Conversation-scoped queue dispatcher, in-memory dispatch locks, and helper to kick off pending follow-ups once a conversation becomes idle |
| `components/queued-message-banner.tsx` | Banner stack UI for pending, processing, and failed queued follow-ups |
| `tests/unit/queued-chat-dispatcher.test.ts` | Unit coverage for claim/dispatch/lock/recovery behavior |
| `tests/unit/queued-message-banner.test.tsx` | UI coverage for banner rendering, edit/delete, and `Send now` actions |

### Modified files

| File | Change |
|------|--------|
| `lib/db.ts:185-292,647-655` | Add `queued_messages` table, indexes, and migration/recovery glue |
| `lib/types.ts:34-120` | Add `QueuedMessageStatus`, `QueuedMessage`, and snapshot payload types |
| `lib/conversations.ts:910-920` plus new queue helpers nearby | Add queue CRUD, reorder, claim, fail, and snapshot hydration support |
| `lib/ws-protocol.ts:3-29` | Add queue-specific client messages and `queue_updated` server message support |
| `lib/ws-handler.ts:1-137` | Route queue operations and broadcast queue state updates |
| `lib/chat-turn.ts:1-260` | Add dispatch hook so queue rows are deleted when real messages are created, and trigger queue dispatch on turn finalization |
| `app/chat/[conversationId]/page.tsx:1-78` | Include queued messages in initial payload |
| `app/automations/[automationId]/runs/[runId]/page.tsx:1-56` | Include queued messages in automation chat payload |
| `app/api/conversations/[conversationId]/route.ts:1-43` | Return queued messages in polling/snapshot payload |
| `components/chat-view.tsx:32-43,268-281,656-724,915-951,1310-1560` | Track queue state, branch submit behavior, reconcile queue snapshots, and wire queue mutations |
| `components/chat-composer.tsx:29-59,223-234,318-340` | Keep composer submit and stop affordances coherent while queued follow-ups leave attachments composer-local |
| `tests/unit/conversations.test.ts` | Cover queue persistence, reorder, claim, and snapshot hydration |
| `tests/unit/ws-protocol.test.ts` | Cover queue message parsing/serialization |
| `tests/unit/ws-handler.test.ts` | Cover queue create/edit/delete/send-now routing and snapshot payload shape |
| `tests/unit/chat-turn.test.ts` | Cover queue deletion on dispatch and finalizer-triggered follow-up dispatch |
| `tests/unit/chat-view.test.ts` | Cover queueing during streaming, queue hydration, edit/delete, and `Send now` |
| `tests/e2e/features.spec.ts` | Exercise real UI behavior for queueing, `Send now`, and persistence across refresh |

---

## Task 1: Add queued-message schema, types, and conversation helpers

**Files:**
- Modify: `lib/db.ts:185-292,647-655`
- Modify: `lib/types.ts:34-120`
- Modify: `lib/conversations.ts:906-920` and add queue helpers near other conversation persistence functions
- Test: `tests/unit/conversations.test.ts`

- [ ] **Step 1: Write the failing queue persistence tests**

Add these tests to `tests/unit/conversations.test.ts`:

```typescript
it("creates, reorders, and claims queued messages for a conversation", async () => {
  const { createConversation, createQueuedMessage, listQueuedMessages, moveQueuedMessageToFront, claimNextQueuedMessageForDispatch } =
    await import("@/lib/conversations");

  const conversation = createConversation();
  const first = createQueuedMessage({ conversationId: conversation.id, content: "First queued follow-up" });
  const second = createQueuedMessage({ conversationId: conversation.id, content: "Second queued follow-up" });

  moveQueuedMessageToFront({ conversationId: conversation.id, queuedMessageId: second.id });

  expect(listQueuedMessages(conversation.id).map((item) => item.id)).toEqual([second.id, first.id]);

  const claimed = claimNextQueuedMessageForDispatch(conversation.id);
  expect(claimed?.id).toBe(second.id);
  expect(listQueuedMessages(conversation.id)[0]).toMatchObject({
    id: second.id,
    status: "processing"
  });
});

it("includes queued messages in conversation snapshots", async () => {
  const { createConversation, createQueuedMessage, getConversationSnapshot } = await import("@/lib/conversations");

  const conversation = createConversation();
  createQueuedMessage({ conversationId: conversation.id, content: "Queued while busy" });

  expect(getConversationSnapshot(conversation.id)?.queuedMessages).toEqual([
    expect.objectContaining({
      content: "Queued while busy",
      status: "pending"
    })
  ]);
});
```

- [ ] **Step 2: Run the queue persistence test to verify it fails**

Run: `npx vitest run tests/unit/conversations.test.ts`

Expected: FAIL with missing queue helper exports and `queuedMessages` absent from `ConversationSnapshot`.

- [ ] **Step 3: Add the queue table, types, and persistence helpers**

Update `lib/types.ts` with the new queue types:

```typescript
export type QueuedMessageStatus = "pending" | "processing" | "failed" | "cancelled";

export type QueuedMessage = {
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

export type ConversationSnapshot = {
  conversation: Conversation;
  messages: Message[];
  queuedMessages: QueuedMessage[];
};
```

Add the new table and index in `lib/db.ts`:

```typescript
CREATE TABLE IF NOT EXISTS queued_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sort_order INTEGER NOT NULL,
  failure_message TEXT,
  processing_started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queued_messages_conversation_status_sort
  ON queued_messages(conversation_id, status, sort_order, created_at);
```

Add these helpers in `lib/conversations.ts`:

```typescript
export function createQueuedMessage(input: { conversationId: string; content: string }) {
  const db = getDb();
  const now = nowIso();
  const nextSortOrder =
    ((db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS max_sort_order FROM queued_messages WHERE conversation_id = ?")
      .get(input.conversationId) as { max_sort_order: number | null }).max_sort_order ?? 0) + 1;

  const row = {
    id: createId("queued"),
    conversation_id: input.conversationId,
    content: input.content,
    status: "pending" as const,
    sort_order: nextSortOrder,
    failure_message: null,
    processing_started_at: null,
    created_at: now,
    updated_at: now
  };

  db.prepare(`
    INSERT INTO queued_messages (
      id, conversation_id, content, status, sort_order, failure_message, processing_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.conversation_id,
    row.content,
    row.status,
    row.sort_order,
    row.failure_message,
    row.processing_started_at,
    row.created_at,
    row.updated_at
  );

  return rowToQueuedMessage(row);
}

export function claimNextQueuedMessageForDispatch(conversationId: string) {
  const db = getDb();
  return db.transaction(() => {
    const next = db.prepare(`
      SELECT *
      FROM queued_messages
      WHERE conversation_id = ? AND status = 'pending'
      ORDER BY sort_order ASC, created_at ASC
      LIMIT 1
    `).get(conversationId) as QueuedMessageRow | undefined;

    if (!next) return null;

    const now = nowIso();
    const result = db.prepare(`
      UPDATE queued_messages
      SET status = 'processing',
          processing_started_at = ?,
          updated_at = ?,
          failure_message = NULL
      WHERE id = ? AND status = 'pending'
    `).run(now, now, next.id);

    if (result.changes === 0) return null;

    return rowToQueuedMessage({ ...next, status: "processing", processing_started_at: now, updated_at: now, failure_message: null });
  })();
}
```

Also update `getConversationSnapshot(...)` to return `queuedMessages: listQueuedMessages(conversationId)`.

- [ ] **Step 4: Run the conversation tests again**

Run: `npx vitest run tests/unit/conversations.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/types.ts lib/conversations.ts tests/unit/conversations.test.ts
git commit -m "feat: add queued message persistence"
```

---

## Task 2: Expose queue state through snapshots and websocket queue actions

**Files:**
- Modify: `lib/ws-protocol.ts:3-29`
- Modify: `lib/ws-handler.ts:1-137`
- Modify: `app/api/conversations/[conversationId]/route.ts:1-43`
- Modify: `app/chat/[conversationId]/page.tsx:1-78`
- Modify: `app/automations/[automationId]/runs/[runId]/page.tsx:1-56`
- Test: `tests/unit/ws-protocol.test.ts`
- Test: `tests/unit/ws-handler.test.ts`

- [ ] **Step 1: Write the failing protocol and handler tests**

Add this protocol test to `tests/unit/ws-protocol.test.ts`:

```typescript
it("serializes and parses queue client messages", async () => {
  const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
  const message = { type: "queue_message", conversationId: "conv-1", content: "Queued follow-up" } as const;

  expect(parseClientMessage(serializeClientMessage(message))).toEqual(message);
});
```

Add this handler test to `tests/unit/ws-handler.test.ts`:

```typescript
it("creates a queued message and broadcasts queue state", async () => {
  const queuedMessage = {
    id: "queued_1",
    conversationId: "conv-1",
    content: "Queued follow-up",
    status: "pending",
    sortOrder: 1,
    failureMessage: null,
    processingStartedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const createQueuedMessage = vi.fn().mockReturnValue({
    ...queuedMessage
  });
  const listQueuedMessages = vi.fn().mockReturnValue([queuedMessage]);

  vi.doMock("@/lib/conversations", () => ({
    getConversationSnapshot: vi.fn().mockReturnValue({
      conversation: { id: "conv-1", title: "Test", isActive: true },
      messages: [],
      queuedMessages: []
    }),
    listActiveConversations: vi.fn().mockReturnValue([]),
    createQueuedMessage,
    listQueuedMessages
  }));

  const { handleConnection } = await import("@/lib/ws-handler");
  const sent: string[] = [];
  const handlers: Array<(raw: string) => void> = [];
  const ws = {
    readyState: 1,
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "message") handlers.push((raw: string) => handler(raw));
    })
  } as unknown as WebSocket;

  await handleConnection(ws, "session=valid-token");
  handlers.forEach((handler) =>
    handler(JSON.stringify({ type: "queue_message", conversationId: "conv-1", content: "Queued follow-up" }))
  );

  expect(createQueuedMessage).toHaveBeenCalledWith({
    conversationId: "conv-1",
    content: "Queued follow-up"
  });
  expect(sent.some((entry) => JSON.parse(entry).type === "queue_updated")).toBe(true);
});
```

- [ ] **Step 2: Run the websocket tests to verify they fail**

Run: `npx vitest run tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts`

Expected: FAIL because `queue_message` is not a recognized client message and the handler has no queue routing.

- [ ] **Step 3: Add queue protocol messages and initial snapshot payloads**

Update `lib/ws-protocol.ts`:

```typescript
export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string }
  | { type: "queue_message"; conversationId: string; content: string }
  | { type: "update_queued_message"; conversationId: string; queuedMessageId: string; content: string }
  | { type: "delete_queued_message"; conversationId: string; queuedMessageId: string }
  | { type: "send_queued_message_now"; conversationId: string; queuedMessageId: string }
  | { type: "stop"; conversationId: string }
  | { type: "edit"; messageId: string; content: string };

export type ServerMessage =
  | { type: "ready"; activeConversations: { id: string; title: string; status: string }[] }
  | { type: "snapshot"; conversationId: string; messages: unknown[]; queuedMessages: unknown[]; actions: unknown[]; segments: unknown[] }
  | { type: "queue_updated"; conversationId: string; queuedMessages: unknown[] }
  | { type: "delta"; conversationId: string; event: ChatStreamEvent }
  | { type: "error"; message: string };

const CLIENT_MESSAGE_TYPES = new Set([
  "subscribe",
  "unsubscribe",
  "message",
  "queue_message",
  "update_queued_message",
  "delete_queued_message",
  "send_queued_message_now",
  "stop",
  "edit"
]);
```

Update the page and API payloads so they all include `queuedMessages`:

```typescript
payload={{
  conversation,
  messages: listVisibleMessages(conversation.id),
  queuedMessages: listQueuedMessages(conversation.id),
  settings: {
    sttEngine: settings.sttEngine,
    sttLanguage: settings.sttLanguage
  },
  providerProfiles: settings.providerProfiles,
  defaultProviderProfileId: settings.defaultProviderProfileId,
  debug: getConversationDebugStats(conversation.id)
}}
```

Also update `app/api/conversations/[conversationId]/route.ts`:

```typescript
return ok({
  conversation,
  messages: listVisibleMessages(conversation.id),
  queuedMessages: listQueuedMessages(conversation.id),
  debug: getConversationDebugStats(conversation.id)
});
```

- [ ] **Step 4: Route queue websocket actions and broadcast queue updates**

Add a shared helper in `lib/ws-handler.ts`:

```typescript
function broadcastQueuedMessages(mgr: ConversationManager, conversationId: string) {
  mgr.broadcast(conversationId, {
    type: "queue_updated",
    conversationId,
    queuedMessages: listQueuedMessages(conversationId)
  });
}
```

Handle the new message types:

```typescript
case "queue_message": {
  createQueuedMessage({ conversationId: msg.conversationId, content: msg.content });
  broadcastQueuedMessages(mgr, msg.conversationId);
  void ensureQueuedDispatch({ manager: mgr, conversationId: msg.conversationId });
  break;
}
case "update_queued_message": {
  updateQueuedMessage({ conversationId: msg.conversationId, queuedMessageId: msg.queuedMessageId, content: msg.content });
  broadcastQueuedMessages(mgr, msg.conversationId);
  break;
}
case "delete_queued_message": {
  deleteQueuedMessage({ conversationId: msg.conversationId, queuedMessageId: msg.queuedMessageId });
  broadcastQueuedMessages(mgr, msg.conversationId);
  break;
}
case "send_queued_message_now": {
  moveQueuedMessageToFront({ conversationId: msg.conversationId, queuedMessageId: msg.queuedMessageId });
  requestStop(msg.conversationId);
  broadcastQueuedMessages(mgr, msg.conversationId);
  void ensureQueuedDispatch({ manager: mgr, conversationId: msg.conversationId });
  break;
}
```

Make the subscribe snapshot include `queuedMessages`.

- [ ] **Step 5: Run the websocket tests again**

Run: `npx vitest run tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/ws-protocol.ts lib/ws-handler.ts app/api/conversations/[conversationId]/route.ts app/chat/[conversationId]/page.tsx app/automations/[automationId]/runs/[runId]/page.tsx tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts
git commit -m "feat: expose queued message snapshots and ws actions"
```

---

## Task 3: Add the queue dispatcher and hook it into chat-turn lifecycle

**Files:**
- Create: `lib/queued-chat-dispatcher.ts`
- Modify: `lib/conversations.ts`
- Modify: `lib/chat-turn.ts:24-31,47-60,88-111,250-259`
- Test: `tests/unit/queued-chat-dispatcher.test.ts`
- Test: `tests/unit/chat-turn.test.ts`

- [ ] **Step 1: Write the failing dispatcher and chat-turn tests**

Create `tests/unit/queued-chat-dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("queued-chat-dispatcher", () => {
  it("claims only one queued message per conversation at a time", async () => {
    const { createConversation, createQueuedMessage, listQueuedMessages } = await import("@/lib/conversations");
    const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");

    const conversation = createConversation();
    createQueuedMessage({ conversationId: conversation.id, content: "First" });
    createQueuedMessage({ conversationId: conversation.id, content: "Second" });

    const startChatTurn = vi.fn().mockResolvedValue({ status: "completed" });
    await Promise.all([
      ensureQueuedDispatch({ manager: {} as never, conversationId: conversation.id, startChatTurn }),
      ensureQueuedDispatch({ manager: {} as never, conversationId: conversation.id, startChatTurn })
    ]);

    expect(startChatTurn).toHaveBeenCalledTimes(1);
    expect(listQueuedMessages(conversation.id).map((item) => item.content)).toEqual(["Second"]);
  });
});
```

Add this test to `tests/unit/chat-turn.test.ts`:

```typescript
it("triggers queued dispatch after a turn finalizes", async () => {
  const ensureQueuedDispatch = vi.fn().mockResolvedValue(undefined);
  vi.doMock("@/lib/queued-chat-dispatcher", () => ({ ensureQueuedDispatch }));

  const { createConversation } = await import("@/lib/conversations");
  const { createConversationManager } = await import("@/lib/conversation-manager");
  const { startChatTurn } = await import("@/lib/chat-turn");

  const manager = createConversationManager();
  const conversation = createConversation();

  await startChatTurn(manager, conversation.id, "Hello", []);

  expect(ensureQueuedDispatch).toHaveBeenCalledWith({
    manager,
    conversationId: conversation.id,
    startChatTurn
  });
});
```

- [ ] **Step 2: Run the dispatcher tests to verify they fail**

Run: `npx vitest run tests/unit/queued-chat-dispatcher.test.ts tests/unit/chat-turn.test.ts`

Expected: FAIL because the dispatcher module does not exist and `chat-turn.ts` does not trigger queue dispatch.

- [ ] **Step 3: Implement queue claiming, deletion-on-dispatch, and idle dispatch**

Create `lib/queued-chat-dispatcher.ts`:

```typescript
import { claimNextQueuedMessageForDispatch, deleteQueuedMessage, failQueuedMessage, getConversation, listQueuedMessages, markOrphanedQueuedMessagesFailed } from "@/lib/conversations";
import type { ConversationManager } from "@/lib/conversation-manager";
import type { StartChatTurn } from "@/lib/chat-turn";

const dispatchLocks = new Set<string>();

export async function ensureQueuedDispatch(input: {
  manager: ConversationManager;
  conversationId: string;
  startChatTurn: StartChatTurn;
}) {
  if (dispatchLocks.has(input.conversationId)) {
    return;
  }

  const conversation = getConversation(input.conversationId);
  if (!conversation || conversation.isActive) {
    return;
  }

  dispatchLocks.add(input.conversationId);

  try {
    markOrphanedQueuedMessagesFailed(input.conversationId);
    const queued = claimNextQueuedMessageForDispatch(input.conversationId);
    if (!queued) {
      return;
    }

    const result = await input.startChatTurn(
      input.manager,
      input.conversationId,
      queued.content,
      [],
      undefined,
      {
        onMessagesCreated() {
          deleteQueuedMessage({ conversationId: input.conversationId, queuedMessageId: queued.id });
        },
        source: "queue"
      }
    );

    if (result.status === "failed" || result.status === "skipped") {
      failQueuedMessage({
        conversationId: input.conversationId,
        queuedMessageId: queued.id,
        failureMessage: result.errorMessage ?? "Unable to dispatch queued follow-up"
      });
    }
  } finally {
    dispatchLocks.delete(input.conversationId);
  }
}
```

Extend `startChatTurn` in `lib/chat-turn.ts` so it accepts an optional fifth parameter:

```typescript
export type StartChatTurn = (
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string,
  options?: {
    source?: "live" | "queue";
    onMessagesCreated?: (payload: { userMessageId: string; assistantMessageId: string }) => void;
  }
) => Promise<ChatTurnResult>;
```

Call the hook immediately after creating the real user/assistant messages:

```typescript
options?.onMessagesCreated?.({
  userMessageId: userMessage.id,
  assistantMessageId: assistantMessage.id
});
```

In the `finally` block, trigger the dispatcher:

```typescript
const { ensureQueuedDispatch } = await import("@/lib/queued-chat-dispatcher");
await ensureQueuedDispatch({
  manager,
  conversationId,
  startChatTurn
});
```

- [ ] **Step 4: Run the dispatcher and chat-turn tests again**

Run: `npx vitest run tests/unit/queued-chat-dispatcher.test.ts tests/unit/chat-turn.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/queued-chat-dispatcher.ts lib/chat-turn.ts lib/conversations.ts tests/unit/queued-chat-dispatcher.test.ts tests/unit/chat-turn.test.ts
git commit -m "feat: dispatch queued follow-ups through chat turn lifecycle"
```

---

## Task 4: Build the banner stack UI and branch composer submits into queue creation

**Files:**
- Create: `components/queued-message-banner.tsx`
- Modify: `components/chat-view.tsx:32-43,268-281,656-724,915-951,1310-1560`
- Modify: `components/chat-composer.tsx:29-59,223-234,318-340`
- Test: `tests/unit/queued-message-banner.test.tsx`
- Test: `tests/unit/chat-view.test.ts`

- [ ] **Step 1: Write the failing UI tests**

Create `tests/unit/queued-message-banner.test.tsx`:

```typescript
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueuedMessageBanner } from "@/components/queued-message-banner";

describe("queued-message-banner", () => {
  it("renders pending items and exposes edit/delete/send-now actions", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onSendNow = vi.fn();

    render(
      <QueuedMessageBanner
        items={[
          {
            id: "queued_1",
            conversationId: "conv_1",
            content: "Queued follow-up",
            status: "pending",
            sortOrder: 1,
            failureMessage: null,
            processingStartedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ]}
        onEdit={onEdit}
        onDelete={onDelete}
        onSendNow={onSendNow}
      />
    );

    expect(screen.getByText("Queued follow-up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send queued follow-up now" }));
    expect(onSendNow).toHaveBeenCalledWith("queued_1");
  });
});
```

Add these tests to `tests/unit/chat-view.test.ts`:

```typescript
it("queues a message instead of sending immediately when a turn is active", async () => {
  renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

  await act(async () => {
    wsMock.onMessage?.({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant_1" }
    });
  });

  fireEvent.change(screen.getByPlaceholderText("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."), {
    target: { value: "Queue this follow-up" }
  });
  fireEvent.keyDown(screen.getByPlaceholderText("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break..."), {
    key: "Enter"
  });

  await waitFor(() => {
    expect(wsMock.send).toHaveBeenCalledWith({
      type: "queue_message",
      conversationId: "conv_1",
      content: "Queue this follow-up"
    });
  });
});

it("hydrates queued messages from websocket snapshots", async () => {
  renderWithProvider(React.createElement(ChatView, {
    payload: createPayload({
      queuedMessages: []
    })
  }));

  wsMock.onMessage?.({
    type: "queue_updated",
    conversationId: "conv_1",
    queuedMessages: [
      {
        id: "queued_1",
        conversationId: "conv_1",
        content: "Queued follow-up",
        status: "pending",
        sortOrder: 1,
        failureMessage: null,
        processingStartedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]
  });

  expect(screen.getByText("Queued follow-up")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the UI tests to verify they fail**

Run: `npx vitest run tests/unit/queued-message-banner.test.tsx tests/unit/chat-view.test.ts`

Expected: FAIL because the banner component does not exist and `ChatView` only sends immediate websocket messages.

- [ ] **Step 3: Implement the queue banner component**

Create `components/queued-message-banner.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { Pencil, Play, Trash2 } from "lucide-react";
import type { QueuedMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

export function QueuedMessageBanner(input: {
  items: QueuedMessage[];
  onEdit: (queuedMessageId: string, content: string) => void | Promise<void>;
  onDelete: (queuedMessageId: string) => void | Promise<void>;
  onSendNow: (queuedMessageId: string) => void | Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!input.items.length) {
    return null;
  }

  return (
    <div className="rounded-[22px] border border-white/10 bg-zinc-950/88 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
          Queued follow-ups · {input.items.length}
        </div>
      </div>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {input.items.map((item, index) => {
          const editable = item.status === "pending";
          const isEditing = editingId === item.id;
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-2xl border px-3 py-3",
                index === 0 ? "border-white/16 bg-white/8" : "border-white/8 bg-white/[0.04]"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
                  {index === 0 ? "Next" : `Then ${index + 1}`}
                </div>
                <div className="text-[11px] text-white/40">{item.status}</div>
              </div>
              {isEditing ? (
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  className="min-h-[72px] w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
                />
              ) : (
                <div className="text-sm text-white/88">{item.content}</div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                {editable && isEditing ? (
                  <button type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-zinc-950" onClick={() => { void input.onEdit(item.id, draft); setEditingId(null); }}>
                    Save
                  </button>
                ) : null}
                {editable && !isEditing ? (
                  <button type="button" aria-label="Edit queued follow-up" className="rounded-full border border-white/10 p-2 text-white/70" onClick={() => { setEditingId(item.id); setDraft(item.content); }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {editable ? (
                  <button type="button" aria-label="Delete queued follow-up" className="rounded-full border border-white/10 p-2 text-white/70" onClick={() => void input.onDelete(item.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {editable ? (
                  <button type="button" aria-label="Send queued follow-up now" className="rounded-full bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-zinc-950" onClick={() => void input.onSendNow(item.id)}>
                    <Play className="mr-1 inline h-3.5 w-3.5" />
                    Send now
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Branch `ChatView` submit logic into live-send vs queue-send and render the banner**

Update the payload and state setup in `components/chat-view.tsx`:

```tsx
type ConversationPayload = {
  conversation: Conversation;
  messages: Message[];
  queuedMessages: QueuedMessage[];
  settings: Pick<AppSettings, "sttEngine" | "sttLanguage">;
  providerProfiles: ProviderProfileSummary[];
  defaultProviderProfileId: string | null;
  debug: { rawTurnCount: number; memoryNodeCount: number; latestCompactionAt: string | null };
};

const [queuedMessages, setQueuedMessages] = useState(payload.queuedMessages);
```

Handle queue snapshot updates:

```tsx
case "snapshot":
  setQueuedMessages(msg.queuedMessages as QueuedMessage[]);
  setMessages((current) => reconcileSnapshotMessages(current, msg.messages as Message[], streamMessageId));
  break;
case "queue_updated":
  setQueuedMessages(msg.queuedMessages as QueuedMessage[]);
  break;
```

Branch submit behavior:

```tsx
const hasActiveTurn = Boolean(streamMessageIdRef.current) || payload.conversation.isActive;

if (hasActiveTurn) {
  setError("");
  setInput("");
  setQueuedMessages((current) => [
    ...current,
    {
      id: `local_queue_${Date.now()}`,
      conversationId: payload.conversation.id,
      content: value,
      status: "pending",
      sortOrder: current.length + 1,
      failureMessage: null,
      processingStartedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);
  wsSend({
    type: "queue_message",
    conversationId: payload.conversation.id,
    content: value
  });
  return;
}
```

Wire the banner above the composer:

```tsx
<div className="fixed inset-x-0 bottom-0 z-10 pointer-events-none">
  <div className="mx-auto w-full max-w-[980px] px-4 md:px-8 pointer-events-auto">
    <div className="mb-3">
      <QueuedMessageBanner
        items={queuedMessages}
        onEdit={(queuedMessageId, content) => wsSend({ type: "update_queued_message", conversationId: payload.conversation.id, queuedMessageId, content })}
        onDelete={(queuedMessageId) => wsSend({ type: "delete_queued_message", conversationId: payload.conversation.id, queuedMessageId })}
        onSendNow={(queuedMessageId) => wsSend({ type: "send_queued_message_now", conversationId: payload.conversation.id, queuedMessageId })}
      />
    </div>
    <ChatComposer /* existing props */ />
  </div>
</div>
```

Leave attachments composer-local while queueing: do not include `attachmentIds` in queue messages and do not clear `pendingAttachments` inside the queue branch.

- [ ] **Step 5: Run the UI tests again**

Run: `npx vitest run tests/unit/queued-message-banner.test.tsx tests/unit/chat-view.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/queued-message-banner.tsx components/chat-view.tsx components/chat-composer.tsx tests/unit/queued-message-banner.test.tsx tests/unit/chat-view.test.ts
git commit -m "feat: add queued follow-up banner and chat view flow"
```

---

## Task 5: Add end-to-end coverage and run full verification

**Files:**
- Modify: `tests/e2e/features.spec.ts`
- Verify: full test, typecheck, lint, and browser validation

- [ ] **Step 1: Write the failing end-to-end spec**

Add this Playwright scenario to `tests/e2e/features.spec.ts`:

```typescript
test("queues follow-ups during streaming and sends a selected item next", async ({ page }) => {
  let requestCount = 0;

  await page.route("**/api/conversations/*/chat", async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"type":"message_start","messageId":"msg_assistant"}',
        'data: {"type":"answer_delta","text":"Working..."}',
        'data: {"type":"done","messageId":"msg_assistant"}'
      ].join("\\n\\n")
    });
  });

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).toHaveURL(/\\/chat\\//);

  await page.getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...").fill("Initial question");
  await page.keyboard.press("Enter");

  await page.getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...").fill("Queued follow-up one");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Queued follow-up one")).toBeVisible();
  await page.getByRole("button", { name: "Send queued follow-up now" }).click();

  await expect.poll(() => requestCount).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run the e2e spec to verify it fails**

Run: `npm run test:e2e -- tests/e2e/features.spec.ts`

Expected: FAIL because the queue banner and queue actions do not exist yet.

- [ ] **Step 3: Run the targeted unit tests, then the full verification suite**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts tests/unit/ws-protocol.test.ts tests/unit/ws-handler.test.ts tests/unit/queued-chat-dispatcher.test.ts tests/unit/chat-turn.test.ts tests/unit/queued-message-banner.test.tsx tests/unit/chat-view.test.ts
npm run lint
npm run typecheck
npm test
npm run test:e2e -- tests/e2e/features.spec.ts
```

Expected:

- all targeted queue-related unit suites PASS
- `npm run lint` exits 0
- `npm run typecheck` exits 0
- `npm test` exits 0 with coverage still meeting the repo threshold
- the Playwright scenario PASSes

- [ ] **Step 4: Validate the UI in the browser**

1. Check for `.dev-server` in the repo root. If it exists, use its URL; if the server is dead, delete the file and start fresh with `npm run dev`.
2. Open the chat page with the `agent-browser` skill.
3. Start a message, queue two follow-ups, edit one, delete one, and use `Send now`.
4. Refresh the page and confirm the queue banner persists.
5. Capture a screenshot of the banner stack above the composer.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/features.spec.ts
git commit -m "test: cover queued chat follow-ups"
```
