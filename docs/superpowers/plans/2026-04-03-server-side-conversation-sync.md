# Server-Side Conversation Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all conversation logic, streaming, and state management server-side using WebSocket rooms with incremental DB persistence, enabling seamless multi-client sync and reconnection.

**Architecture:** A custom Node.js server wraps Next.js and hosts a WebSocket server at `/ws`. A `ConversationManager` singleton manages per-conversation rooms of connected clients. The assistant runtime emits events through a typed EventEmitter after each DB write; the ConversationManager broadcasts those events to room subscribers. Clients receive a full DB-backed snapshot on subscribe, then live deltas. Incremental DB writes during streaming ensure reconnection always has current state.

**Tech Stack:** TypeScript, Next.js 15 (App Router, custom server), `ws` (WebSocket library), `better-sqlite3`, React 19, Vitest

**Spec:** `docs/superpowers/specs/2026-04-03-server-side-conversation-sync-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server.ts` | Custom Node.js HTTP server wrapping Next.js, attaching WebSocket server |
| `lib/emitter.ts` | Typed EventEmitter for decoupling runtime from WebSocket layer |
| `lib/ws-protocol.ts` | WebSocket protocol message types (client->server, server->client) |
| `lib/conversation-manager.ts` | Singleton managing rooms (subscribe/unsubscribe/broadcast/snapshot) |
| `lib/ws-handler.ts` | WebSocket connection handler: auth, message routing, event wiring |
| `lib/ws-client.ts` | Client-side WebSocket hook: connect, auth, reconnect, subscribe |
| `tests/unit/emitter.test.ts` | Unit tests for EventEmitter |
| `tests/unit/conversation-manager.test.ts` | Unit tests for ConversationManager |
| `tests/unit/ws-protocol.test.ts` | Unit tests for protocol serialization |
| `tests/unit/ws-handler.test.ts` | Unit tests for ws-handler |

### Modified files

| File | Change |
|------|--------|
| `lib/assistant-runtime.ts` | Emit events via `emitter` after each DB write (answer segments, actions, status) |
| `lib/conversations.ts` | Add `getConversationSnapshot()`, add batched answer segment flushing |
| `app/api/conversations/[conversationId]/chat/route.ts` | Wire `emitter` into existing chat flow, keep SSE working alongside WebSocket |
| `components/chat-view.tsx` | Replace SSE fetch/stream with WebSocket `useWebSocket` hook, remove optimistic message logic and merge reconciliation |
| `package.json` | Add `ws` dependency |
| `tsconfig.json` | Add `ws` type if needed (usually bundled with `@types/ws`) |

### Eventually removed (Phase 3, separate plan)

- `lib/sse.ts`
- `lib/conversation-events.ts`
- `lib/chat-bootstrap.ts`

---

### Task 1: Install `ws` dependency

- [ ] **Step 1: Install ws and its types**

Run: `npm install ws && npm install -D @types/ws`

- [ ] **Step 2: Verify installation**

Run: `npm ls ws @types/ws`
Expected: `ws@x.x.x` and `@types/ws@x.x.x` listed

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add ws dependency for WebSocket support"
```

---

### Task 2: Typed EventEmitter

Create a simple typed EventEmitter that the assistant runtime will use to decouple from the WebSocket layer.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/emitter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("emitter", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("calls listeners when events are emitted", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown]; status: [string, string] }>();
    const listener = vi.fn();
    emitter.on("delta", listener);
    emitter.emit("delta", "conv-1", { type: "answer_delta", text: "hello" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("conv-1", { type: "answer_delta", text: "hello" });
  });

  it("supports multiple listeners for the same event", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    emitter.on("delta", listener1);
    emitter.on("delta", listener2);
    emitter.emit("delta", "conv-1", { type: "test" });
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it("removes listeners via the returned unsubscribe function", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    const listener = vi.fn();
    const unsub = emitter.on("delta", listener);
    unsub();
    emitter.emit("delta", "conv-1", { type: "test" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not throw when emitting to an event with no listeners", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    expect(() => emitter.emit("delta", "conv-1", { type: "test" })).not.toThrow();
  });

  it("removes all listeners via off()", async () => {
    const { createEmitter } = await import("@/lib/emitter");
    const emitter = createEmitter<{ delta: [string, unknown] }>();
    const listener = vi.fn();
    emitter.on("delta", listener);
    emitter.off("delta");
    emitter.emit("delta", "conv-1", { type: "test" });
    expect(listener).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/emitter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the EventEmitter**

Create `lib/emitter.ts`:

```typescript
type EventMap = Record<string, unknown[]>;

export type EmitterEvents<T extends EventMap> = {
  [K in keyof T]: T[K];
};

type Listener<T extends unknown[]> = (...args: T) => void;

export function createEmitter<T extends EventMap>() {
  const listeners = new Map<keyof T, Set<Listener<T[keyof T]>>>();

  function on<K extends keyof T>(event: K, listener: Listener<T[K]>): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener as Listener<T[keyof T]>);
    return () => {
      set!.delete(listener as Listener<T[keyof T]>);
    };
  }

  function off<K extends keyof T>(event: K) {
    listeners.delete(event);
  }

  function emit<K extends keyof T>(event: K, ...args: T[K]) {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as Listener<T[K]>)(...args);
    }
  }

  return { on, off, emit };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/emitter.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/emitter.ts tests/unit/emitter.test.ts
