# Edit Chat Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user edit one of their own previous chat messages in place, delete every later turn in the same conversation, and regenerate the assistant response from that exact point without creating a new conversation.

**Architecture:** The server owns history rewrite semantics through a new transactional helper in `lib/conversations.ts` plus a dedicated `POST /api/messages/[messageId]/edit-restart` route. After the rewrite, the route starts an assistant-only continuation from the existing edited user message by extracting the assistant half of `startChatTurn` into a reusable helper, so the websocket stream resumes without creating a duplicate user turn or rebinding attachments away from the edited bubble.

**Tech Stack:** Next.js App Router, React 19, TypeScript, better-sqlite3, Vitest, Testing Library, websocket conversation streaming

---

## File Map

### Existing files to modify

- `lib/conversations.ts`
  Add a transactional helper that rewrites the selected user message, deletes the transcript tail, clears invalid compaction artifacts, and returns the retained conversation snapshot.
- `lib/chat-turn.ts`
  Extract a reusable assistant-only continuation helper that starts streaming from an existing retained user message.
- `components/chat-view.tsx`
  Replace the current user-message patch save flow with edit-and-restart behavior, reset local streaming state, trim later messages, and block concurrent sends while the restart request is running.
- `components/message-bubble.tsx`
  Keep the inline editor UI, but route save through a restart callback for user messages while leaving assistant bubbles immutable.
- `tests/unit/conversations.test.ts`
  Add data-layer regression coverage for in-place rewrite, tail deletion, attachment preservation, and compaction cleanup.
- `tests/unit/chat-turn.test.ts`
  Add coverage for assistant continuation from an existing edited user message without creating a duplicate user row.
- `tests/unit/chat-view.test.ts`
  Add restart interaction coverage for older-message edits, error handling, and assistant immutability.
- `tests/unit/message-bubble.test.tsx`
  Add rendering coverage for user edit controls and absence of assistant edit controls.

### New files to create

- `app/api/messages/[messageId]/edit-restart/route.ts`
  Authenticated route that validates ownership and user role, rejects active turns, rewrites persisted history, then starts the new assistant turn from the existing edited message.
- `tests/unit/message-edit-restart-route.test.ts`
  Route coverage for success, assistant-message rejection, missing-message rejection, and active-turn conflict behavior.

### Existing files to reference while implementing

- `app/api/messages/[messageId]/route.ts`
  Existing message patch route pattern and zod validation style.
- `lib/chat-turn.ts`
  Existing `startChatTurn` implementation whose assistant-side logic will be extracted and reused by the new route.
- `lib/ws-singleton.ts`
  Source of the shared conversation manager used by the new route.
- `tests/unit/ws-handler.test.ts`
  Existing websocket tests showing how conversation activity is exercised in unit tests.

---

### Task 1: Add failing data-layer tests for transcript rewrite

**Files:**
- Modify: `tests/unit/conversations.test.ts`
- Modify: `lib/conversations.ts`
- Reference: `lib/compaction.ts`

- [ ] **Step 1: Write the failing data-layer tests**

Add these tests near the other `conversation helpers` cases in `tests/unit/conversations.test.ts`:

