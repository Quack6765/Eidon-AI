# Branching / Fork Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an assistant-message fork action that creates a new conversation containing the exact persisted thread prefix through the selected assistant message and redirects the user into the new conversation.

**Architecture:** The server owns forking semantics through a new message-scoped API endpoint backed by a transactional cloning helper in `lib/conversations.ts`. The client adds a fork control next to the assistant copy action and delegates request, error handling, and navigation to `ChatView`, keeping the UI thin and the copy logic centralized.

**Tech Stack:** Next.js App Router, React 19, TypeScript, better-sqlite3, Vitest, Testing Library

---

## File Map

### Existing files to modify

- `lib/conversations.ts`
  Add a transactional `forkConversationFromMessage` helper plus small internal helpers for prefix lookup, row remapping, and compaction eligibility.
- `components/message-bubble.tsx`
  Extend the assistant action row UI to render a fork button next to copy and accept an optional callback for assistant message fork actions.
- `components/chat-view.tsx`
  Own the fork request lifecycle, local loading/error state, and `router.push()` success navigation.
- `tests/unit/conversations.test.ts`
  Add data-layer coverage for prefix cloning, ID remapping, attachment preservation, and compaction filtering.
- `tests/unit/message-bubble.test.ts`
  Add rendering coverage for the fork affordance on assistant messages only.
- `tests/unit/chat-view.test.ts`
  Add interaction coverage for request dispatch, redirect, and failure behavior.

### New files to create

- `app/api/messages/[messageId]/fork/route.ts`
  Message-scoped POST endpoint for authenticated assistant-message forking.

### Existing files to reference while implementing

- `app/api/messages/[messageId]/route.ts`
  Existing message-scoped route style and validation shape.
- `app/chat/[conversationId]/page.tsx`
  Existing chat page load path after redirect.
- `tests/setup.ts`
  Shared unit test environment setup if additional browser APIs need stubbing.

---

### Task 1: Add failing data-layer tests for transactional prefix cloning

**Files:**
- Modify: `tests/unit/conversations.test.ts`
- Modify: `lib/conversations.ts`
- Reference: `tests/unit/attachments.test.ts`

- [ ] **Step 1: Write the failing data-layer tests**

Add the following tests near the other `conversation helpers` cases in `tests/unit/conversations.test.ts`:

```ts
import {
  createConversation,
  createMessage,
  createMessageAction,
  createMessageTextSegment,
  createConversationAttachment,
  createCompactionEvent,
  createMemoryNode,
  forkConversationFromMessage,
  getConversation,
  listMessages,
  listVisibleMessages
} from "@/lib/conversations";

it("forks a conversation through the selected assistant message and remaps related rows", () => {
  const source = createConversation("Source conversation");
  const user = createMessage({
    conversationId: source.id,
    role: "user",
    content: "Original request"
  });
  const assistant = createMessage({
    conversationId: source.id,
    role: "assistant",
    content: "First answer",
    thinkingContent: "Reasoning block"
  });
  createMessageAction({
    messageId: assistant.id,
    kind: "mcp_tool_call",
    status: "completed",
    serverId: "docs",
    skillId: null,
    toolName: "search_docs",
    label: "Search docs",
    detail: "query=fork",
    arguments: { query: "fork" },
    resultSummary: "Done",
    sortOrder: 0
  });
  createMessageTextSegment({
    messageId: assistant.id,
    content: "First answer",
    sortOrder: 0
  });
  createConversationAttachment({
    conversationId: source.id,
    messageId: assistant.id,
    filename: "diagram.txt",
    mimeType: "text/plain",
    byteSize: 5,
    sha256: "abc123",
    relativePath: `${source.id}/diagram.txt`,
    kind: "text",
    extractedText: "fork"
  });

  const tail = createMessage({
    conversationId: source.id,
    role: "assistant",
    content: "Later answer"
  });

  const eligibleNode = createMemoryNode({
    conversationId: source.id,
    type: "leaf_summary",
    depth: 0,
    content: "Summary through first answer",
    sourceStartMessageId: user.id,
    sourceEndMessageId: assistant.id,
    sourceTokenCount: 50,
    summaryTokenCount: 10,
    childNodeIds: []
  });

  createCompactionEvent({
    conversationId: source.id,
    nodeId: eligibleNode.id,
    sourceStartMessageId: user.id,
    sourceEndMessageId: assistant.id,
    noticeMessageId: null
  });

  createMemoryNode({
    conversationId: source.id,
    type: "leaf_summary",
    depth: 0,
    content: "Summary including later answer",
    sourceStartMessageId: user.id,
    sourceEndMessageId: tail.id,
    sourceTokenCount: 60,
    summaryTokenCount: 12,
    childNodeIds: []
  });

  const forked = forkConversationFromMessage(assistant.id);

  expect(forked.id).not.toBe(source.id);
  expect(forked.providerProfileId).toBe(getConversation(source.id)?.providerProfileId ?? null);

  const forkMessages = listMessages(forked.id);
  expect(forkMessages.map((message) => message.content)).toEqual([
    "Original request",
    "First answer"
  ]);
  expect(forkMessages[1]?.thinkingContent).toBe("Reasoning block");
  expect(forkMessages[1]?.actions).toHaveLength(1);
  expect(forkMessages[1]?.textSegments).toHaveLength(1);
  expect(forkMessages[1]?.attachments).toHaveLength(1);

  expect(forkMessages.some((message) => message.content === "Later answer")).toBe(false);
  expect(forkMessages[1]?.id).not.toBe(assistant.id);
  expect(forkMessages[1]?.actions?.[0]?.messageId).toBe(forkMessages[1]?.id);
  expect(forkMessages[1]?.textSegments?.[0]?.messageId).toBe(forkMessages[1]?.id);
  expect(forkMessages[1]?.attachments?.[0]?.messageId).toBe(forkMessages[1]?.id);
});

it("rejects forking a non-assistant message", () => {
  const source = createConversation("Source conversation");
  const user = createMessage({
    conversationId: source.id,
    role: "user",
    content: "Original request"
  });

  expect(() => forkConversationFromMessage(user.id)).toThrow("Only assistant messages can be forked");
});
```

- [ ] **Step 2: Run the targeted data-layer tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: FAIL with `forkConversationFromMessage` missing and missing helper/create functions referenced by the new tests.

- [ ] **Step 3: Add the minimal cloning helper and supporting test fixtures**

Implement the data-layer API in `lib/conversations.ts` and add any small exported test helpers the tests require, following this shape:

```ts
export function forkConversationFromMessage(messageId: string, userId?: string) {
  const transaction = getDb().transaction((targetMessageId: string, targetUserId?: string) => {
    const sourceMessage = getMessage(targetMessageId, targetUserId);

    if (!sourceMessage) {
      throw new Error("Message not found");
    }

    if (sourceMessage.role !== "assistant") {
      throw new Error("Only assistant messages can be forked");
    }

    const sourceConversation = getConversation(sourceMessage.conversationId, targetUserId);
    if (!sourceConversation) {
      throw new Error("Conversation not found");
    }

    const sourceMessages = listMessages(sourceConversation.id);
    const branchIndex = sourceMessages.findIndex((message) => message.id === sourceMessage.id);
    if (branchIndex === -1) {
      throw new Error("Message not found");
    }

    const retainedMessages = sourceMessages.slice(0, branchIndex + 1);
    const retainedMessageIds = new Set(retainedMessages.map((message) => message.id));
    const forkedConversation = createConversation(null, sourceConversation.folderId, {
      providerProfileId: sourceConversation.providerProfileId
    }, targetUserId ?? getConversationOwnerId(sourceConversation.id) ?? undefined);

    const messageIdMap = new Map<string, string>();

    for (const message of retainedMessages) {
      const cloned = createMessage({
        conversationId: forkedConversation.id,
        role: message.role,
        content: message.content,
        thinkingContent: message.thinkingContent,
        status: message.status,
        systemKind: message.systemKind,
        estimatedTokens: message.estimatedTokens
      });
      messageIdMap.set(message.id, cloned.id);

      for (const action of message.actions ?? []) {
        createMessageAction({
          messageId: cloned.id,
          kind: action.kind,
          status: action.status,
          serverId: action.serverId,
          skillId: action.skillId,
          toolName: action.toolName,
          label: action.label,
          detail: action.detail,
          arguments: action.arguments,
          resultSummary: action.resultSummary,
          sortOrder: action.sortOrder
        });
      }

      for (const segment of message.textSegments ?? []) {
        createMessageTextSegment({
          messageId: cloned.id,
          content: segment.content,
          sortOrder: segment.sortOrder
        });
      }

      for (const attachment of message.attachments ?? []) {
        createConversationAttachment({
          conversationId: forkedConversation.id,
          messageId: cloned.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          sha256: attachment.sha256,
          relativePath: attachment.relativePath,
          kind: attachment.kind,
          extractedText: attachment.extractedText
        });
      }
    }

    cloneEligibleCompactionState({
      sourceConversationId: sourceConversation.id,
      targetConversationId: forkedConversation.id,
      retainedMessageIds,
      messageIdMap
    });

    return forkedConversation;
  });

  return transaction(messageId, userId);
}
```