git commit -m "feat: add typed EventEmitter for runtime decoupling"
```

---

### Task 3: WebSocket Protocol Types

Define the typed protocol messages for client->server and server->client communication.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ws-protocol.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("ws-protocol", () => {
  it("serializes and parses a client subscribe message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "subscribe", conversationId: "conv-1" };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("serializes and parses a client message message", async () => {
    const { serializeClientMessage, parseClientMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "message", conversationId: "conv-1", content: "hello", attachmentIds: ["att-1"] };
    const raw = serializeClientMessage(msg);
    const parsed = parseClientMessage(raw);
    expect(parsed).toEqual(msg);
  });

  it("serializes a server ready message", async () => {
    const { serializeServerMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "ready", activeConversations: [{ id: "conv-1", title: "Test", status: "streaming" as const }] };
    const raw = serializeServerMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("ready");
    expect(parsed.activeConversations).toHaveLength(1);
  });

  it("serializes a server delta message", async () => {
    const { serializeServerMessage } = await import("@/lib/ws-protocol");
    const msg = { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hello" } };
    const raw = serializeServerMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("delta");
    expect(parsed.event.type).toBe("answer_delta");
  });

  it("returns null for invalid client message JSON", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");
    expect(parseClientMessage("not json")).toBeNull();
  });

  it("returns null for unknown client message type", async () => {
    const { parseClientMessage } = await import("@/lib/ws-protocol");
    expect(parseClientMessage(JSON.stringify({ type: "unknown" }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ws-protocol.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement protocol types**

Create `lib/ws-protocol.ts`:

```typescript
import type { ChatStreamEvent } from "@/lib/types";

export type ClientMessage =
  | { type: "subscribe"; conversationId: string }
  | { type: "unsubscribe"; conversationId: string }
  | { type: "message"; conversationId: string; content: string; attachmentIds?: string[] }
  | { type: "edit"; messageId: string; content: string };

export type ServerMessage =
  | { type: "ready"; activeConversations: { id: string; title: string; status: string }[] }
  | { type: "snapshot"; conversationId: string; messages: unknown[]; actions: unknown[]; segments: unknown[] }
  | { type: "delta"; conversationId: string; event: ChatStreamEvent }
  | { type: "error"; message: string };

export function serializeClientMessage(msg: ClientMessage): string {
  return JSON.stringify(msg);
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

const CLIENT_MESSAGE_TYPES = new Set(["subscribe", "unsubscribe", "message", "edit"]);

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !CLIENT_MESSAGE_TYPES.has(parsed.type)) {
      return null;
    }
    return parsed as ClientMessage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ws-protocol.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/ws-protocol.ts tests/unit/ws-protocol.test.ts
git commit -m "feat: add WebSocket protocol message types"
```

---

### Task 4: ConversationManager

Create the singleton that manages per-conversation rooms, tracks active turns, and broadcasts events.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/conversation-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

function createMockWs(): { ws: WebSocket; sent: unknown[] } {
  const sent: unknown[] = [];
  const ws = { send: vi.fn((data: string) => sent.push(JSON.parse(data))) } as unknown as WebSocket;
  return { ws, sent };
}

describe("conversation-manager", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("tracks subscriptions and broadcasts to room members", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ws1, sent: sent1 } = createMockWs();
    const { ws: ws2, sent: sent2 } = createMockWs();

    manager.subscribe("conv-1", ws1);
    manager.subscribe("conv-1", ws2);
    manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hi" } });

    expect(sent1).toHaveLength(1);
    expect(sent2).toHaveLength(1);
    expect((sent1[0] as { type: string }).type).toBe("delta");
  });

  it("does not broadcast to unsubscribed clients", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ws1, sent: sent1 } = createMockWs();
    const { ws: ws2 } = createMockWs();

    manager.subscribe("conv-1", ws1);
    manager.subscribe("conv-2", ws2);
    manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hi" } });

    expect(sent1).toHaveLength(1);
  });

  it("broadcast is a no-op when room has no subscribers", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    expect(() => manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "hi" } })).not.toThrow();
  });

  it("removes client from all rooms on disconnect", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();
    const { ws: ws1, sent: sent1 } = createMockWs();
    const { ws: ws2, sent: sent2 } = createMockWs();

    manager.subscribe("conv-1", ws1);
    manager.subscribe("conv-2", ws1);
    manager.subscribe("conv-1", ws2);

    manager.disconnect(ws1);
    manager.broadcast("conv-1", { type: "delta", conversationId: "conv-1", event: { type: "answer_delta", text: "after" } });
    manager.broadcast("conv-2", { type: "delta", conversationId: "conv-2", event: { type: "answer_delta", text: "after" } });

    expect(sent1).toHaveLength(0);
    expect(sent2).toHaveLength(1);
  });

  it("tracks and reports active turns", async () => {
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const manager = createConversationManager();

    expect(manager.isActive("conv-1")).toBe(false);
    manager.setActive("conv-1", true);
    expect(manager.isActive("conv-1")).toBe(true);
    manager.setActive("conv-1", false);
    expect(manager.isActive("conv-1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/conversation-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the ConversationManager**

Create `lib/conversation-manager.ts`:

```typescript
import type { ServerMessage } from "@/lib/ws-protocol";
import { serializeServerMessage } from "@/lib/ws-protocol";