```ts
import {
  bindAttachmentsToMessage,
  createConversation,
  createMessage,
  getConversationSnapshot,
  rewriteConversationFromEditedUserMessage
} from "@/lib/conversations";
import { createAttachments } from "@/lib/attachments";
import { getDb } from "@/lib/db";

it("rewrites a user message, deletes later turns, and preserves the edited message attachment", () => {
  const conversation = createConversation("Rewrite target");
  const firstUser = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Original prompt"
  });
  const firstAssistant = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "First answer"
  });
  const editedUser = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Need a deployment checklist"
  });
  const trailingAssistant = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "Old checklist"
  });

  const [attachment] = createAttachments(conversation.id, [
    {
      filename: "context.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("retain this attachment", "utf8")
    }
  ]);
  bindAttachmentsToMessage(conversation.id, editedUser.id, [attachment.id]);

  const rewritten = rewriteConversationFromEditedUserMessage(editedUser.id, {
    content: "Need a deployment checklist with rollback steps"
  });

  expect(rewritten.messages.map((message) => message.content)).toEqual([
    "Original prompt",
    "First answer",
    "Need a deployment checklist with rollback steps"
  ]);
  expect(rewritten.messages.at(-1)?.attachments?.map((item) => item.filename)).toEqual([
    "context.txt"
  ]);
  expect(
    rewritten.messages.some((message) => message.id === trailingAssistant.id)
  ).toBe(false);
  expect(getConversationSnapshot(conversation.id)?.messages).toHaveLength(3);
});

it("removes compaction artifacts that depend on deleted tail messages", () => {
  const conversation = createConversation("Compaction cleanup");
  const firstUser = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: "First request"
  });
  const editedUser = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Second request"
  });
  const tailAssistant = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "Later answer"
  });

  const db = getDb();
  db.prepare(
    `INSERT INTO memory_nodes (
      id, conversation_id, type, depth, content,
      source_start_message_id, source_end_message_id,
      source_token_count, summary_token_count, child_node_ids,
      superseded_by_node_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "mem_tail",
    conversation.id,
    "leaf_summary",
    0,
    "Summary reaching into deleted history",
    firstUser.id,
    tailAssistant.id,
    90,
    20,
    "[]",
    null,
    new Date().toISOString()
  );

  db.prepare(
    `INSERT INTO compaction_events (
      id, conversation_id, node_id, source_start_message_id,
      source_end_message_id, notice_message_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "cmp_tail",
    conversation.id,
    "mem_tail",
    firstUser.id,
    tailAssistant.id,
    null,
    new Date().toISOString()
  );

  rewriteConversationFromEditedUserMessage(editedUser.id, {
    content: "Edited second request"
  });

  expect(
    db.prepare("SELECT COUNT(*) as count FROM memory_nodes WHERE conversation_id = ?").get(conversation.id)
  ).toEqual({ count: 0 });
  expect(
    db.prepare("SELECT COUNT(*) as count FROM compaction_events WHERE conversation_id = ?").get(conversation.id)
  ).toEqual({ count: 0 });
});

it("rejects rewriting a non-user message", () => {
  const conversation = createConversation("Assistant immutable");
  const assistant = createMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "Cannot edit me"
  });

  expect(() =>
    rewriteConversationFromEditedUserMessage(assistant.id, { content: "changed" })
  ).toThrow("Only user messages can be edited");
});
```

- [ ] **Step 2: Run the targeted data-layer tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: FAIL with `rewriteConversationFromEditedUserMessage` missing.

- [ ] **Step 3: Write the minimal transactional rewrite helper**

Add this implementation shape in `lib/conversations.ts` near `forkConversationFromMessage`:

```ts
export function rewriteConversationFromEditedUserMessage(
  messageId: string,
  input: { content: string },
  userId?: string
) {
  const transaction = getDb().transaction(() => {
    const message = getMessage(messageId, userId);

    if (!message) {
      throw new Error("Message not found");
    }

    if (message.role !== "user") {
      throw new Error("Only user messages can be edited");
    }

    const conversation = getConversation(message.conversationId, userId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const messages = listMessages(conversation.id);
    const targetIndex = messages.findIndex((item) => item.id === message.id);
    if (targetIndex === -1) {
      throw new Error("Message not found");
    }

    const retainedMessages = messages.slice(0, targetIndex + 1);
    const deletedMessages = messages.slice(targetIndex + 1);
    const deletedIds = new Set(deletedMessages.map((item) => item.id));

    updateMessage(message.id, {
      content: input.content,
      estimatedTokens: estimateTextTokens(input.content)
    });

    if (deletedMessages.length > 0) {
      const deleteMessage = getDb().prepare("DELETE FROM messages WHERE id = ?");
      deletedMessages.forEach((item) => deleteMessage.run(item.id));
    }

    getDb()
      .prepare(
        `DELETE FROM compaction_events
         WHERE conversation_id = ?
           AND (source_start_message_id IN (${Array.from(deletedIds).map(() => "?").join(", ")})
             OR source_end_message_id IN (${Array.from(deletedIds).map(() => "?").join(", ")}))`
      )
      .run(conversation.id, ...deletedIds, ...deletedIds);

    getDb()
      .prepare(
        `DELETE FROM memory_nodes
         WHERE conversation_id = ?
           AND (source_start_message_id IN (${Array.from(deletedIds).map(() => "?").join(", ")})
             OR source_end_message_id IN (${Array.from(deletedIds).map(() => "?").join(", ")}))`
      )
      .run(conversation.id, ...deletedIds, ...deletedIds);

    setConversationActive(conversation.id, false);

    return getConversationSnapshot(conversation.id, userId);
  });

  const snapshot = transaction();
  if (!snapshot) {
    throw new Error("Conversation not found");
  }
  return snapshot;
}
```

- [ ] **Step 4: Run the data-layer tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the data-layer rewrite helper**

```bash
git add lib/conversations.ts tests/unit/conversations.test.ts
git commit -m "feat: add edit restart conversation rewrite"
```

---

### Task 2: Add failing assistant-restart tests and implement the edit-restart backend

**Files:**
- Create: `tests/unit/message-edit-restart-route.test.ts`
- Create: `app/api/messages/[messageId]/edit-restart/route.ts`
- Modify: `tests/unit/chat-turn.test.ts`
- Modify: `lib/chat-turn.ts`
- Reference: `lib/chat-turn.ts`
- Reference: `lib/ws-singleton.ts`

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/message-edit-restart-route.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createConversation, createMessage, setConversationActive } from "@/lib/conversations";
import { createLocalUser } from "@/lib/users";

