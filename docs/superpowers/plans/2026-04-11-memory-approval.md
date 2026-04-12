# Memory Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic memory mutations with inline approval cards so every create, update, and delete memory action is explicitly accepted or dismissed by the user in chat.

**Architecture:** Persist pending memory proposals on `message_actions` instead of mutating `user_memories` during the assistant turn. Add approval and dismissal endpoints that apply the proposed change through a focused `lib/memory-proposals.ts` helper, then teach the assistant timeline UI to render pending memory actions as interactive cards.

**Tech Stack:** Next.js App Router, React 19, TypeScript, better-sqlite3, Vitest, Testing Library

---

## File Structure

- Modify: `lib/types.ts`
  Extend message-action types with proposal metadata and new pending status.
- Modify: `lib/db.ts`
  Add schema migration for proposal columns on `message_actions`.
- Modify: `lib/conversations.ts`
  Persist and hydrate proposal fields in `createMessageAction()` and `updateMessageAction()`.
- Create: `lib/memory-proposals.ts`
  Centralize proposal creation, approval, dismissal, and validation logic.
- Modify: `lib/assistant-runtime.ts`
  Convert memory tool handlers from immediate writes to proposal creation.
- Modify: `lib/copilot-tools.ts`
  Mirror proposal semantics for the Copilot tool path.
- Modify: `lib/compaction.ts`
  Update memory prompt guidance to reflect approval-based behavior.
- Create: `app/api/message-actions/[actionId]/approve/route.ts`
  Approve a pending memory proposal, optionally with edited values.
- Create: `app/api/message-actions/[actionId]/dismiss/route.ts`
  Dismiss a pending memory proposal without mutating stored memories.
- Modify: `components/message-bubble.tsx`
  Render pending memory proposal cards and inline edit controls.
- Modify: `components/chat-view.tsx`
  Send approve/dismiss requests and reconcile returned action state into the message list.
- Modify: `tests/unit/db.test.ts`
  Cover migration of proposal columns.
- Modify: `tests/unit/conversations.test.ts`
  Cover proposal payload persistence and updates on message actions.
- Modify: `tests/unit/assistant-runtime.test.ts`
  Verify runtime creates proposals instead of writing memories directly.
- Modify: `tests/unit/copilot-tools.test.ts`
  Verify Copilot memory handlers create pending proposals.
- Create: `tests/unit/memory-proposals.test.ts`
  Cover approve/dismiss flows and validation errors.
- Modify: `tests/unit/message-bubble.test.ts`
  Cover pending proposal rendering and inline interactions.
- Modify: `tests/unit/chat-view.test.ts`
  Cover approve/dismiss request wiring and UI state reconciliation.

### Task 1: Persist memory proposal metadata

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/db.ts`
- Modify: `lib/conversations.ts`
- Modify: `tests/unit/db.test.ts`
- Modify: `tests/unit/conversations.test.ts`

- [ ] **Step 1: Write the failing persistence tests**

Add these assertions to `tests/unit/db.test.ts` and `tests/unit/conversations.test.ts`:

```ts
it("adds memory proposal columns to message_actions", async () => {
  const { getDb } = await import("@/lib/db");
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(message_actions)").all() as Array<{ name: string }>;

  expect(columns.map((column) => column.name)).toEqual(
    expect.arrayContaining(["proposal_state", "proposal_payload_json", "proposal_updated_at"])
  );
});