Also add small DB-backed helpers only if needed by tests and implementation:

```ts
export function createConversationAttachment(input: {
  conversationId: string;
  messageId: string | null;
  filename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  relativePath: string;
  kind: AttachmentKind;
  extractedText: string;
}) {
  const attachment = {
    id: createId("att"),
    createdAt: nowIso(),
    ...input
  };

  getDb()
    .prepare(
      `INSERT INTO message_attachments (
        id, conversation_id, message_id, filename, mime_type, byte_size,
        sha256, relative_path, kind, extracted_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      attachment.id,
      attachment.conversationId,
      attachment.messageId,
      attachment.filename,
      attachment.mimeType,
      attachment.byteSize,
      attachment.sha256,
      attachment.relativePath,
      attachment.kind,
      attachment.extractedText,
      attachment.createdAt
    );

  return attachment;
}

export function createMemoryNode(input: {
  conversationId: string;
  type: MemoryNodeType;
  depth: number;
  content: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  sourceTokenCount: number;
  summaryTokenCount: number;
  childNodeIds: string[];
}) {
  const node = {
    id: createId("mem"),
    supersededByNodeId: null,
    createdAt: nowIso(),
    ...input
  };

  getDb()
    .prepare(
      `INSERT INTO memory_nodes (
        id, conversation_id, type, depth, content, source_start_message_id,
        source_end_message_id, source_token_count, summary_token_count,
        child_node_ids, superseded_by_node_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      node.id,
      node.conversationId,
      node.type,
      node.depth,
      node.content,
      node.sourceStartMessageId,
      node.sourceEndMessageId,
      node.sourceTokenCount,
      node.summaryTokenCount,
      JSON.stringify(node.childNodeIds),
      node.supersededByNodeId,
      node.createdAt
    );

  return node;
}

export function createCompactionEvent(input: {
  conversationId: string;
  nodeId: string;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
  noticeMessageId: string | null;
}) {
  const event = {
    id: createId("cmp"),
    createdAt: nowIso(),
    ...input
  };

  getDb()
    .prepare(
      `INSERT INTO compaction_events (
        id, conversation_id, node_id, source_start_message_id,
        source_end_message_id, notice_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.id,
      event.conversationId,
      event.nodeId,
      event.sourceStartMessageId,
      event.sourceEndMessageId,
      event.noticeMessageId,
      event.createdAt
    );

  return event;
}

function cloneEligibleCompactionState(input: {
  sourceConversationId: string;
  targetConversationId: string;
  retainedMessageIds: Set<string>;
  messageIdMap: Map<string, string>;
}) {
  const sourceNodes = getDb()
    .prepare(
      `SELECT
        id, type, depth, content, source_start_message_id, source_end_message_id,
        source_token_count, summary_token_count, child_node_ids
       FROM memory_nodes
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(input.sourceConversationId) as Array<{
      id: string;
      type: MemoryNodeType;
      depth: number;
      content: string;
      source_start_message_id: string;
      source_end_message_id: string;
      source_token_count: number;
      summary_token_count: number;
      child_node_ids: string;
    }>;

  const eligibleNodeIds = new Map<string, string>();

  for (const node of sourceNodes) {
    if (
      !input.retainedMessageIds.has(node.source_start_message_id) ||
      !input.retainedMessageIds.has(node.source_end_message_id)
    ) {
      continue;
    }

    const cloned = createMemoryNode({
      conversationId: input.targetConversationId,
      type: node.type,
      depth: node.depth,
      content: node.content,
      sourceStartMessageId: input.messageIdMap.get(node.source_start_message_id)!,
      sourceEndMessageId: input.messageIdMap.get(node.source_end_message_id)!,
      sourceTokenCount: node.source_token_count,
      summaryTokenCount: node.summary_token_count,
      childNodeIds: JSON.parse(node.child_node_ids) as string[]
    });

    eligibleNodeIds.set(node.id, cloned.id);
  }

  const sourceEvents = getDb()
    .prepare(
      `SELECT
        node_id, source_start_message_id, source_end_message_id, notice_message_id
       FROM compaction_events
       WHERE conversation_id = ?
       ORDER BY created_at ASC`
    )
    .all(input.sourceConversationId) as Array<{
      node_id: string;
      source_start_message_id: string;
      source_end_message_id: string;
      notice_message_id: string | null;
    }>;

  for (const event of sourceEvents) {
    const clonedNodeId = eligibleNodeIds.get(event.node_id);

    if (
      !clonedNodeId ||
      !input.retainedMessageIds.has(event.source_start_message_id) ||
      !input.retainedMessageIds.has(event.source_end_message_id)
    ) {
      continue;
    }

    createCompactionEvent({
      conversationId: input.targetConversationId,
      nodeId: clonedNodeId,
      sourceStartMessageId: input.messageIdMap.get(event.source_start_message_id)!,
      sourceEndMessageId: input.messageIdMap.get(event.source_end_message_id)!,
      noticeMessageId: event.notice_message_id
        ? input.messageIdMap.get(event.notice_message_id) ?? null
        : null
    });
  }
}
```

- [ ] **Step 4: Run the targeted data-layer tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: PASS for the new forking tests and existing conversation helper coverage.

- [ ] **Step 5: Commit the data-layer foundation**

```bash
git add lib/conversations.ts tests/unit/conversations.test.ts
git commit -m "feat: add conversation fork data helper"
```

### Task 2: Add failing API route tests for message-scoped forking

**Files:**
- Create: `app/api/messages/[messageId]/fork/route.ts`
- Modify: `tests/unit/conversations.test.ts`
- Modify: `lib/conversations.ts`

- [ ] **Step 1: Write the failing API route tests**

Append route coverage to `tests/unit/conversations.test.ts` using the same unit style as other route-adjacent helper tests:

```ts
const { requireUserMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock
}));

it("fork route creates a forked conversation for an assistant message", async () => {
  requireUserMock.mockResolvedValue({
    id: "user_route",
    username: "route-user",
    role: "user",
    authSource: "local",
    passwordManagedBy: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
  const user = await createLocalUser({
    username: "fork-route-user",
    password: "Password123!",
    role: "user"
  });
  const source = createConversation("Source", null, undefined, user.id);
  const assistant = createMessage({
    conversationId: source.id,
    role: "assistant",
    content: "Fork from here"
  });

  const response = await POST(
    new Request("http://localhost/api/messages/msg/fork", { method: "POST" }),
    { params: Promise.resolve({ messageId: assistant.id }) }
  );
  const payload = await response.json() as { conversation?: { id: string } };

  expect(response.status).toBe(201);
  expect(payload.conversation?.id).toBeTruthy();
  expect(listVisibleMessages(payload.conversation!.id).map((message) => message.content)).toEqual([
    "Fork from here"
  ]);
});

it("fork route rejects user messages", async () => {
  requireUserMock.mockResolvedValue({
    id: "user_route_two",
    username: "route-user-two",
    role: "user",
    authSource: "local",
    passwordManagedBy: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  });
  const { POST } = await import("@/app/api/messages/[messageId]/fork/route");
  const user = await createLocalUser({
    username: "fork-route-user-two",
    password: "Password123!",
    role: "user"
  });
  const source = createConversation("Source", null, undefined, user.id);
  const userMessage = createMessage({
    conversationId: source.id,
    role: "user",
    content: "Cannot fork me"
  });

  const response = await POST(
    new Request("http://localhost/api/messages/msg/fork", { method: "POST" }),
    { params: Promise.resolve({ messageId: userMessage.id }) }
  );

  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: FAIL because `app/api/messages/[messageId]/fork/route.ts` does not exist.

- [ ] **Step 3: Add the minimal fork route**

Create `app/api/messages/[messageId]/fork/route.ts` with this implementation:

```ts
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { forkConversationFromMessage } from "@/lib/conversations";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({
  messageId: z.string().min(1)
});

export async function POST(
  _request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid message id");
  }

  try {
    const conversation = forkConversationFromMessage(params.data.messageId, user.id);
    return ok({ conversation }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to fork conversation";

    if (message === "Message not found" || message === "Conversation not found") {
      return badRequest(message, 404);
    }

    if (message === "Only assistant messages can be forked") {
      return badRequest(message, 400);
    }

    throw error;
  }
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts
```

Expected: PASS for the new route coverage and existing conversation tests.

- [ ] **Step 5: Commit the API slice**

```bash
git add app/api/messages/[messageId]/fork/route.ts lib/conversations.ts tests/unit/conversations.test.ts
git commit -m "feat: add message fork api route"
```

### Task 3: Add failing UI tests for the assistant fork action rendering

**Files:**
- Modify: `components/message-bubble.tsx`
- Modify: `tests/unit/message-bubble.test.ts`

- [ ] **Step 1: Write the failing UI rendering tests**

Add these tests to `tests/unit/message-bubble.test.ts`:

```ts
it("renders a fork action for completed assistant messages", () => {
  render(
    React.createElement(MessageBubble, {
      message: createAssistantMessage(),
      onForkAssistantMessage: vi.fn()
    })
  );

  expect(screen.getByRole("button", { name: "Fork conversation from message" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
});

it("does not render a fork action for user messages", () => {
  render(
    React.createElement(MessageBubble, {
      message: createUserMessage(),
      onForkAssistantMessage: vi.fn()
    })
  );

  expect(screen.queryByRole("button", { name: "Fork conversation from message" })).toBeNull();
});

it("does not render a fork action for streaming placeholders", () => {
  render(
    React.createElement(StreamingPlaceholder, {
      createdAt: new Date().toISOString(),
      thinking: "",
      answer: "Streaming answer",
      awaitingFirstToken: false,
      thinkingInProgress: false,
      timeline: []
    })
  );

  expect(screen.queryByRole("button", { name: "Fork conversation from message" })).toBeNull();
});
```

- [ ] **Step 2: Run the targeted UI test file to verify it fails**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
```

Expected: FAIL because `MessageBubble` does not yet accept or render the fork action.

- [ ] **Step 3: Add the minimal fork button support in the message bubble**

Update `components/message-bubble.tsx` with these focused changes:

```ts
import { GitFork, Brain, Check, ChevronDown, ChevronRight, Copy, FileText, LoaderCircle, Pencil, Square, X } from "lucide-react";

export function MessageBubble({
  message,
  onForkAssistantMessage,
  ...rest
}: {
  message: Message;
  onForkAssistantMessage?: (messageId: string) => void | Promise<void>;
  // keep existing props unchanged
}) {
  const showAssistantBubbleActions =
    message.role === "assistant" &&
    message.id !== "streaming" &&
    message.status !== "streaming";

  const canForkAssistantMessage =
    message.role === "assistant" &&
    message.id !== "streaming" &&
    message.status !== "streaming" &&
    Boolean(onForkAssistantMessage);

  // existing assistant action row...
  {showAssistantBubbleActions ? (
    <div className="mt-2 flex items-center gap-1 opacity-100 transition md:pointer-events-none md:translate-y-1 md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
      {canForkAssistantMessage ? (
        <ActionButton
          label="Fork conversation from message"
          onClick={() => {
            void onForkAssistantMessage?.(message.id);
          }}
        >
          <GitFork className="h-3.5 w-3.5" />
        </ActionButton>
      ) : null}
      <ActionButton
        label={copyState === "copied" ? "Copied" : "Copy message"}
        onClick={() => void handleCopy()}
      >
        {/* keep existing copy icon state logic unchanged */}
      </ActionButton>
    </div>
  ) : null}
}
```

- [ ] **Step 4: Run the targeted UI test file to verify it passes**

Run:

```bash
npx vitest run tests/unit/message-bubble.test.ts
```

Expected: PASS for the new rendering coverage and existing message bubble tests.

- [ ] **Step 5: Commit the message bubble UI support**

```bash
git add components/message-bubble.tsx tests/unit/message-bubble.test.ts
git commit -m "feat: add assistant message fork action"
```

### Task 4: Add failing chat view tests for fork request, redirect, and error handling

**Files:**
- Modify: `components/chat-view.tsx`
- Modify: `tests/unit/chat-view.test.ts`

- [ ] **Step 1: Write the failing chat view interaction tests**

Add these tests to `tests/unit/chat-view.test.ts`:

```ts
it("forks an assistant message and redirects to the new conversation", async () => {
  const payload = createPayload();
  payload.messages = [
    {
      id: "msg_assistant",
      conversationId: "conv_1",
      role: "assistant",
      content: "Branch here",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
      actions: []
    }
  ];

  vi.mocked(global.fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ personas: [] })
    } as Response)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        conversation: {
          id: "conv_forked"
        }
      })
    } as Response);

  renderWithProvider(React.createElement(ChatView, { payload }));

  fireEvent.click(screen.getByRole("button", { name: "Fork conversation from message" }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith("/api/messages/msg_assistant/fork", {
      method: "POST"
    });
    expect(push).toHaveBeenCalledWith("/chat/conv_forked");
  });
});

it("shows a local error when the fork request fails", async () => {
  const payload = createPayload();
  payload.messages = [
    {
      id: "msg_assistant",
      conversationId: "conv_1",
      role: "assistant",
      content: "Branch here",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0,
      systemKind: null,
      compactedAt: null,
      createdAt: new Date().toISOString(),
      actions: []
    }
  ];

  vi.mocked(global.fetch)
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ personas: [] })
    } as Response)
    .mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Unable to fork conversation" })
    } as Response);

  renderWithProvider(React.createElement(ChatView, { payload }));

  fireEvent.click(screen.getByRole("button", { name: "Fork conversation from message" }));

  await waitFor(() => {
    expect(screen.getByText("Unable to fork conversation")).toBeInTheDocument();
  });

  expect(push).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the targeted chat view tests to verify they fail**

Run:

```bash
npx vitest run tests/unit/chat-view.test.ts
```

Expected: FAIL because `ChatView` does not yet wire the fork action into `MessageBubble`.

- [ ] **Step 3: Add the minimal chat view fork flow**

Update `components/chat-view.tsx` with a focused request handler and pass-through prop:

```ts
const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);

async function forkAssistantMessage(messageId: string) {
  if (forkingMessageId) {
    return;
  }

  setError("");
  setForkingMessageId(messageId);

  try {
    const response = await fetch(`/api/messages/${messageId}/fork`, {
      method: "POST"
    });

    if (!response.ok) {
      let message = "Unable to fork conversation";

      try {
        const failure = (await response.json()) as { error?: string };
        message = failure.error ?? message;
      } catch {}

      throw new Error(message);
    }

    const payload = (await response.json()) as { conversation: { id: string } };
    router.push(`/chat/${payload.conversation.id}`);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unable to fork conversation");
  } finally {
    setForkingMessageId((current) => (current === messageId ? null : current));
  }
}
```

Pass the handler into assistant `MessageBubble` rendering:

```ts
<MessageBubble
  message={message}
  onUpdateUserMessage={updateUserMessage}
  onForkAssistantMessage={forkAssistantMessage}
  isUpdating={updatingMessageId === message.id || forkingMessageId === message.id}
/>
```

If `isUpdating` is already used for user-message editing only, split it into a dedicated disabled prop instead of conflating states:

```ts
isForking={forkingMessageId === message.id}
```

Then consume that in `MessageBubble` to disable only the fork control.

- [ ] **Step 4: Run the targeted chat view tests to verify they pass**

Run:

```bash
npx vitest run tests/unit/chat-view.test.ts
```

Expected: PASS for the new fork interaction coverage and existing chat view tests.

- [ ] **Step 5: Commit the chat view integration**

```bash
git add components/chat-view.tsx components/message-bubble.tsx tests/unit/chat-view.test.ts
git commit -m "feat: wire assistant message fork flow"
```

### Task 5: Run focused regression checks and browser validation

**Files:**
- Modify: none
- Verify: `tests/unit/conversations.test.ts`
- Verify: `tests/unit/message-bubble.test.ts`
- Verify: `tests/unit/chat-view.test.ts`
- Verify: running dev server via `.dev-server`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npx vitest run tests/unit/conversations.test.ts tests/unit/message-bubble.test.ts tests/unit/chat-view.test.ts
```

Expected: PASS with all fork-related unit coverage green.

- [ ] **Step 2: Run typecheck for the touched surfaces**

Run:

```bash
npm run typecheck
```

Expected: PASS with no TypeScript errors in the new fork route, data helper, or chat UI changes.

- [ ] **Step 3: Start or reuse the dev server**

Run:

```bash
if [ -f .dev-server ]; then
  head -n 1 .dev-server
else
  npm run dev
fi
```

Expected: a localhost URL from `.dev-server`. If the recorded server is unreachable, delete `.dev-server`, restart `npm run dev`, wait for `.dev-server` to appear, then read the first line again.

- [ ] **Step 4: Validate the UI in the browser using agent-browser**

Run:

```bash
agent-browser open http://localhost:PORT/chat/CONVERSATION_ID
agent-browser snapshot
agent-browser screenshot /tmp/branch-fork-conversation.png
```

Then interact with the assistant fork control:

```bash
agent-browser click <fork-button-ref>
agent-browser snapshot
agent-browser screenshot /tmp/branch-fork-result.png
```

Expected:

- The assistant message shows a fork button next to copy
- Clicking the fork button redirects to a new `/chat/<id>` route
- The new conversation shows only the retained prefix
- The original thread remains unchanged when revisited

- [ ] **Step 5: Commit the verification checkpoint**

```bash
git add .
git commit -m "test: verify branching fork conversation flow"
```

---

## Self-Review

### Spec coverage

- Assistant-only fork affordance: covered by Task 3 and Task 4
- Inclusive cutoff through selected assistant message: covered by Task 1 and Task 2
- Full persisted detail copy: covered by Task 1
- Immediate redirect into new chat: covered by Task 4 and Task 5
- Failure rollback and local error handling: covered by Task 1, Task 2, and Task 4
- Browser validation requirement from `AGENTS.md`: covered by Task 5

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation notes remain
- Every code-changing step includes concrete code
- Every verification step includes an exact command and expected result

### Type consistency

- The plan consistently uses `forkConversationFromMessage`
- The route path is consistently `app/api/messages/[messageId]/fork/route.ts`
- The client action label is consistently `Fork conversation from message`
