# Stop Button for Active Chat Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the composer spinner with a stop button that cancels the entire active turn while preserving the partial assistant reply and marking it as stopped in the transcript.

**Architecture:** Add explicit `stopped` terminal states to the chat model and websocket protocol, then introduce a shared turn-control registry that both websocket and HTTP chat flows use to cancel active work cooperatively. The client stops sending new work once cancellation is requested, keeps the partial assistant bubble on screen, and renders a compact stopped indicator plus interrupted action rows after the server finalizes the turn.

**Tech Stack:** TypeScript, Next.js 15 App Router, React 19, `ws`, Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-04-08-stop-stream-button-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `lib/chat-turn-control.ts` | Active turn registry, per-conversation abort controller, `ChatTurnStoppedError`, and stop/register/clear helpers |

### Modified files

| File | Change |
|------|--------|
| `lib/types.ts` | Add `stopped` to `MessageStatus` and `MessageActionStatus`; add any stop-related stream event types if needed |
| `lib/ws-protocol.ts` | Add client `stop` message parsing/serialization support |
| `lib/provider.ts` | Accept external abort signal so provider streaming can be cancelled from the turn registry |
| `lib/assistant-runtime.ts` | Accept cancellation hooks, stop between tool phases, and propagate `ChatTurnStoppedError` cleanly |
| `lib/chat-turn.ts` | Register/clear turn controls, persist partial assistant data on stop, mark active actions/messages as `stopped` |
| `app/api/conversations/[conversationId]/chat/route.ts` | Reuse the shared cancellation-aware turn flow for HTTP streaming |
| `lib/ws-handler.ts` | Handle websocket `stop` messages and resolve them through the turn registry |
| `components/chat-composer.tsx` | Render stop button state instead of spinner when a turn is active |
| `components/chat-view.tsx` | Send stop requests, keep partial streamed content during cancellation, and reconcile stopped messages |
| `components/message-bubble.tsx` | Render stopped assistant indicator and stopped action rows |
| `tests/unit/ws-protocol.test.ts` | Add stop message coverage |
| `tests/unit/assistant-runtime.test.ts` | Verify runtime exits cleanly when cancellation is requested |
| `tests/unit/chat-turn.test.ts` | Verify partial content is persisted and statuses become `stopped` |
| `tests/unit/ws-handler.test.ts` | Verify websocket stop messages hit the turn registry |
| `tests/unit/chat-view.test.ts` | Verify composer sends stop and keeps the partial assistant row visible |
| `tests/unit/message-bubble.test.ts` | Verify stopped indicator and stopped action styling |

---