it("persists proposal metadata on message actions", async () => {
  const { createMessage, createMessageAction, updateMessageAction, getMessage } = await import("@/lib/conversations");

  const message = createMessage({
    conversationId: "conv_test",
    role: "assistant",
    content: "",
    thinkingContent: "",
    status: "completed",
    estimatedTokens: 0
  });

  const created = createMessageAction({
    messageId: message.id,
    kind: "create_memory",
    status: "pending",
    label: "Save memory",
    proposalState: "pending",
    proposalPayload: {
      operation: "create",
      targetMemoryId: null,
      proposedMemory: { content: "User prefers TypeScript", category: "preference" }
    }
  });

  expect(created.proposalState).toBe("pending");
  expect(created.proposalPayload?.operation).toBe("create");

  const updated = updateMessageAction(created.id, {
    status: "completed",
    proposalState: "dismissed",
    proposalUpdatedAt: "2026-04-11T12:00:00.000Z"
  });

  expect(updated?.proposalState).toBe("dismissed");
  expect(getMessage(message.id)?.actions?.[0]?.proposalState).toBe("dismissed");
});
```

- [ ] **Step 2: Run the persistence tests to confirm the missing fields fail**

Run:

```bash
npm test -- --run tests/unit/db.test.ts tests/unit/conversations.test.ts
```

Expected: FAIL with missing `proposal_*` fields on `MessageAction` and no matching columns in `message_actions`.

- [ ] **Step 3: Add the proposal types and persistence fields**

Update `lib/types.ts`, `lib/db.ts`, and `lib/conversations.ts` with these focused changes:

```ts
export type MessageActionStatus = "running" | "pending" | "completed" | "error" | "stopped";

export type MemoryProposalOperation = "create" | "update" | "delete";
export type MemoryProposalState = "pending" | "approved" | "dismissed" | "superseded";

export type MemoryProposalPayload = {
  operation: MemoryProposalOperation;
  targetMemoryId: string | null;
  currentMemory?: {
    id: string;
    content: string;
    category: MemoryCategory;
  };
  proposedMemory?: {
    content: string;
    category: MemoryCategory;
  };
};

export type MessageAction = {
  id: string;
  messageId: string;
  kind: MessageActionKind;
  status: MessageActionStatus;
  serverId: string | null;
  skillId: string | null;
  toolName: string | null;
  label: string;
  detail: string;
  arguments: Record<string, unknown> | null;
  resultSummary: string;
  sortOrder: number;
  startedAt: string;
  completedAt: string | null;
  proposalState: MemoryProposalState | null;
  proposalPayload: MemoryProposalPayload | null;
  proposalUpdatedAt: string | null;
};
```

```ts
getDb().exec(`
  ALTER TABLE message_actions ADD COLUMN proposal_state TEXT;
  ALTER TABLE message_actions ADD COLUMN proposal_payload_json TEXT;
  ALTER TABLE message_actions ADD COLUMN proposal_updated_at TEXT;
`);
```

```ts
type CreateMessageActionInput = {
  messageId: string;
  kind: MessageActionKind;
  status?: MessageActionStatus;
  label: string;
  detail?: string;
  arguments?: Record<string, unknown> | null;
  resultSummary?: string;
  sortOrder?: number;
  proposalState?: MemoryProposalState | null;
  proposalPayload?: MemoryProposalPayload | null;
  proposalUpdatedAt?: string | null;
};
```

- [ ] **Step 4: Re-run the persistence tests**

Run:

```bash
npm test -- --run tests/unit/db.test.ts tests/unit/conversations.test.ts
```

Expected: PASS for proposal column migration and action payload round-tripping.

- [ ] **Step 5: Commit the persistence layer**

```bash
git add lib/types.ts lib/db.ts lib/conversations.ts tests/unit/db.test.ts tests/unit/conversations.test.ts
git commit -m "feat: persist message action memory proposals"
```

### Task 2: Convert assistant memory tools into proposal creation

**Files:**
- Create: `lib/memory-proposals.ts`
- Modify: `lib/assistant-runtime.ts`
- Modify: `lib/copilot-tools.ts`
- Modify: `lib/compaction.ts`
- Modify: `tests/unit/assistant-runtime.test.ts`
- Modify: `tests/unit/copilot-tools.test.ts`

- [ ] **Step 1: Write failing runtime tests for pending proposals**

Add these test cases:

```ts
it("creates a pending memory proposal instead of saving immediately", async () => {
  streamProviderResponse
    .mockReturnValueOnce(createProviderStream([], {
      answer: "",
      thinking: "",
      toolCalls: [{ id: "call_1", name: "create_memory", arguments: JSON.stringify({ content: "User prefers TypeScript", category: "preference" }) }],
      usage: { inputTokens: 12 }
    }))
    .mockReturnValueOnce(createProviderStream([{ type: "answer_delta", text: "Noted." }], {
      answer: "Noted.",
      thinking: "",
      usage: { inputTokens: 4, outputTokens: 1 }
    }));

  const started: Array<Record<string, unknown>> = [];
  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

  await resolveAssistantTurn({
    settings: createSettings(),
    promptMessages: [{ role: "user", content: "Remember that I prefer TypeScript." }],
    skills: [],
    mcpToolSets: [],
    memoriesEnabled: true,
    onEvent: () => {},
    onActionStart: (action) => { started.push(action); return "act_memory"; }
  });

  expect(createMemoryFn).not.toHaveBeenCalled();
  expect(started[0]).toEqual(expect.objectContaining({
    kind: "create_memory",
    status: "pending",
    proposalState: "pending"
  }));
});
```

```ts
it("creates pending proposals for copilot memory tools", async () => {
  const ctx = makeCtx({ memoriesEnabled: true, onActionStart: vi.fn().mockResolvedValue("act_memory") });
  const tools = buildCopilotTools(ctx);
  const createTool = tools.find((tool) => tool.name === "create_memory");

  await createTool!.handler({ content: "User lives in Toronto", category: "location" });

  expect(ctx.onActionStart).toHaveBeenCalledWith(expect.objectContaining({
    kind: "create_memory",
    status: "pending",
    proposalState: "pending"
  }));
});
```

- [ ] **Step 2: Run the runtime tests and confirm they fail**

Run:

```bash
npm test -- --run tests/unit/assistant-runtime.test.ts tests/unit/copilot-tools.test.ts
```

Expected: FAIL because the runtime still calls `createMemory`, `updateMemory`, and `deleteMemory` immediately and the action payload does not include proposal metadata.

- [ ] **Step 3: Add proposal helpers and switch the runtime to use them**

Create `lib/memory-proposals.ts` and wire the runtime to it:

```ts
export function buildCreateMemoryProposal(input: {
  content: string;
  category: MemoryCategory;
}): MemoryProposalPayload {
  return {
    operation: "create",
    targetMemoryId: null,
    proposedMemory: {
      content: input.content.trim(),
      category: input.category
    }
  };
}