export function createConversationManager() {
  const rooms = new Map<string, Set<WebSocket>>();
  const clientRooms = new Map<WebSocket, Set<string>>();
  const activeTurns = new Map<string, boolean>();

  function subscribe(conversationId: string, ws: WebSocket) {
    if (!rooms.has(conversationId)) {
      rooms.set(conversationId, new Set());
    }
    rooms.get(conversationId)!.add(ws);

    if (!clientRooms.has(ws)) {
      clientRooms.set(ws, new Set());
    }
    clientRooms.get(ws)!.add(conversationId);
  }

  function unsubscribe(conversationId: string, ws: WebSocket) {
    const room = rooms.get(conversationId);
    if (room) {
      room.delete(ws);
      if (room.size === 0) rooms.delete(conversationId);
    }
    const subs = clientRooms.get(ws);
    if (subs) subs.delete(conversationId);
  }

  function broadcast(conversationId: string, event: ServerMessage) {
    const room = rooms.get(conversationId);
    if (!room) return;
    const raw = serializeServerMessage(event);
    for (const ws of room) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  function disconnect(ws: WebSocket) {
    const subs = clientRooms.get(ws);
    if (!subs) return;
    for (const conversationId of subs) {
      const room = rooms.get(conversationId);
      if (room) {
        room.delete(ws);
        if (room.size === 0) rooms.delete(conversationId);
      }
    }
    clientRooms.delete(ws);
  }

  function isActive(conversationId: string): boolean {
    return activeTurns.get(conversationId) === true;
  }

  function setActive(conversationId: string, active: boolean) {
    if (active) {
      activeTurns.set(conversationId, true);
    } else {
      activeTurns.delete(conversationId);
    }
  }

  function getActiveConversationIds(): string[] {
    return [...activeTurns.keys()];
  }

  return { subscribe, unsubscribe, broadcast, disconnect, isActive, setActive, getActiveConversationIds };
}

export type ConversationManager = ReturnType<typeof createConversationManager>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/conversation-manager.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/conversation-manager.ts tests/unit/conversation-manager.test.ts
git commit -m "feat: add ConversationManager for room-based event broadcasting"
```

---

### Task 5: Conversation Snapshot Query

Add a `getConversationSnapshot()` function to `lib/conversations.ts` that returns the full current state of a conversation suitable for sending to a reconnecting client.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/conversations.test.ts` (or create a new test block at the end):

```typescript
it("returns a snapshot with messages, actions, and segments for an in-progress conversation", async () => {
  const { getConversation, createMessage, createMessageTextSegment, createMessageAction, getConversationSnapshot } = await import("@/lib/conversations");

  const conv = createConversation({ providerProfileId: null });
  const userMsg = createMessage({ conversationId: conv.id, role: "user", content: "Hello" });
  const assistantMsg = createMessage({ conversationId: conv.id, role: "assistant", content: "", status: "streaming" });
  createMessageTextSegment({ messageId: assistantMsg.id, content: "partial answer" });
  createMessageAction({ messageId: assistantMsg.id, kind: "mcp_tool_call", label: "Search", status: "running" });

  const snapshot = getConversationSnapshot(conv.id);

  expect(snapshot.conversation.id).toBe(conv.id);
  expect(snapshot.messages).toHaveLength(2);
  expect(snapshot.messages[0].role).toBe("user");
  expect(snapshot.messages[1].status).toBe("streaming");
  expect(snapshot.messages[1].textSegments).toHaveLength(1);
  expect(snapshot.messages[1].textSegments![0].content).toBe("partial answer");
  expect(snapshot.messages[1].actions).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/conversations.test.ts`
Expected: FAIL — `getConversationSnapshot` is not exported

- [ ] **Step 3: Implement the snapshot query**

Add to `lib/conversations.ts` after the existing `listVisibleMessages` function (around line 820):

```typescript
export type ConversationSnapshot = {
  conversation: Conversation;
  messages: Message[];
};

export function getConversationSnapshot(conversationId: string): ConversationSnapshot | null {
  const conversation = getConversation(conversationId);
  if (!conversation) return null;
  const messages = listVisibleMessages(conversationId);
  return { conversation, messages };
}
```

This reuses the existing `listVisibleMessages` which already hydrates `actions`, `textSegments`, and `attachments` on each message. No new SQL needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/conversations.test.ts`
Expected: All PASS (including the new test)

- [ ] **Step 5: Commit**

```bash
git add lib/conversations.ts tests/unit/conversations.test.ts
git commit -m "feat: add getConversationSnapshot for WebSocket reconnection"
```

---

### Task 6: Custom Server Entrypoint

Create `server.ts` that wraps Next.js in a Node.js HTTP server with a WebSocket server attached. The Dockerfile already references `CMD ["node", "server.js"]`.

- [ ] **Step 1: Create the server entrypoint**

Create `server.ts`:

```typescript
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWebSocketHandler } from "@/lib/ws-handler";