const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

const { startAssistantTurnFromExistingUserMessageMock } = vi.hoisted(() => ({
  startAssistantTurnFromExistingUserMessageMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

vi.mock("@/lib/chat-turn", () => ({
  startAssistantTurnFromExistingUserMessage: startAssistantTurnFromExistingUserMessageMock
}));

describe("message edit restart route", () => {
  beforeEach(() => {
    requireUserMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockReset();
    startAssistantTurnFromExistingUserMessageMock.mockResolvedValue({ status: "completed" });
  });

  it("rewrites the message and starts a new assistant turn", async () => {
    const user = await createLocalUser({
      username: "edit-route-user",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Restart me", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Old content"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "New content" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(200);
    expect(startAssistantTurnFromExistingUserMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      conversation.id,
      message.id,
      undefined
    );
  });

  it("rejects assistant messages", async () => {
    const user = await createLocalUser({
      username: "edit-route-assistant",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("No assistant edits", null, {}, user.id);
    const assistant = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "Immutable"
    });

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${assistant.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Changed" })
      }),
      { params: Promise.resolve({ messageId: assistant.id }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Only user messages can be edited" });
  });

  it("rejects active conversations with 409", async () => {
    const user = await createLocalUser({
      username: "edit-route-active",
      password: "Password123!",
      role: "user"
    });
    requireUserMock.mockResolvedValue(user);

    const conversation = createConversation("Busy conversation", null, {}, user.id);
    const message = createMessage({
      conversationId: conversation.id,
      role: "user",
      content: "Retry this"
    });
    setConversationActive(conversation.id, true);

    const { POST } = await import("@/app/api/messages/[messageId]/edit-restart/route");
    const response = await POST(
      new Request(`http://localhost/api/messages/${message.id}/edit-restart`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Retry this with edits" })
      }),
      { params: Promise.resolve({ messageId: message.id }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Wait for the current assistant response to finish before editing this conversation"
    });
  });
});
```

- [ ] **Step 2: Add the failing assistant-only chat-turn test**

Append this case to `tests/unit/chat-turn.test.ts`:

```ts
it("continues from an existing user message without creating a duplicate user row", async () => {
  const { createConversation, createMessage, listVisibleMessages } = await import("@/lib/conversations");
  const { startAssistantTurnFromExistingUserMessage } = await import("@/lib/chat-turn");
  const { getConversationManager } = await import("@/lib/ws-singleton");

  const conversation = createConversation("Restart conversation");
  const existingUser = createMessage({
    conversationId: conversation.id,
    role: "user",
    content: "Edited prompt"
  });

  await startAssistantTurnFromExistingUserMessage(
    getConversationManager(),
    conversation.id,
    existingUser.id
  );

  const messages = listVisibleMessages(conversation.id);
  expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(messages[0]?.id).toBe(existingUser.id);
  expect(messages.at(-1)?.role).toBe("assistant");
});
```

- [ ] **Step 3: Run the route and chat-turn tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/chat-turn.test.ts tests/unit/message-edit-restart-route.test.ts
```

Expected: FAIL because the route file and assistant-only helper do not exist.

- [ ] **Step 4: Extract assistant-only continuation from `lib/chat-turn.ts`**

Refactor `lib/chat-turn.ts` so `startChatTurn` becomes a thin wrapper around a shared helper:

```ts
async function startAssistantTurn(
  manager: ConversationManager,
  conversationId: string,
  existingUserMessage: Message,
  personaId?: string
): Promise<ChatTurnResult> {
  const conversation = getConversation(conversationId);
  if (!conversation) {
    return { status: "skipped", errorMessage: "Conversation not found" };
  }

  const conversationOwnerId = getConversationOwnerId(conversationId);
  const assistantMessage = createMessage({
    conversationId,
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "streaming",
    estimatedTokens: 0
  });

  manager.broadcast(conversationId, {
    type: "delta",
    conversationId,
    event: { type: "message_start", messageId: assistantMessage.id }
  });

  // Reuse the rest of the existing assistant streaming body unchanged.
}

export async function startAssistantTurnFromExistingUserMessage(
  manager: ConversationManager,
  conversationId: string,
  messageId: string,
  personaId?: string
) {
  const message = getMessage(messageId);
  if (!message || message.role !== "user" || message.conversationId !== conversationId) {
    return { status: "skipped", errorMessage: "User message not found" };
  }

  return startAssistantTurn(manager, conversationId, message, personaId);
}

export async function startChatTurn(
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[],
  personaId?: string
) {
  const userMessage = createMessage({
    conversationId,
    role: "user",
    content,
    estimatedTokens: estimateTextTokens(content)
  });

  bindAttachmentsToMessage(conversationId, userMessage.id, attachmentIds);
  void generateConversationTitleFromFirstUserMessage(conversationId, userMessage.id);

  return startAssistantTurn(manager, conversationId, userMessage, personaId);
}
```

- [ ] **Step 5: Implement the route using the assistant-only helper**

Create `app/api/messages/[messageId]/edit-restart/route.ts`:

```ts
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { startAssistantTurnFromExistingUserMessage } from "@/lib/chat-turn";
import { getConversationSnapshot, getMessage, rewriteConversationFromEditedUserMessage } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";
import { getConversationManager } from "@/lib/ws-singleton";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

const bodySchema = z.object({
  content: z.string().trim().min(1)
});

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return badRequest("Invalid message id");
  }

  const body = bodySchema.safeParse(await request.json());
  if (!body.success) {
    return badRequest("Invalid message update");
  }

  const message = getMessage(params.data.messageId, user.id);
  if (!message) {
    return badRequest("Message not found", 404);
  }
  if (message.role !== "user") {
    return badRequest("Only user messages can be edited", 400);
  }

  const snapshot = getConversationSnapshot(message.conversationId, user.id);
  if (!snapshot) {
    return badRequest("Conversation not found", 404);
  }
  if (snapshot.conversation.isActive) {
    return badRequest(
      "Wait for the current assistant response to finish before editing this conversation",
      409
    );
  }

  const rewritten = rewriteConversationFromEditedUserMessage(message.id, {
    content: body.data.content
  }, user.id);

  await startAssistantTurnFromExistingUserMessage(
    getConversationManager(),
    rewritten.conversation.id,
    message.id,
    undefined
  );

  return ok(rewritten);
}
```

- [ ] **Step 6: Run the chat-turn and route tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/chat-turn.test.ts tests/unit/message-edit-restart-route.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit the assistant-only restart backend**

```bash
git add \
  app/api/messages/[messageId]/edit-restart/route.ts \
  lib/chat-turn.ts \
  tests/unit/chat-turn.test.ts \
  tests/unit/message-edit-restart-route.test.ts
git commit -m "feat: add assistant restart backend"
```

---

### Task 3: Add failing UI tests and wire the user-bubble edit restart flow

**Files:**
- Modify: `tests/unit/message-bubble.test.tsx`
- Modify: `tests/unit/chat-view.test.ts`
- Modify: `components/message-bubble.tsx`
- Modify: `components/chat-view.tsx`

- [ ] **Step 1: Add the user-bubble rendering test**

Append this test to `tests/unit/message-bubble.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";

function createUserMessage(): Message {
  return {
    id: "msg_user",
    conversationId: "conv_test",
    role: "user",
    content: "Editable prompt",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0,
    systemKind: null,
    compactedAt: null,
    createdAt: new Date().toISOString(),
    attachments: [],
    actions: []
  };
}

it("shows edit controls for user messages and not for assistant messages", () => {
  const { rerender } = render(
    React.createElement(MessageBubble, {
      message: createUserMessage()
    })
  );

  expect(screen.getByRole("button", { name: "Edit message" })).toBeInTheDocument();

  rerender(
    React.createElement(MessageBubble, {
      message: createAssistantMessage()
    })
  );

  expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
});
```

- [ ] **Step 2: Add the failing chat view interaction tests**

Append these tests to `tests/unit/chat-view.test.ts`:

```ts
it("restarts the conversation when saving an older edited user message", async () => {
  const olderUser = createMessage({
    id: "msg_user_old",
    role: "user",
    content: "Old request"
  });
  const olderAssistant = createMessage({
    id: "msg_assistant_old",
    role: "assistant",
    content: "Old answer"
  });
  const laterUser = createMessage({
    id: "msg_user_later",
    role: "user",
    content: "Later request"
  });

  vi.mocked(global.fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ personas: [] })
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: createPayload().conversation,
        messages: [olderUser, olderAssistant, { ...olderUser, content: "Edited request" }]
      })
    } as Response);

  renderWithProvider(
    React.createElement(ChatView, {
      payload: createPayload({
        messages: [olderUser, olderAssistant, laterUser]
      })
    })
  );

  fireEvent.click(screen.getAllByRole("button", { name: "Edit message" })[0]);
  fireEvent.change(screen.getByDisplayValue("Old request"), {
    target: { value: "Edited request" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save edit" }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/messages/msg_user_old/edit-restart",
      expect.objectContaining({ method: "POST" })
    );
  });
});

it("keeps assistant messages immutable in the transcript controls", () => {
  renderWithProvider(
    React.createElement(ChatView, {
      payload: createPayload({
        messages: [
          createMessage({ id: "msg_user", role: "user", content: "User prompt" }),
          createMessage({ id: "msg_assistant", role: "assistant", content: "Assistant answer" })
        ]
      })
    })
  );

  expect(screen.getAllByRole("button", { name: "Edit message" })).toHaveLength(1);
});
```

- [ ] **Step 3: Run the UI tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.tsx tests/unit/chat-view.test.ts
```

Expected: FAIL because `ChatView` still calls `PATCH /api/messages/:id` and does not know about `/edit-restart`.

- [ ] **Step 4: Replace the save callback with edit-and-restart behavior**

In `components/chat-view.tsx`, replace the current `updateUserMessage` flow with a restart-aware handler:

```ts
const [editingRestartMessageId, setEditingRestartMessageId] = useState<string | null>(null);

async function restartFromEditedUserMessage(messageId: string, content: string) {
  const previousMessages = messages;
  const targetIndex = previousMessages.findIndex((message) => message.id === messageId);
  if (targetIndex === -1) {
    return;
  }

  setError("");
  setEditingRestartMessageId(messageId);
  setIsSending(true);
  setStreamMessageId(null);
  updateStreamTimeline([]);
  setStreamThinkingTarget("");
  setStreamThinkingDisplay("");
  setStreamAnswerTarget("");
  setStreamAnswerDisplay("");

  try {
    const response = await fetch(`/api/messages/${messageId}/edit-restart`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      const failure = (await response.json()) as { error?: string };
      throw new Error(failure.error ?? "Unable to restart conversation from edited message");
    }

    const result = (await response.json()) as {
      conversation: Conversation;
      messages: Message[];
    };

    setMessages(result.messages);
    setConversationTitle(result.conversation.title);
  } catch (caughtError) {
    setMessages(previousMessages);
    setError(
      caughtError instanceof Error
        ? caughtError.message
        : "Unable to restart conversation from edited message"
    );
    throw caughtError;
  } finally {
    setEditingRestartMessageId((current) => (current === messageId ? null : current));
    setIsSending(false);
  }
}
```

Update the render call so user bubbles use the new callback and pending state:

```tsx
<MessageBubble
  message={message}
  onUpdateUserMessage={restartFromEditedUserMessage}
  isUpdating={editingRestartMessageId === message.id}
  onForkAssistantMessage={forkAssistantMessage}
  isForking={forkingMessageId === message.id}
  onApproveMemoryProposal={approveMemoryProposal}
  onDismissMemoryProposal={dismissMemoryProposal}
/>
```

Keep `components/message-bubble.tsx` functionally the same for user bubbles, but make sure only the user branch renders the pencil icon and save path. Do not add any assistant edit affordance.

- [ ] **Step 5: Run the UI tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.tsx tests/unit/chat-view.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the UI restart flow**

```bash
git add components/chat-view.tsx components/message-bubble.tsx tests/unit/chat-view.test.ts tests/unit/message-bubble.test.tsx
git commit -m "feat: restart chat from edited user message"
```

---

### Task 4: Full verification, coverage, and browser validation

**Files:**
- Verify: `app/api/messages/[messageId]/edit-restart/route.ts`
- Verify: `components/chat-view.tsx`
- Verify: `components/message-bubble.tsx`
- Verify: `lib/chat-turn.ts`
- Verify: `tests/unit/conversations.test.ts`
- Verify: `tests/unit/chat-turn.test.ts`
- Verify: `tests/unit/message-edit-restart-route.test.ts`
- Verify: `tests/unit/chat-view.test.ts`
- Verify: `tests/unit/message-bubble.test.tsx`

- [ ] **Step 1: Run the focused feature tests**

Run:

```bash
npx vitest run \
  tests/unit/conversations.test.ts \
  tests/unit/chat-turn.test.ts \
  tests/unit/message-edit-restart-route.test.ts \
  tests/unit/chat-view.test.ts \
  tests/unit/message-bubble.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run lint and typecheck**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both exit 0

- [ ] **Step 3: Run the full test suite with coverage**

Run:

```bash
npm test
```

Expected: PASS with coverage report emitted and no global coverage regression

- [ ] **Step 4: Validate the UI in the browser with the required skill**

Use `agent-browser` after starting or reusing the dev server from `.dev-server`:

```bash
if [ -f .dev-server ]; then
  cat .dev-server
else
  npm run dev
fi
```

Then validate:

```bash
agent-browser open http://localhost:<port>/chat/<conversationId>
agent-browser wait --load networkidle
agent-browser snapshot -i
agent-browser screenshot --full
```

Manual checks:

- A user bubble shows the pen icon under the bubble
- An assistant bubble does not show a pen icon
- Editing an older user message removes later turns after save
- The regenerated assistant reply streams back into the same conversation

- [ ] **Step 5: Commit the verified feature**

```bash
git add app/api/messages/[messageId]/edit-restart/route.ts \
  components/chat-view.tsx \
  components/message-bubble.tsx \
  lib/chat-turn.ts \
  lib/conversations.ts \
  tests/unit/conversations.test.ts \
  tests/unit/chat-turn.test.ts \
  tests/unit/message-edit-restart-route.test.ts \
  tests/unit/chat-view.test.ts \
  tests/unit/message-bubble.test.tsx
git commit -m "feat: add edit and restart chat flow"
```