export function buildUpdateMemoryProposal(input: {
  currentMemory: UserMemory;
  content: string;
  category?: MemoryCategory;
}): MemoryProposalPayload {
  return {
    operation: "update",
    targetMemoryId: input.currentMemory.id,
    currentMemory: {
      id: input.currentMemory.id,
      content: input.currentMemory.content,
      category: input.currentMemory.category
    },
    proposedMemory: {
      content: input.content.trim(),
      category: input.category ?? input.currentMemory.category
    }
  };
}

export function buildDeleteMemoryProposal(currentMemory: UserMemory): MemoryProposalPayload {
  return {
    operation: "delete",
    targetMemoryId: currentMemory.id,
    currentMemory: {
      id: currentMemory.id,
      content: currentMemory.content,
      category: currentMemory.category
    }
  };
}
```

```ts
const handle = await context.input.onActionStart?.({
  kind: "create_memory",
  status: "pending",
  label: "Save memory",
  detail: content,
  arguments: args,
  proposalState: "pending",
  proposalPayload: buildCreateMemoryProposal({
    content,
    category: normalizedCategory as MemoryCategory
  })
});

const resultMsg = buildToolResultMessage(
  toolCallId,
  `Memory change proposed for approval: ${content} [${normalizedCategory}]`
);
```

```ts
lines.push(
  "You have access to memory tools (create_memory, update_memory, delete_memory) to propose durable facts about the user across conversations. Memory changes are not applied immediately: the user reviews and approves or dismisses each proposal inline in chat."
);
```

- [ ] **Step 4: Re-run the runtime tests**

Run:

```bash
npm test -- --run tests/unit/assistant-runtime.test.ts tests/unit/copilot-tools.test.ts
```

Expected: PASS with no direct memory writes during assistant execution and pending proposal actions emitted in both runtime paths.

- [ ] **Step 5: Commit the proposal runtime**

```bash
git add lib/memory-proposals.ts lib/assistant-runtime.ts lib/copilot-tools.ts lib/compaction.ts tests/unit/assistant-runtime.test.ts tests/unit/copilot-tools.test.ts
git commit -m "feat: turn memory tools into approval proposals"
```

### Task 3: Add approve and dismiss APIs for memory proposals

**Files:**
- Create: `app/api/message-actions/[actionId]/approve/route.ts`
- Create: `app/api/message-actions/[actionId]/dismiss/route.ts`
- Modify: `lib/memory-proposals.ts`
- Modify: `tests/unit/memory-proposals.test.ts`

- [ ] **Step 1: Write failing approval flow tests**

Create `tests/unit/memory-proposals.test.ts` with:

```ts
import { describe, expect, it } from "vitest";