const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev: process.env.NODE_ENV !== "production" });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  setupWebSocketHandler(wss);

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
```

- [ ] **Step 2: Add WebSocket type declaration**

Add to `next-env.d.ts` (or create a `global.d.ts` if it doesn't exist in next-env.d.ts):

```typescript
declare class WebSocket {
  static OPEN: number;
  static CLOSING: number;
  static CLOSED: number;
  readyState: number;
  send(data: string | BufferLike): void;
  close(code?: number, reason?: string): void;
  addEventListener(event: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
}
```

Note: `@types/ws` should provide this globally. If not, this declaration ensures TypeScript doesn't error. Verify after installing `@types/ws` in Task 1.

- [ ] **Step 3: Verify the server starts**

Run: `npx tsx server.ts` (or `npm run dev` if configured)
Expected: Server starts without errors, logs `> Ready on http://localhost:3000`

Stop the server after verifying.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: add custom server entrypoint with WebSocket support"
```

---

### Task 7: WebSocket Handler

Create the connection handler that authenticates clients, routes messages, and wires the ConversationManager to the emitter.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/ws-handler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  verifySessionToken: vi.fn()
}));

vi.mock("@/lib/conversations", () => ({
  getConversationSnapshot: vi.fn(),
  listActiveConversations: vi.fn(),
  createMessage: vi.fn(),
  createConversation: vi.fn(),
  getConversation: vi.fn()
}));

describe("ws-handler", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("sends an error and closes the connection when auth fails", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, "session=invalid");

    expect(ws.close).toHaveBeenCalled();
    const error = JSON.parse(sent.find(s => JSON.parse(s).type === "error")!);
    expect(error.type).toBe("error");
  });

  it("sends ready and handles subscribe", async () => {
    const { verifySessionToken } = await import("@/lib/auth");
    (verifySessionToken as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" });

    const { getConversationSnapshot, listActiveConversations } = await import("@/lib/conversations");
    (listActiveConversations as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (getConversationSnapshot as ReturnType<typeof vi.fn>).mockReturnValue({
      conversation: { id: "conv-1", title: "Test", is_active: false },
      messages: []
    });

    const { handleConnection } = await import("@/lib/ws-handler");
    const sent: string[] = [];
    const messageHandlers: Array<(data: string) => void> = [];
    const ws = {
      readyState: 1,
      send: vi.fn((data: string) => sent.push(data)),
      close: vi.fn(),
      addEventListener: vi.fn((_event: string, handler: (...args: unknown[]) => void) => {
        if (_event === "message") messageHandlers.push((d: string) => handler({ data: d }));
      }),
      removeEventListener: vi.fn()
    } as unknown as WebSocket;

    await handleConnection(ws, "session=valid-token");

    const ready = JSON.parse(sent.find(s => JSON.parse(s).type === "ready")!);
    expect(ready.type).toBe("ready");

    const subscribeMsg = JSON.stringify({ type: "subscribe", conversationId: "conv-1" });
    for (const handler of messageHandlers) handler(subscribeMsg);

    const snapshot = JSON.parse(sent.find(s => JSON.parse(s).type === "snapshot")!);
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.conversationId).toBe("conv-1");
    expect(getConversationSnapshot).toHaveBeenCalledWith("conv-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ws-handler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Add `verifySessionToken` to auth.ts**

Add a new export to `lib/auth.ts` that verifies a raw JWT token string (not from cookies — needed because WebSocket upgrade requests don't go through Next.js cookie parsing). Add after `getSessionPayload` (around line 220):

```typescript
export async function verifySessionToken(token: string): Promise<{ sessionId: string; userId: string } | null> {
  if (!token) return null;
  try {
    const result = await jwtVerify(token, getSessionSecret());
    return { sessionId: result.payload.sid as string, userId: result.payload.uid as string };
  } catch {
    return null;
  }
}
```

Also export from `lib/auth.ts`: the `SESSION_COOKIE_NAME` from `lib/constants.ts` is already used by the handler. No need to re-export it — the handler can import directly from `@/lib/constants`.

- [ ] **Step 4: Add `listActiveConversations` to conversations.ts**

Add to `lib/conversations.ts`:

```typescript
export function listActiveConversations(): Pick<Conversation, "id" | "title" | "is_active">[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, title, is_active FROM conversations WHERE is_active = 1 ORDER BY updated_at DESC")
    .all() as Array<{ id: string; title: string; is_active: number }>;
  return rows.map(r => ({ id: r.id, title: r.title, is_active: Boolean(r.is_active) }));
}
```

- [ ] **Step 5: Implement the ws-handler**

Create `lib/ws-handler.ts`:

```typescript
import type WebSocket from "ws";
import type { WebSocketServer } from "ws";
import { verifySessionToken } from "@/lib/auth";
import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { getConversationSnapshot, listActiveConversations } from "@/lib/conversations";
import { createConversationManager, type ConversationManager } from "@/lib/conversation-manager";
import { parseClientMessage, serializeServerMessage } from "@/lib/ws-protocol";
import type { ClientMessage } from "@/lib/ws-protocol";

let manager: ConversationManager | null = null;

function getManager(): ConversationManager {
  if (!manager) {
    manager = createConversationManager();
  }
  return manager;
}

function extractToken(req: import("http").IncomingMessage): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

export function setupWebSocketHandler(wss: WebSocketServer) {
  wss.on("connection", async (ws, req) => {
    const token = extractToken(req);
    await handleConnection(ws, token);
  });
}

export async function handleConnection(ws: WebSocket, token: string | null) {
  if (!token) {
    ws.send(serializeServerMessage({ type: "error", message: "Authentication required" }));
    ws.close();
    return;
  }

  const session = await verifySessionToken(token);
  if (!session) {
    ws.send(serializeServerMessage({ type: "error", message: "Invalid session" }));
    ws.close();
    return;
  }

  const mgr = getManager();
  const currentSubscription = new Set<string>();

  const active = listActiveConversations();
  ws.send(serializeServerMessage({
    type: "ready",
    activeConversations: active.map(c => ({
      id: c.id,
      title: c.title,
      status: c.is_active ? "streaming" : "idle"
    }))
  }));

  ws.addEventListener("message", (event: { data: WebSocket.Data }) => {
    const msg = parseClientMessage(event.data.toString());
    if (!msg) return;
    handleMessage(mgr, ws, msg, currentSubscription);
  });

  ws.addEventListener("close", () => {
    for (const conversationId of currentSubscription) {
      mgr.unsubscribe(conversationId, ws);
    }
    mgr.disconnect(ws);
  });
}

function handleMessage(
  mgr: ConversationManager,
  ws: WebSocket,
  msg: ClientMessage,
  currentSubscription: Set<string>
) {
  switch (msg.type) {
    case "subscribe": {
      currentSubscription.add(msg.conversationId);
      mgr.subscribe(msg.conversationId, ws);
      const snapshot = getConversationSnapshot(msg.conversationId);
      if (snapshot) {
        ws.send(serializeServerMessage({
          type: "snapshot",
          conversationId: msg.conversationId,
          messages: snapshot.messages,
          actions: snapshot.messages.flatMap(m => m.actions ?? []),
          segments: snapshot.messages.flatMap(m => m.textSegments ?? [])
        }));
      }
      break;
    }
    case "unsubscribe": {
      currentSubscription.delete(msg.conversationId);
      mgr.unsubscribe(msg.conversationId, ws);
      break;
    }
    case "message": {
      handleUserMessage(mgr, msg);
      break;
    }
    case "edit": {
      // TODO: implement edit/reshape in a future task
      break;
    }
  }
}

async function handleUserMessage(
  mgr: ConversationManager,
  msg: { type: "message"; conversationId: string; content: string; attachmentIds?: string[] }
) {
  const { startChatTurn } = await import("@/lib/chat-turn");
  startChatTurn(mgr, msg.conversationId, msg.content, msg.attachmentIds ?? []);
}
```

Note: `handleUserMessage` delegates to a new `lib/chat-turn.ts` module (created in Task 8). This keeps the ws-handler focused on connection management.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ws-handler.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add lib/ws-handler.ts lib/auth.ts lib/conversations.ts tests/unit/ws-handler.test.ts
git commit -m "feat: add WebSocket handler with auth and message routing"
```

---

### Task 8: Chat Turn Execution (Wire Emitter into Assistant Runtime)

Create `lib/chat-turn.ts` that orchestrates a chat turn: creates messages in DB, calls `resolveAssistantTurn`, emits events via the global emitter, and writes to the DB incrementally. This replaces the inline logic currently in `chat/route.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/chat-turn.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/provider", () => ({
  streamProviderResponse: vi.fn()
}));

vi.mock("@/lib/mcp-client", () => ({
  gatherAllMcpTools: vi.fn().mockResolvedValue([])
}));

describe("chat-turn", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it("creates user and assistant messages, streams deltas via emitter", async () => {
    const { streamProviderResponse } = await import("@/lib/provider");
    const { createConversationManager } = await import("@/lib/conversation-manager");
    const { createEmitter } = await import("@/lib/emitter");

    const manager = createConversationManager();
    const emitter = createEmitter<{
      delta: [string, unknown];
      status: [string, string];
    }>();

    const events: unknown[] = [];
    emitter.on("delta", (conversationId, event) => events.push({ conversationId, event }));

    const mockWs = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    manager.subscribe("conv-1", mockWs);

    const conv = (await import("@/lib/conversations")).createConversation({ providerProfileId: null });

    streamProviderResponse.mockReturnValueOnce(
      (async function* () {
        yield { type: "answer_delta", text: "Hello" };
        return { answer: "Hello", thinking: "", usage: { outputTokens: 1 } };
      })()
    );

    const { startChatTurn } = await import("@/lib/chat-turn");
    await startChatTurn(manager, conv.id, "Hi", []);

    const deltaEvents = events.filter(e => (e.event as { type: string }).type === "answer_delta");
    expect(deltaEvents.length).toBeGreaterThan(0);

    const { listVisibleMessages } = await import("@/lib/conversations");
    const messages = listVisibleMessages(conv.id);
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/chat-turn.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the global emitter instance and chat-turn module**

Create `lib/chat-turn.ts`:

```typescript
import { resolveAssistantTurn } from "@/lib/assistant-runtime";
import {
  bindAttachmentsToMessage,
  createMessage,
  createMessageTextSegment,
  createMessageAction,
  generateConversationTitleFromFirstUserMessage,
  getConversation,
  setConversationActive,
  updateMessage,
  updateMessageAction
} from "@/lib/conversations";
import { ensureCompactedContext } from "@/lib/compaction";
import { estimateTextTokens } from "@/lib/tokenization";
import { listEnabledMcpServers } from "@/lib/mcp-servers";
import { listEnabledSkills } from "@/lib/skills";
import {
  getSettings,
  getDefaultProviderProfileWithApiKey,
  getProviderProfileWithApiKey
} from "@/lib/settings";
import { createEmitter } from "@/lib/emitter";
import type { ChatStreamEvent } from "@/lib/types";
import type { ConversationManager } from "@/lib/conversation-manager";

export type ChatEmitter = ReturnType<typeof createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>>;

const globalEmitter = createEmitter<{
  delta: [string, unknown];
  status: [string, string];
}>();

export function getChatEmitter(): ChatEmitter {
  return globalEmitter;
}

export async function startChatTurn(
  manager: ConversationManager,
  conversationId: string,
  content: string,
  attachmentIds: string[]
) {
  const conversation = getConversation(conversationId);
  if (!conversation) return;

  const settings =
    (conversation.providerProfileId
      ? getProviderProfileWithApiKey(conversation.providerProfileId)
      : null) ?? getDefaultProviderProfileWithApiKey();
  const appSettings = getSettings();

  if (!settings?.apiKey) {
    manager.broadcast(conversationId, {
      type: "error",
      message: "Set an API key in settings before starting a chat"
    });
    return;
  }

  const userMessage = createMessage({
    conversationId: conversation.id,
    role: "user",
    content,
    estimatedTokens: estimateTextTokens(content)
  });

  bindAttachmentsToMessage(conversation.id, userMessage.id, attachmentIds);
  void generateConversationTitleFromFirstUserMessage(conversation.id, userMessage.id);

  const assistantMessage = createMessage({
    conversationId: conversation.id,
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

  manager.setActive(conversationId, true);
  globalEmitter.emit("status", conversationId, "streaming");

  setConversationActive(conversation.id, true);

  try {
    const compacted = await ensureCompactedContext(conversation.id, settings);
    let promptMessages = compacted.promptMessages;
    const skills = appSettings.skillsEnabled ? listEnabledSkills() : [];
    const mcpServers = listEnabledMcpServers();

    let mcpToolSets: Array<{
      server: (typeof mcpServers)[number];
      tools: Awaited<ReturnType<typeof import("@/lib/mcp-client")["discoverMcpTools"]>>;
    }> = [];
    if (mcpServers.length) {
      const { gatherAllMcpTools } = await import("@/lib/mcp-client");
      mcpToolSets = await gatherAllMcpTools(mcpServers, conversation.toolExecutionMode);
    }

    if (compacted.compactionNoticeEvent) {
      manager.broadcast(conversationId, {
        type: "delta",
        conversationId,
        event: compacted.compactionNoticeEvent
      });
    }

    let timelineSortOrder = 0;

    const providerResult = await resolveAssistantTurn({
      settings,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      onEvent(event: ChatStreamEvent) {
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event
        });
        globalEmitter.emit("delta", conversationId, event);
      },
      onAnswerSegment(segment) {
        createMessageTextSegment({
          messageId: assistantMessage.id,
          content: segment,
          sortOrder: timelineSortOrder++
        });
      },
      onActionStart(action) {
        const persisted = createMessageAction({
          messageId: assistantMessage.id,
          kind: action.kind,
          label: action.label,
          detail: action.detail,
          serverId: action.serverId,
          skillId: action.skillId,
          toolName: action.toolName,
          arguments: action.arguments,
          sortOrder: timelineSortOrder++
        });
        manager.broadcast(conversationId, {
          type: "delta",
          conversationId,
          event: { type: "action_start", action: persisted }
        });
        globalEmitter.emit("delta", conversationId, { type: "action_start", action: persisted });
        return persisted.id;
      },
      onActionComplete(handle, patch) {
        if (!handle) return;
        const updated = updateMessageAction(handle, {
          status: "completed",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          manager.broadcast(conversationId, {
            type: "delta",
            conversationId,
            event: { type: "action_complete", action: updated }
          });
          globalEmitter.emit("delta", conversationId, { type: "action_complete", action: updated });
        }
      },
      onActionError(handle, patch) {
        if (!handle) return;
        const updated = updateMessageAction(handle, {
          status: "error",
          detail: patch.detail,
          resultSummary: patch.resultSummary,
          completedAt: new Date().toISOString()
        });
        if (updated) {
          manager.broadcast(conversationId, {
            type: "delta",
            conversationId,
            event: { type: "action_error", action: updated }
          });
          globalEmitter.emit("delta", conversationId, { type: "action_error", action: updated });
        }
      }
    });

    updateMessage(assistantMessage.id, {
      content: providerResult.answer,
      thinkingContent: providerResult.thinking,
      status: "completed",
      estimatedTokens:
        (providerResult.usage.inputTokens ?? 0) +
        (providerResult.usage.outputTokens ?? 0) +
        (providerResult.usage.reasoningTokens ?? 0)
    });

    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: { type: "done", messageId: assistantMessage.id }
    });
  } catch (error) {
    const partialAnswer = ""; // In future, accumulate from segments
    updateMessage(assistantMessage.id, {
      content: partialAnswer,
      thinkingContent: "",
      status: "error"
    });
    manager.broadcast(conversationId, {
      type: "delta",
      conversationId,
      event: {
        type: "error",
        message: error instanceof Error ? error.message : "Chat stream failed"
      }
    });
  } finally {
    setConversationActive(conversation.id, false);
    manager.setActive(conversationId, false);
    globalEmitter.emit("status", conversationId, "completed");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chat-turn.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat-turn.ts tests/unit/chat-turn.test.ts
git commit -m "feat: add chat-turn module with emitter-based event broadcasting"
```

---

### Task 8.5: Periodic Answer Flushing for Incremental Persistence

Currently, answer text is only written to the DB when `commitAnswerSegment` is called — at the end of a stream or when tool calls arrive. During a streaming response with no tool calls, a reconnecting client would see the assistant message with `status: "streaming"` but empty content. This task adds periodic flushing so the snapshot always has current partial content.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/chat-turn.test.ts`:

```typescript
it("flushes answer text to DB periodically during streaming", async () => {
  vi.useFakeTimers();
  const { streamProviderResponse } = await import("@/lib/provider");
  const { createConversationManager } = await import("@/lib/conversation-manager");

  const manager = createConversationManager();
  let resolveStream: () => void;
  const gate = new Promise<void>((resolve) => { resolveStream = resolve; });

  const conv = (await import("@/lib/conversations")).createConversation({ providerProfileId: null });

  streamProviderResponse.mockReturnValueOnce(
    (async function* () {
      yield { type: "answer_delta", text: "Hello" };
      yield { type: "answer_delta", text: " world" };
      await gate;
      return { answer: "Hello world", thinking: "", usage: { outputTokens: 2 } };
    })()
  );

  const { startChatTurn } = await import("@/lib/chat-turn");
  const pending = startChatTurn(manager, conv.id, "Hi", []);

  await vi.advanceTimersByTimeAsync(200);
  resolveStream!();
  await pending;

  const { getConversationSnapshot } = await import("@/lib/conversations");
  const snapshot = getConversationSnapshot(conv.id);
  const assistantMsg = snapshot!.messages.find(m => m.role === "assistant");

  expect(assistantMsg!.textSegments!.length).toBeGreaterThan(0);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/chat-turn.test.ts`
Expected: FAIL — textSegments is empty (no periodic flush)

- [ ] **Step 3: Add periodic flushing to chat-turn.ts**

Modify `lib/chat-turn.ts`. In the `onEvent` callback, accumulate answer deltas and flush periodically:

Add state before the try block:

```typescript
let answerBuffer = "";
let lastFlush = Date.now();
let flushSortOrder = 0;
```

Update the `onEvent` callback to accumulate and flush:

```typescript
onEvent(event: ChatStreamEvent) {
  manager.broadcast(conversationId, {
    type: "delta",
    conversationId,
    event
  });
  globalEmitter.emit("delta", conversationId, event);

  if (event.type === "answer_delta") {
    answerBuffer += event.text;
    const now = Date.now();
    if (now - lastFlush >= 100 || answerBuffer.length >= 500) {
      flushAnswerBuffer();
      lastFlush = now;
    }
  }
},
```

Add the flush function (before the try block):

```typescript
function flushAnswerBuffer() {
  if (!answerBuffer) return;
  createMessageTextSegment({
    messageId: assistantMessage.id,
    content: answerBuffer,
    sortOrder: timelineSortOrder++
  });
  answerBuffer = "";
}
```

At the end of `resolveAssistantTurn` (before the `updateMessage` call), flush any remaining buffer:

```typescript
flushAnswerBuffer();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/chat-turn.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add lib/chat-turn.ts tests/unit/chat-turn.test.ts
git commit -m "feat: add periodic answer flushing for incremental DB persistence"
```

---

### Task 9: Update Next.js Config for Custom Server

Update `next.config.ts` and `package.json` to support the custom server in dev mode.

- [ ] **Step 1: Update next.config.ts**

The current config only has `output: "standalone"`. In dev mode, `next dev` doesn't use the custom server — WebSocket support is only available in production. For dev mode with WebSocket support, the user runs `npx tsx server.ts` with `NODE_ENV=development`. No changes needed to `next.config.ts`.

However, the `output: "standalone"` setting produces a standalone build. The custom server in `server.ts` uses `next()` which works with standalone mode. No config changes required.

- [ ] **Step 2: Add dev script to package.json**

Add to `scripts` in `package.json`:

```json
"dev:ws": "tsx server.ts"
```

This allows `npm run dev:ws` to run the custom server with hot-reload via tsx.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add dev:ws script for WebSocket development mode"
```

---

### Task 10: Client-Side WebSocket Hook

Create a React hook that manages the WebSocket connection, handles reconnection, and provides subscribe/unsubscribe functionality.

- [ ] **Step 1: Create the useWebSocket hook**

Create `lib/ws-client.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerMessage } from "@/lib/ws-protocol";
import { serializeClientMessage, type ClientMessage } from "@/lib/ws-protocol";

type UseWebSocketOptions = {
  onMessage?: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
};

type UseWebSocketReturn = {
  send: (msg: ClientMessage) => void;
  subscribe: (conversationId: string) => void;
  unsubscribe: (conversationId: string) => void;
  connected: boolean;
};

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttemptsRef = useRef(0);
  const currentSubscriptionRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const MAX_RECONNECT_DELAY = 30000;

  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setConnected(true);
      reconnectAttemptsRef.current = 0;
      optionsRef.current.onOpen?.();
      if (currentSubscriptionRef.current) {
        ws.send(serializeClientMessage({ type: "subscribe", conversationId: currentSubscriptionRef.current }));
      }
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data.toString()) as ServerMessage;
        optionsRef.current.onMessage?.(msg);
      } catch { /* ignore malformed messages */ }
    });

    ws.addEventListener("close", () => {
      setConnected(false);
      wsRef.current = null;
      optionsRef.current.onClose?.();
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), MAX_RECONNECT_DELAY);
    reconnectAttemptsRef.current++;
    reconnectTimeoutRef.current = setTimeout(connect, delay);
  }

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(serializeClientMessage(msg));
    }
  }, []);

  const subscribe = useCallback((conversationId: string) => {
    currentSubscriptionRef.current = conversationId;
    send({ type: "subscribe", conversationId });
  }, [send]);

  const unsubscribe = useCallback((conversationId: string) => {
    if (currentSubscriptionRef.current === conversationId) {
      currentSubscriptionRef.current = null;
    }
    send({ type: "unsubscribe", conversationId });
  }, [send]);

  return { send, subscribe, unsubscribe, connected };
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/ws-client.ts
git commit -m "feat: add useWebSocket hook with auto-reconnect"
```

---

### Task 11: Integrate WebSocket into Chat View

Modify `components/chat-view.tsx` to use the WebSocket hook instead of SSE, removing the optimistic message logic and merge reconciliation.

This is the largest change. Key modifications:

- [ ] **Step 1: Add WebSocket imports and hook to chat-view.tsx**

At the top of `chat-view.tsx`, add:

```typescript
import { useWebSocket } from "@/lib/ws-client";
import type { ServerMessage } from "@/lib/ws-protocol";
```

- [ ] **Step 2: Replace the SSE submit handler with WebSocket message**

Replace the `handleSubmit` function (lines ~570-800) with a simplified version that:

1. Calls `wsSend({ type: "message", conversationId, content, attachmentIds })` instead of `fetch()`
2. Does NOT create optimistic messages
3. Does NOT parse SSE chunks
4. Does NOT call `syncConversationState()`

The new submit handler:

```typescript
function handleSubmit(value: string) {
  if (!value.trim() && nextPendingAttachments.length === 0) return;
  wsSend({
    type: "message",
    conversationId: payload.conversation.id,
    content: value,
    attachmentIds: nextPendingAttachments.map(a => a.id)
  });
  setNextPendingAttachments([]);
}
```

- [ ] **Step 3: Replace optimistic state with snapshot-driven state**

Replace the state initialization from `payload.messages` (which comes from SSR) with a WebSocket-driven approach:

1. On `snapshot` message: set messages from the snapshot data
2. On `delta` message of type `message_start`: add a new streaming assistant message to state
3. On `delta` of type `thinking_delta`: update the streaming assistant's thinking
4. On `delta` of type `answer_delta`: update the streaming assistant's content
5. On `delta` of type `action_start/complete/error`: update the streaming assistant's timeline
6. On `delta` of type `done`: mark the assistant message as completed
7. On `delta` of type `error`: mark the assistant message as error

Wire up the hook:

```typescript
const { send: wsSend, subscribe: wsSubscribe, connected: wsConnected } = useWebSocket({
  onMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "snapshot":
        setMessages(msg.messages as Message[]);
        break;
      case "delta":
        handleDelta(msg.event);
        break;
    }
  }
});