### Task 1: Add typed stop and stopped-state support

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/ws-protocol.ts`
- Test: `tests/unit/ws-protocol.test.ts`

- [ ] **Step 1: Write the failing protocol test**

Update `tests/unit/ws-protocol.test.ts` with a stop-message assertion:

```typescript
it("serializes and parses a client stop message", async () => {
  const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
  const msg = { type: "stop", conversationId: "conv-1" };
  const raw = serializeClientMessage(msg);
  const parsed = parseClientMessage(raw);
  expect(parsed).toEqual(msg);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/ws-protocol.test.ts`
Expected: FAIL with the stop message parsing to `null` or TypeScript rejecting the new client message type.

- [ ] **Step 3: Implement the type and protocol changes**

Update `lib/types.ts`:

```typescript
export type MessageStatus = "idle" | "streaming" | "completed" | "error" | "stopped";

export type MessageActionStatus = "running" | "completed" | "error" | "stopped";
```

Update `lib/ws-protocol.ts`:

```typescript
export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[]; personaId?: string }
  | { type: "stop"; conversationId: string }
  | { type: "edit"; messageId: string; content: string };

const CLIENT_MESSAGE_TYPES = new Set(["subscribe", "unsubscribe", "message", "stop", "edit"]);
```

- [ ] **Step 4: Run the protocol test again**

Run: `npx vitest run tests/unit/ws-protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/ws-protocol.ts tests/unit/ws-protocol.test.ts
git commit -m "feat: add stopped chat statuses and ws stop message"
```

---

### Task 2: Introduce shared turn cancellation primitives

**Files:**
- Create: `lib/chat-turn-control.ts`
- Modify: `lib/provider.ts`
- Modify: `lib/assistant-runtime.ts`
- Test: `tests/unit/assistant-runtime.test.ts`

- [ ] **Step 1: Write the failing runtime cancellation test**

Add this case to `tests/unit/assistant-runtime.test.ts`:

```typescript
it("stops before executing a tool call when cancellation is requested", async () => {
  const abortController = new AbortController();

  streamProviderResponse.mockReturnValueOnce(
    createProviderStream([], {
      answer: "",
      thinking: "",
      toolCalls: [{ id: "call_1", name: "mcp_mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
      usage: { inputTokens: 9 }
    })
  );

  const { ChatTurnStoppedError, createChatTurnControl } = await import("@/lib/chat-turn-control");
  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");
  const control = createChatTurnControl("conv_1", abortController);
  control.requestStop();

  await expect(resolveAssistantTurn({
    settings: createSettings(),
    promptMessages: [{ role: "user", content: "Find MCP docs" }],
    skills: [],
    mcpToolSets: [],
    abortSignal: abortController.signal,
    throwIfStopped: control.throwIfStopped
  })).rejects.toBeInstanceOf(ChatTurnStoppedError);

  expect(callMcpTool).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the runtime test to verify it fails**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts`
Expected: FAIL because `resolveAssistantTurn` does not yet accept cancellation input or stop before tool execution.

- [ ] **Step 3: Implement the shared control object and thread it into provider/runtime**

Create `lib/chat-turn-control.ts`:

```typescript
export class ChatTurnStoppedError extends Error {
  constructor() {
    super("Chat turn stopped by user");
    this.name = "ChatTurnStoppedError";
  }
}

const activeTurns = new Map<string, ReturnType<typeof createChatTurnControl>>();

export function createChatTurnControl(conversationId: string, abortController = new AbortController()) {
  let stopped = false;

  return {
    conversationId,
    abortController,
    get stopped() {
      return stopped;
    },
    requestStop() {
      stopped = true;
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    },
    throwIfStopped() {
      if (stopped || abortController.signal.aborted) {
        throw new ChatTurnStoppedError();
      }
    }
  };
}

export function registerChatTurn(conversationId: string) {
  const control = createChatTurnControl(conversationId);
  activeTurns.set(conversationId, control);
  return control;
}

export function requestStop(conversationId: string) {
  activeTurns.get(conversationId)?.requestStop();
}

export function clearChatTurn(conversationId: string) {
  activeTurns.delete(conversationId);
}
```

Update `lib/provider.ts` so the input accepts an external signal and reuses it:

```typescript
export async function* streamProviderResponse(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
}) { /* ... */ }

const abortController = new AbortController();
const signal = input.abortSignal ?? abortController.signal;
```

Update `lib/assistant-runtime.ts` so the resolver checks cancellation before each provider loop, before each tool execution, and after answer commits:

```typescript
export async function resolveAssistantTurn(input: {
  /* existing fields */
  abortSignal?: AbortSignal;
  throwIfStopped?: () => void;
}) {
  const assertRunning = () => {
    input.throwIfStopped?.();
    if (input.abortSignal?.aborted) {
      throw new ChatTurnStoppedError();
    }
  };

  for (let step = 0; step < MAX_ASSISTANT_CONTROL_STEPS; step += 1) {
    assertRunning();
    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages,
      tools: tools.length ? tools : undefined,
      abortSignal: input.abortSignal
    });
    /* ... */
    assertRunning();
    for (const toolCall of toolCalls) {
      assertRunning();
      const result = await executeToolCall(toolCall, /* ... */);
      /* ... */
    }
  }
}
```

- [ ] **Step 4: Run the runtime tests again**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat-turn-control.ts lib/provider.ts lib/assistant-runtime.ts tests/unit/assistant-runtime.test.ts
git commit -m "feat: add cancellable chat turn runtime"
```

---

### Task 3: Persist partial stopped turns on the server

**Files:**
- Modify: `lib/chat-turn.ts`
- Modify: `lib/ws-handler.ts`
- Modify: `app/api/conversations/[conversationId]/chat/route.ts`
- Test: `tests/unit/chat-turn.test.ts`
- Test: `tests/unit/ws-handler.test.ts`

- [ ] **Step 1: Write the failing server-side tests**

Add this case to `tests/unit/chat-turn.test.ts`:

```typescript
it("persists a partial assistant message as stopped when the turn is cancelled", async () => {
  vi.useFakeTimers();
  const { streamProviderResponse } = await import("@/lib/provider");
  const { createConversationManager } = await import("@/lib/conversation-manager");
  const { updateSettings } = await import("@/lib/settings");
  const { requestStop } = await import("@/lib/chat-turn-control");

  const manager = createConversationManager();
  const { profileId, profile } = setupProviderProfile();
  updateSettings({ defaultProviderProfileId: profileId, skillsEnabled: false, providerProfiles: [profile] });
  const conv = (await import("@/lib/conversations")).createConversation(undefined, undefined, { providerProfileId: null });

  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  streamProviderResponse.mockReturnValueOnce((async function* () {
    yield { type: "answer_delta", text: "Partial" };
    await gate;
    return { answer: "Partial answer", thinking: "", usage: { outputTokens: 2 } };
  })());

  const { startChatTurn } = await import("@/lib/chat-turn");
  const run = startChatTurn(manager, conv.id, "Hi", []);

  await vi.advanceTimersByTimeAsync(120);
  requestStop(conv.id);
  release();
  await run;

  const { listVisibleMessages } = await import("@/lib/conversations");
  const assistant = listVisibleMessages(conv.id).find((message) => message.role === "assistant");
  expect(assistant?.status).toBe("stopped");
  expect(assistant?.content).toContain("Partial");
  vi.useRealTimers();
});
```

Add this case to `tests/unit/ws-handler.test.ts`:

```typescript
it("routes client stop messages to the turn registry", async () => {
  const requestStop = vi.fn();
  vi.doMock("@/lib/chat-turn-control", () => ({ requestStop }));
  const { verifySessionToken } = await import("@/lib/auth");
  (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

  const { handleConnection } = await import("@/lib/ws-handler");
  const messageHandlers: Array<(data: string) => void> = [];
  const ws = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === "message") messageHandlers.push((d: string) => handler(d));
    })
  } as unknown as WebSocket;

  await handleConnection(ws, "session=valid-token");
  messageHandlers.forEach((handler) => handler(JSON.stringify({ type: "stop", conversationId: "conv-1" })));

  expect(requestStop).toHaveBeenCalledWith("conv-1");
});
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `npx vitest run tests/unit/chat-turn.test.ts tests/unit/ws-handler.test.ts`
Expected: FAIL because there is no registry-backed stop path and stopped turns are still finalized as `completed` or `error`.

- [ ] **Step 3: Implement the registry-backed stop flow in the shared server paths**

Update `lib/chat-turn.ts` to register a control, flush partial buffers, and finalize stopped messages:

```typescript
const control = registerChatTurn(conversationId);
let latestThinking = "";
let latestAnswer = "";
const runningActionHandles = new Set<string>();

try {
  const providerResult = await resolveAssistantTurn({
    /* existing args */
    abortSignal: control.abortController.signal,
    throwIfStopped: control.throwIfStopped,
    onEvent(event) {
      if (event.type === "thinking_delta") latestThinking += event.text;
      if (event.type === "answer_delta") latestAnswer += event.text;
      /* existing broadcast logic */
    },
    onActionStart(action) {
      const persisted = createMessageAction(/* existing fields */);
      runningActionHandles.add(persisted.id);
      return persisted.id;
    },
    onActionComplete(handle, patch) {
      if (handle) runningActionHandles.delete(handle);
      /* existing update logic */
    },
    onActionError(handle, patch) {
      if (handle) runningActionHandles.delete(handle);
      /* existing update logic */
    },
  });

  updateMessage(assistantMessage.id, {
    content: providerResult.answer,
    thinkingContent: providerResult.thinking,
    status: "completed"
  });
} catch (error) {
  if (error instanceof ChatTurnStoppedError) {
    if (flushTimer) clearTimeout(flushTimer);
    flushAnswerBuffer();
    updateMessage(assistantMessage.id, {
      content: latestAnswer,
      thinkingContent: latestThinking,
      status: "stopped"
    });
    for (const handle of runningActionHandles) {
      updateMessageAction(handle, {
        status: "stopped",
        resultSummary: "Stopped by user",
        completedAt: new Date().toISOString()
      });
    }
    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: { type: "done", messageId: assistantMessage.id }
    });
  } else {
    updateMessage(assistantMessage.id, { content: "", thinkingContent: "", status: "error" });
  }
} finally {
  clearChatTurn(conversationId);
  setConversationActive(conversation.id, false);
}
```

Update `lib/ws-handler.ts`:

```typescript
case "stop": {
  requestStop(msg.conversationId);
  break;
}
```

Update `app/api/conversations/[conversationId]/chat/route.ts` so it uses the same control object and stopped finalization branch instead of treating an abort as a generic stream error.

- [ ] **Step 4: Run the server tests again**

Run: `npx vitest run tests/unit/chat-turn.test.ts tests/unit/ws-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat-turn.ts lib/ws-handler.ts app/api/conversations/[conversationId]/chat/route.ts tests/unit/chat-turn.test.ts tests/unit/ws-handler.test.ts
git commit -m "feat: persist stopped chat turns and ws cancel flow"
```

---

### Task 4: Switch the composer to stop mode and render stopped transcript state

**Files:**
- Modify: `components/chat-composer.tsx`
- Modify: `components/chat-view.tsx`
- Modify: `components/message-bubble.tsx`
- Test: `tests/unit/chat-view.test.ts`
- Test: `tests/unit/message-bubble.test.ts`

- [ ] **Step 1: Write the failing UI tests**

Add this case to `tests/unit/chat-view.test.ts`:

```typescript
it("sends a websocket stop message when the active-turn button is clicked", async () => {
  renderWithProvider(React.createElement(ChatView, { payload: createPayload() }));

  await act(async () => {
    wsMock.onMessage?.({
      type: "delta",
      conversationId: "conv_1",
      event: { type: "message_start", messageId: "msg_assistant_1" }
    });
  });

  fireEvent.click(screen.getByRole("button", { name: "Stop response" }));

  expect(wsMock.send).toHaveBeenCalledWith({
    type: "stop",
    conversationId: "conv_1"
  });
});
```

Add this case to `tests/unit/message-bubble.test.ts`:

```typescript
it("renders a stopped badge for interrupted assistant messages", () => {
  render(
    React.createElement(MessageBubble, {
      message: {
        ...createAssistantMessage(),
        status: "stopped",
        content: "Partial answer"
      }
    })
  );

  expect(screen.getByText("Stopped")).toBeInTheDocument();
  expect(screen.getByText("Partial answer")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the UI tests to verify they fail**

Run: `npx vitest run tests/unit/chat-view.test.ts tests/unit/message-bubble.test.ts`
Expected: FAIL because the composer still renders a spinner-only active state and assistant bubbles do not show a stopped indicator.

- [ ] **Step 3: Implement the client stop UX**

Update `components/chat-composer.tsx` to accept stop props and render a stop button:

```typescript
type ChatComposerProps = {
  /* existing props */
  canStop: boolean;
  isStopPending: boolean;
  onStop: () => void | Promise<void>;
};

const showStopButton = canStop && !isUploadingAttachments;

<button
  onClick={() => void (showStopButton ? onStop() : onSubmit())}
  disabled={showStopButton ? isStopPending : isSubmitDisabled}
  aria-label={showStopButton ? "Stop response" : "Send message"}
>
  {showStopButton ? <Square className="h-3.5 w-3.5 fill-current" /> : isUploadingAttachments ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
</button>
```

Update `components/chat-view.tsx` to track `isStopPending`, send `{ type: "stop" }`, and only clear the live stream state when the server snapshot or delta finalizes the message as `stopped`:

```typescript
const [isStopPending, setIsStopPending] = useState(false);

async function stopActiveTurn() {
  if (!streamMessageIdRef.current || isStopPending) return;
  setIsStopPending(true);
  wsSend({ type: "stop", conversationId: payload.conversation.id });
}

if (event.type === "done") {
  setIsStopPending(false);
  /* existing finalize/reset path */
}

if (event.type === "error") {
  setIsStopPending(false);
  /* existing error path */
}
```

Update `components/message-bubble.tsx` so stopped assistant messages show a compact badge and stopped action rows use a neutral interrupted label instead of the red error state:

```typescript
const statusIcon = action.status === "running"
  ? <LoaderCircle className="h-2.5 w-2.5 animate-spin text-white/55" />
  : action.status === "completed"
    ? <Check className="h-2.5 w-2.5 text-emerald-400" />
    : action.status === "stopped"
      ? <Square className="h-2.5 w-2.5 text-amber-300 fill-current" />
      : <X className="h-2.5 w-2.5 text-red-400" />;

{message.status === "stopped" ? (
  <div className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/12 bg-amber-300/8 px-2 py-1 text-[11px] text-amber-100/85">
    <Square className="h-2.5 w-2.5 fill-current" />
    <span>Stopped</span>
  </div>
) : null}
```

- [ ] **Step 4: Run the UI tests again**

Run: `npx vitest run tests/unit/chat-view.test.ts tests/unit/message-bubble.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/chat-composer.tsx components/chat-view.tsx components/message-bubble.tsx tests/unit/chat-view.test.ts tests/unit/message-bubble.test.ts
git commit -m "feat: add stop button and stopped transcript state"
```

---

### Task 5: Verify the full stop flow end-to-end

**Files:**
- Modify: `tests/e2e/features.spec.ts`
- Verify: browser at the dev server URL from `.dev-server`

- [ ] **Step 1: Add an end-to-end regression test**

Append a targeted stop-flow scenario to `tests/e2e/features.spec.ts`:

```typescript
test("user can stop an active response and keep the partial assistant message", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Ask, create, or start a task. Press ⌘ ⏎ to insert a line break...").fill("Explain quantum physics in detail");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByRole("button", { name: "Stop response" })).toBeVisible();
  await page.getByRole("button", { name: "Stop response" }).click();

  await expect(page.getByText("Stopped")).toBeVisible();
  await expect(page.locator('[data-testid="assistant-message-bubble"]')).toHaveCount(1);
});
```

- [ ] **Step 2: Run the focused automated checks**

Run: `npx vitest run tests/unit/ws-protocol.test.ts tests/unit/assistant-runtime.test.ts tests/unit/chat-turn.test.ts tests/unit/ws-handler.test.ts tests/unit/chat-view.test.ts tests/unit/message-bubble.test.ts`
Expected: PASS

Run: `npx playwright test tests/e2e/features.spec.ts --grep "stop"`
Expected: PASS

- [ ] **Step 3: Run manual browser validation**

1. Read `.dev-server`; if missing or stale, start `npm run dev` and wait for `.dev-server`.
2. Open the app URL with the `agent-browser` skill.
3. Send a prompt that streams long enough to stop mid-turn.
4. Click the stop button and verify:
   - the button is actionable, not a spinner
   - the partial assistant content stays visible
   - the assistant message shows `Stopped`
   - a follow-up prompt continues the same conversation normally

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/features.spec.ts
git commit -m "test: cover stop-turn flow"
```

---

## Self-Review

- Spec coverage: Task 1 covers typed stop/stopped states; Task 2 covers shared cancellation control; Task 3 covers persistence, websocket routing, and partial-turn preservation; Task 4 covers composer/transcript UX; Task 5 covers verification.
- Placeholder scan: No `TODO`, `TBD`, or “handle appropriately” placeholders remain.
- Type consistency: The plan consistently uses `stopped` for both `MessageStatus` and `MessageActionStatus`, and `stop` for the client websocket message.