import { createMemory, getMemory, listMemories } from "@/lib/memories";
import { approveMemoryProposal, dismissMemoryProposal } from "@/lib/memory-proposals";
import { createConversation, createMessage, createMessageAction } from "@/lib/conversations";

describe("memory proposals", () => {
  it("approves a pending create proposal and writes the memory", () => {
    const conversation = createConversation("Test chat");
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0
    });

    const action = createMessageAction({
      messageId: message.id,
      kind: "create_memory",
      status: "pending",
      label: "Save memory",
      proposalState: "pending",
      proposalPayload: {
        operation: "create",
        targetMemoryId: null,
        proposedMemory: { content: "User prefers TypeScript", category: "preference" }
      }
    });

    const updated = approveMemoryProposal(action.id);

    expect(updated?.proposalState).toBe("approved");
    expect(listMemories().map((memory) => memory.content)).toContain("User prefers TypeScript");
  });

  it("dismisses a pending delete proposal without removing the memory", () => {
    const memory = createMemory("User lives in Toronto", "location");
    const conversation = createConversation("Test chat");
    const message = createMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      thinkingContent: "",
      status: "completed",
      estimatedTokens: 0
    });

    const action = createMessageAction({
      messageId: message.id,
      kind: "delete_memory",
      status: "pending",
      label: "Delete memory",
      proposalState: "pending",
      proposalPayload: {
        operation: "delete",
        targetMemoryId: memory.id,
        currentMemory: {
          id: memory.id,
          content: memory.content,
          category: memory.category
        }
      }
    });

    const updated = dismissMemoryProposal(action.id);

    expect(updated?.proposalState).toBe("dismissed");
    expect(getMemory(memory.id)?.content).toBe("User lives in Toronto");
  });
});
```

- [ ] **Step 2: Run the proposal tests to confirm they fail**

Run:

```bash
npm test -- --run tests/unit/memory-proposals.test.ts
```

Expected: FAIL because `approveMemoryProposal()` and `dismissMemoryProposal()` do not exist yet.

- [ ] **Step 3: Implement proposal application and route handlers**

Add approval helpers to `lib/memory-proposals.ts` and route handlers under `app/api/message-actions`:

```ts
export function approveMemoryProposal(
  actionId: string,
  overrides?: { content?: string; category?: MemoryCategory },
  userId?: string
) {
  const action = getMessageAction(actionId, userId);
  if (!action || action.status !== "pending" || action.proposalState !== "pending" || !action.proposalPayload) {
    throw new Error("Pending memory proposal not found");
  }

  const proposal = applyProposalOverrides(action.proposalPayload, overrides);

  if (proposal.operation === "create") {
    const settings = getSettings();
    if (getMemoryCount(userId) >= settings.memoriesMaxCount) {
      throw new Error(`Memory limit reached (${getMemoryCount(userId)}/${settings.memoriesMaxCount})`);
    }
    createMemory(proposal.proposedMemory!.content, proposal.proposedMemory!.category, userId);
  } else if (proposal.operation === "update") {
    const updated = updateMemory(proposal.targetMemoryId!, {
      content: proposal.proposedMemory!.content,
      category: proposal.proposedMemory!.category
    }, userId);
    if (!updated) throw new Error("This memory no longer exists");
  } else {
    const existing = getMemory(proposal.targetMemoryId!, userId);
    if (!existing) throw new Error("This memory no longer exists");
    deleteMemory(existing.id, userId);
  }

  return updateMessageAction(actionId, {
    status: "completed",
    proposalState: "approved",
    proposalPayload: proposal,
    proposalUpdatedAt: new Date().toISOString(),
    resultSummary: "Approved"
  });
}
```

```ts
export async function POST(
  request: Request,
  context: { params: Promise<{ actionId: string }> }
) {
  const user = await requireUser();
  const body = approveSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return badRequest("Invalid memory proposal approval");

  try {
    const action = approveMemoryProposal((await context.params).actionId, body.data, user.id);
    return ok({ action });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to approve memory proposal");
  }
}
```

- [ ] **Step 4: Run the proposal tests**

Run:

```bash
npm test -- --run tests/unit/memory-proposals.test.ts
```

Expected: PASS for approve, dismiss, and validation cases.

- [ ] **Step 5: Commit the approval API**

```bash
git add lib/memory-proposals.ts app/api/message-actions/[actionId]/approve/route.ts app/api/message-actions/[actionId]/dismiss/route.ts tests/unit/memory-proposals.test.ts
git commit -m "feat: add memory proposal approval routes"
```

### Task 4: Render and resolve pending proposals in chat

**Files:**
- Modify: `components/message-bubble.tsx`
- Modify: `components/chat-view.tsx`
- Modify: `tests/unit/message-bubble.test.ts`
- Modify: `tests/unit/chat-view.test.ts`

- [ ] **Step 1: Write failing UI tests for proposal cards**

Add the rendering and mutation tests:

```ts
it("renders pending memory proposals with save, ignore, and edit actions", () => {
  render(
    React.createElement(MessageBubble, {
      message: {
        ...createAssistantMessage(),
        actions: [
          {
            id: "act_memory",
            messageId: "msg_assistant",
            kind: "create_memory",
            status: "pending",
            serverId: null,
            skillId: null,
            toolName: "create_memory",
            label: "Save memory",
            detail: "User prefers TypeScript",
            arguments: null,
            resultSummary: "",
            sortOrder: 0,
            startedAt: new Date().toISOString(),
            completedAt: null,
            proposalState: "pending",
            proposalPayload: {
              operation: "create",
              targetMemoryId: null,
              proposedMemory: { content: "User prefers TypeScript", category: "preference" }
            },
            proposalUpdatedAt: null
          }
        ]
      },
      onApproveMemoryProposal: vi.fn(),
      onDismissMemoryProposal: vi.fn()
    })
  );

  expect(screen.getByText("Save memory")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save memory proposal" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ignore memory proposal" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit memory proposal" })).toBeInTheDocument();
});
```

```ts
it("posts approval requests and replaces the pending action with the returned action", async () => {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      action: {
        id: "act_memory",
        status: "completed",
        proposalState: "approved",
        resultSummary: "Approved"
      }
    })
  } as Response);

  renderWithProvider(React.createElement(ChatView, {
    payload: {
      ...createPayload(),
      messages: [{
        ...createAssistantMessage(),
        actions: [pendingCreateProposalAction]
      }]
    }
  }));

  fireEvent.click(screen.getByRole("button", { name: "Save memory proposal" }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/message-actions/act_memory/approve",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the UI tests to confirm they fail**

Run:

```bash
npm test -- --run tests/unit/message-bubble.test.ts tests/unit/chat-view.test.ts
```

Expected: FAIL because `MessageBubble` does not render proposal cards and `ChatView` does not handle proposal approval or dismissal callbacks.

- [ ] **Step 3: Add proposal card rendering and chat mutation wiring**

Update `components/message-bubble.tsx` and `components/chat-view.tsx` with these focused additions:

```tsx
function isPendingMemoryProposal(action: MessageAction) {
  return (
    (action.kind === "create_memory" || action.kind === "update_memory" || action.kind === "delete_memory") &&
    action.status === "pending" &&
    action.proposalState === "pending" &&
    action.proposalPayload
  );
}
```

```tsx
{isPendingMemoryProposal(item) ? (
  <MemoryProposalCard
    key={item.id}
    action={item}
    onApprove={onApproveMemoryProposal}
    onDismiss={onDismissMemoryProposal}
  />
) : (
  <CollapsibleActionRow
    key={item.id}
    action={item}
    isOpen={toolOpenItems[item.id] ?? false}
    onToggle={() => toggleToolItem(item.id)}
  />
)}
```

```ts
async function approveMemoryProposal(actionId: string, payload?: { content?: string; category?: MemoryCategory }) {
  const response = await fetch(`/api/message-actions/${actionId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {})
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Unable to approve memory proposal");

  setMessages((current) =>
    current.map((message) => ({
      ...message,
      actions: (message.actions ?? []).map((action) => action.id === actionId ? data.action : action)
    }))
  );
}
```

- [ ] **Step 4: Re-run the UI tests**

Run:

```bash
npm test -- --run tests/unit/message-bubble.test.ts tests/unit/chat-view.test.ts
```

Expected: PASS with pending cards visible and approval requests updating the in-memory chat state.

- [ ] **Step 5: Commit the chat UI**

```bash
git add components/message-bubble.tsx components/chat-view.tsx tests/unit/message-bubble.test.ts tests/unit/chat-view.test.ts
git commit -m "feat: add inline memory proposal approval cards"
```

### Task 5: Run focused verification and smoke the full feature

**Files:**
- Modify: `tests/unit/message-bubble.test.ts`
- Modify: `tests/unit/chat-view.test.ts`
- Modify: `tests/unit/assistant-runtime.test.ts`
- Modify: `tests/unit/copilot-tools.test.ts`
- Modify: `tests/unit/memory-proposals.test.ts`

- [ ] **Step 1: Run the full focused unit test bundle**

Run:

```bash
npm test -- --run \
  tests/unit/db.test.ts \
  tests/unit/conversations.test.ts \
  tests/unit/assistant-runtime.test.ts \
  tests/unit/copilot-tools.test.ts \
  tests/unit/memory-proposals.test.ts \
  tests/unit/message-bubble.test.ts \
  tests/unit/chat-view.test.ts
```

Expected: PASS for all memory approval tests.

- [ ] **Step 2: Run lint and typecheck**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: both commands succeed with no new diagnostics.

- [ ] **Step 3: Run the chat- and memory-related e2e smoke**

Run:

```bash
npm run test:e2e -- --grep "Chat attachments|Create and delete conversations"
```

Expected: PASS, confirming the feature did not regress core chat flows.

- [ ] **Step 4: Manually validate the memory approval UI in the browser**

Run:

```bash
npm run dev
```

Then use the browser workflow to:

```text
1. Start a chat that is likely to trigger a memory proposal.
2. Confirm the assistant shows an inline memory proposal card.
3. Approve a create proposal and verify it appears in Settings → Memories.
4. Trigger an update or delete proposal and verify Ignore leaves the stored memory unchanged.
5. Take a screenshot of the proposal card for final review.
```

- [ ] **Step 5: Commit the final verified implementation**

```bash
git add lib app components tests
git commit -m "feat: require approval for memory changes"
```

## Self-Review

- Spec coverage:
  Task 1 covers proposal persistence and schema changes.
  Task 2 covers runtime behavior and prompt guidance updates.
  Task 3 covers approval and dismissal APIs plus validation.
  Task 4 covers inline card rendering, edit/save/ignore flows, and client reconciliation.
  Task 5 covers focused verification and manual browser validation.
- Placeholder scan:
  No `TODO`, `TBD`, or “similar to Task N” references remain.
- Type consistency:
  The plan uses `proposalState`, `proposalPayload`, and `proposalUpdatedAt` consistently across persistence, APIs, and UI.