useEffect(() => {
  wsSubscribe(payload.conversation.id);
}, [payload.conversation.id, wsSubscribe]);
```

- [ ] **Step 4: Remove dead code**

Remove from `chat-view.tsx`:
- The `parseSseChunk` function (lines 39-57)
- The `mergeMessages` function (lines 215-261)
- The `syncConversationState` function (lines 263-280)
- The optimistic message creation block in `handleSubmit` (lines 590-617)
- The `fetch` call for SSE (lines 639-648)
- The `ReadableStream` reader and SSE consumption loop (lines 675-791)
- The `syncConversationState()` call after stream (line 795)
- The `streamThinkingTarget` / typewriter throttle logic (or keep it as optional decoration applied to WebSocket-driven content)

- [ ] **Step 5: Remove imports for deleted code**

Remove imports for `sse.ts`, `conversation-events.ts`, `chat-bootstrap.ts` from any file that still imports them (check `chat-view.tsx`, `sidebar.tsx`, etc.).

- [ ] **Step 6: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add components/chat-view.tsx
git commit -m "feat: replace SSE streaming with WebSocket in chat view"
```

---

### Task 12: Wire Snapshot into Chat Page SSR

Update `app/chat/[conversationId]/page.tsx` to pass conversation data as before (SSR still works). The WebSocket hook will override with a snapshot on subscribe. The SSR data serves as the initial render before the WebSocket connects.

- [ ] **Step 1: Verify the chat page still works**

Read `app/chat/[conversationId]/page.tsx` and confirm it passes `messages` via props to `ChatView`. The `ChatView` component should use SSR data as initial state and let WebSocket deltas update it.

No changes should be needed here — the existing SSR props serve as the initial state. The WebSocket snapshot arriving shortly after will reconcile.

- [ ] **Step 2: Verify with a manual test**

Run: `npm run dev:ws`
Open the app in a browser, start a conversation, verify:
1. Messages appear via WebSocket
2. Switching conversations loads the correct snapshot
3. Multiple browser tabs see the same conversation

- [ ] **Step 3: Commit (if any changes were needed)**

```bash
git add -A
git commit -m "feat: verify SSR and WebSocket integration"
```

---

### Task 13: Keep SSE Endpoint Working (Phase 1 Compatibility)

Ensure the existing `POST /api/conversations/[conversationId]/chat` SSE endpoint still works alongside WebSocket. The ws-handler's `handleUserMessage` delegates to `chat-turn.ts` which shares the same core logic.

- [ ] **Step 1: Verify SSE endpoint still works**

The existing `chat/route.ts` is untouched. It still uses SSE. Both paths work simultaneously:
- WebSocket clients connect to `/ws` and send `message` commands
- Legacy clients can still `POST /api/conversations/[conversationId]/chat`

No code changes needed — just verify.

Run: `npm run dev` (not `dev:ws`) and verify the SSE endpoint still works by sending a chat message.

- [ ] **Step 2: Commit (no changes expected)**

If no changes needed, skip this step.

---

### Task 14: Run Full Test Suite

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

- [ ] **Step 2: Run type checking**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run linting**

Run: `npm run lint`
Expected: No new errors

- [ ] **Step 4: Fix any issues found**

Address any test failures, type errors, or lint issues.

- [ ] **Step 5: Commit fixes**

```bash
git add -A
git commit -m "fix: address test and lint issues from WebSocket integration"
```

---

### Task 15: Final Integration Test

- [ ] **Step 1: Start the server with WebSocket support**

Run: `npm run dev:ws`

- [ ] **Step 2: Test multi-client sync**

1. Open browser tab A, start a conversation, send a message
2. While the assistant is streaming, open browser tab B to the same conversation
3. Tab B should receive a snapshot showing the partial response
4. Tab B should then receive live deltas as the assistant continues
5. Close tab A — tab B should continue receiving updates
6. Send a new message from tab B — it should work

- [ ] **Step 3: Test reconnection**

1. Start a conversation, send a message
2. While streaming, disconnect the network (or close the tab)
3. Reconnect (reopen the tab, navigate to the conversation)
4. Verify the full conversation state is visible (including partial response if still streaming, or completed response)

- [ ] **Step 4: Test error recovery**

1. Configure an invalid API key
2. Send a message
3. Verify the error is displayed in the UI
4. Fix the API key and retry

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete server-side conversation sync with WebSocket"
```
