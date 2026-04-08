# Sidebar Conversation Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broadcast conversation list mutations (create, delete, update, reorder) to ALL connected clients via WebSocket so the sidebar stays in sync across browsers and devices.

**Architecture:** Add a global broadcast channel to `ConversationManager` that sends to every connected WebSocket (not just per-conversation rooms). REST API routes that mutate conversations will call `broadcastAll()` after the DB write. The client-side `useWebSocket` hook already routes all server messages to `onMessage` — the sidebar will listen for new message types and update its local state.

**Tech Stack:** TypeScript, `ws`, React, Next.js App Router

---

## File Structure

### Modified files

| File | Change |
|------|--------|
| `lib/ws-protocol.ts` | Add `conversation_created`, `conversation_deleted`, `conversation_updated`, `conversation_reordered` server message types |
| `lib/conversation-manager.ts` | Add `broadcastAll(msg)` that sends to every connected WebSocket |
| `lib/ws-handler.ts` | Register all sockets in global set on connect; remove on disconnect; export `getConversationManager()` |
| `app/api/conversations/route.ts` | After POST (create) and PUT (reorder), call `broadcastAll()` |
| `app/api/conversations/[conversationId]/route.ts` | After DELETE and PATCH (folder move), call `broadcastAll()` |
| `components/sidebar.tsx` | Accept `onServerMessage` callback prop; handle new WS events to update local state |
| `components/shell.tsx` | Wire WebSocket `onMessage` into Sidebar via prop or context |

---

### Task 1: Add server message types to WS protocol

**Files:**
- Modify: `lib/ws-protocol.ts`

- [ ] **Step 1: Add new server message types**

Add three new variants to the `ServerMessage` union in `lib/ws-protocol.ts`:

```typescript
export type ServerMessage =
  | { type: "ready"; activeConversations: { id: string; title: string; status: string }[] }
  | { type: "snapshot"; conversationId: string; messages: unknown[]; actions: unknown[]; segments: unknown[] }
  | { type: "delta"; conversationId: string; event: ChatStreamEvent }
  | { type: "error"; message: string }
  | { type: "conversation_created"; conversation: { id: string; title: string; folderId: string | null; createdAt: string; updatedAt: string; isActive: boolean } }
  | { type: "conversation_deleted"; conversationId: string }
  | { type: "conversation_updated"; conversation: { id: string; title: string; folderId: string | null; updatedAt: string; isActive: boolean } }
```

Note: `conversation_reordered` is omitted because reorder changes affect the `sort_order` column which is only visible in the paginated list response. After a reorder, the simplest approach is to not broadcast and instead rely on the next page load. Reorder is a rare, deliberate user action — the current `router.refresh()` in the drag handler is sufficient. YAGNI.

The `conversation_created` payload carries the minimal fields the sidebar needs to render the new item. The `conversation_updated` payload carries fields that can change (title, folderId, updatedAt, isActive).

- [ ] **Step 2: Commit**

```bash
git add lib/ws-protocol.ts
git commit -m "feat: add conversation list WS message types for cross-client sync"
```

---

### Task 2: Add global broadcast to ConversationManager

**Files:**
- Modify: `lib/conversation-manager.ts`

- [ ] **Step 1: Add global socket tracking and broadcastAll**

Add a `connectedSockets` set and a `broadcastAll` function to the conversation manager:

```typescript
export function createConversationManager() {
  const rooms = new Map<string, Set<WebSocket>>();
  const clientRooms = new Map<WebSocket, Set<string>>();
  const activeTurns = new Map<string, boolean>();
  const connectedSockets = new Set<WebSocket>();

  function addConnection(ws: WebSocket) {
    connectedSockets.add(ws);
  }

  function removeConnection(ws: WebSocket) {
    connectedSockets.delete(ws);
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

  function broadcastAll(event: ServerMessage) {
    const raw = serializeServerMessage(event);
    for (const ws of connectedSockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  // ... rest unchanged

  return { subscribe, unsubscribe, broadcast, broadcastAll, disconnect, isActive, setActive, getActiveConversationIds, hasSubscribers, addConnection, removeConnection };
}
```

The `addConnection` and `removeConnection` calls happen in `ws-handler.ts` (Task 3).

- [ ] **Step 2: Commit**

```bash
git add lib/conversation-manager.ts
git commit -m "feat: add global broadcastAll to conversation manager"
```

---

### Task 3: Wire global connections in ws-handler and export getConversationManager

**Files:**
- Modify: `lib/ws-handler.ts`

- [ ] **Step 1: Call addConnection/removeConnection and export getConversationManager**

In `ws-handler.ts`, the `handleConnection` function needs to register/deregister the socket globally. Also export `getConversationManager` so REST API routes can access the same singleton.

Current `handleConnection` function has this close handler:
```typescript
ws.on("close", () => {
    for (const conversationId of currentSubscription) {
      mgr.unsubscribe(conversationId, ws);
    }
    mgr.disconnect(ws);
  });
```

Change to:
```typescript
ws.on("close", () => {
    mgr.removeConnection(ws);
    for (const conversationId of currentSubscription) {
      mgr.unsubscribe(conversationId, ws);
    }
    mgr.disconnect(ws);
  });
```

And right after creating the manager (`const mgr = getManager();`), add:
```typescript
mgr.addConnection(ws);
```

Then add a named export:
```typescript
export function getConversationManager(): ConversationManager {
  return getManager();
}
```

Wait — `getManager()` is already a module-level function. Just export it directly:

Change the existing:
```typescript
let manager: ConversationManager | null = null;

function getManager(): ConversationManager {
  if (!manager) {
    manager = createConversationManager();
  }
  return manager;
}
```

To:
```typescript
let manager: ConversationManager | null = null;

export function getConversationManager(): ConversationManager {
  if (!manager) {
    manager = createConversationManager();
  }
  return manager;
}
```

And update the single internal call site from `getManager()` to `getConversationManager()`.

- [ ] **Step 2: Commit**

```bash
git add lib/ws-handler.ts
git commit -m "feat: track all WS connections for global broadcast, export getConversationManager"
```

---

### Task 4: Broadcast from REST API routes

**Files:**
- Modify: `app/api/conversations/route.ts`
- Modify: `app/api/conversations/[conversationId]/route.ts`

- [ ] **Step 1: Broadcast after conversation creation**

In `app/api/conversations/route.ts`, after the `POST` handler creates a conversation, broadcast it:

```typescript
import { getConversationManager } from "@/lib/ws-handler";

// Inside POST handler, after createConversation():
export async function POST(request: Request) {
  await requireUser();
  let parsedBody: unknown = {};

  try {
    const rawBody = await request.text();
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    parsedBody = {};
  }

  const body = createSchema.safeParse(parsedBody);
  const title = body.success ? body.data.title : undefined;
  const folderId = body.success ? body.data.folderId : undefined;
  const providerProfileId = body.success ? body.data.providerProfileId : undefined;

  if (providerProfileId !== undefined && !getProviderProfile(providerProfileId)) {
    return badRequest("Provider profile not found", 404);
  }

  const conversation = createConversation(title, folderId, {
    providerProfileId
  });

  const manager = getConversationManager();
  manager.broadcastAll({
    type: "conversation_created",
    conversation: {
      id: conversation.id,
      title: conversation.title,
      folderId: conversation.folderId,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      isActive: conversation.isActive
    }
  });

  return ok(
    { conversation },
    { status: 201 }
  );
}
```

- [ ] **Step 2: Broadcast after conversation deletion**

In `app/api/conversations/[conversationId]/route.ts`, inside the `DELETE` handler, broadcast after successful deletion:

```typescript
import { getConversationManager } from "@/lib/ws-handler";

// Inside DELETE handler, after deleteConversation():
export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);

  if (!params.success) {
    return badRequest("Invalid conversation id");
  }

  const onlyIfEmptyParam = new URL(request.url).searchParams.get("onlyIfEmpty");
  const onlyIfEmpty = onlyIfEmptyParam === "1" || onlyIfEmptyParam === "true";
  const deleted = onlyIfEmpty
    ? deleteConversationIfEmpty(params.data.conversationId)
    : (deleteConversation(params.data.conversationId), true);

  if (deleted) {
    const manager = getConversationManager();
    manager.broadcastAll({
      type: "conversation_deleted",
      conversationId: params.data.conversationId
    });
  }

  return ok({ success: true, deleted });
}
```

- [ ] **Step 3: Broadcast after conversation update (folder move)**

In the same file, inside the `PATCH` handler, broadcast after folder move:

```typescript
// Inside PATCH handler, after moveConversationToFolder():
if (body.data.folderId !== undefined) {
    moveConversationToFolder(conversation.id, body.data.folderId);
  }

  // ... existing provider profile and isActive handling ...

  const updated = getConversation(conversation.id);

  const manager = getConversationManager();
  manager.broadcastAll({
    type: "conversation_updated",
    conversation: {
      id: updated!.id,
      title: updated!.title,
      folderId: updated!.folderId,
      updatedAt: updated!.updatedAt,
      isActive: updated!.isActive
    }
  });

  return ok({ conversation: updated });
```

Note: `isActive` changes also need to broadcast. Currently the `ready` message includes active conversations, but that only fires on connect. Broadcast `conversation_updated` for any PATCH to keep all clients consistent.

- [ ] **Step 4: Commit**

```bash
git add app/api/conversations/route.ts app/api/conversations/[conversationId]/route.ts
git commit -m "feat: broadcast conversation mutations to all connected clients"
```

---

### Task 5: Wire sidebar to receive WS events

**Files:**
- Modify: `components/sidebar.tsx`
- Modify: `components/shell.tsx`

The sidebar needs to receive WebSocket messages. Currently, the WebSocket is only used inside `ChatView`. The `Shell` component wraps both the sidebar and the content area, so it's the right place to host the WebSocket connection and pass messages down.

- [ ] **Step 1: Add onServerMessage prop to Sidebar**

In `components/sidebar.tsx`, add an optional `onServerMessage` prop:

```typescript
import type { ServerMessage } from "@/lib/ws-protocol";

export function Sidebar({
  conversationPage,
  folders: initialFolders,
  onClose,
  onServerMessage
}: {
  conversationPage: ConversationListPage;
  folders?: Folder[];
  onClose?: () => void;
  onServerMessage?: (msg: ServerMessage) => void;
}) {
```

Inside the component, add a `useEffect` that processes incoming server messages:

```typescript
useEffect(() => {
  if (!onServerMessage) return;

  function handleWsMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "conversation_created": {
        const { conversation } = msg;
        setLocalConversations((current) =>
          mergeConversations([conversation as Conversation], current)
        );
        break;
      }
      case "conversation_deleted": {
        setLocalConversations((current) =>
          current.filter((c) => c.id !== msg.conversationId)
        );
        setSearchResults((current) =>
          current ? current.filter((c) => c.id !== msg.conversationId) : current
        );
        break;
      }
      case "conversation_updated": {
        const { conversation } = msg;
        setLocalConversations((current) =>
          mergeConversations([conversation as Conversation], current)
        );
        break;
      }
    }
  }

  onServerMessage(handleWsMessage);
}, [onServerMessage]);
```

Wait — the `onServerMessage` callback pattern needs careful design. The Shell needs to pass a registration function (not a one-time callback). Let me use a ref-based approach instead.

**Revised approach:** Add a `serverMessageRef` to Sidebar that Shell can write to. Actually, the simpler approach is to use a React context or just lift the WebSocket to Shell.

**Simplest approach:** Shell already wraps Sidebar and ChatView. The WebSocket connection lives in ChatView. Rather than moving the WebSocket up (which would change the subscribe/unsubscribe lifecycle), the cleanest pattern is to have the sidebar maintain its own lightweight WebSocket connection that only listens for global events — no subscribe/unsubscribe needed.

Actually, even simpler: use the existing `CustomEvent` pattern but bridge it from WebSocket. The `chat-view.tsx` already handles WebSocket messages. We can have chat-view dispatch `CustomEvent`s for the new message types, and the sidebar already listens for `CustomEvent`s.

But this only works if a chat-view is mounted. On the home page, there's no chat-view. So this won't cover the case where Client A is on the home page and Client B creates a conversation.

**Final approach:** Add a standalone `useGlobalWebSocket` hook that creates a WebSocket connection, does NOT subscribe to any conversation, and only processes global events. Mount it in `Shell` so it's always active.

- [ ] **Step 2: Create useGlobalWebSocket hook in shell.tsx**

No new file needed — add the hook inline in `shell.tsx` or as a small addition to `ws-client.ts`. Since it reuses the same `useWebSocket` infrastructure, add it to `ws-client.ts`:

In `lib/ws-client.ts`, add:

```typescript
export function useGlobalWebSocket(onMessage?: (msg: ServerMessage) => void): { connected: boolean } {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const { connected } = useWebSocket({
    onMessage: (msg) => {
      if (msg.type !== "error" && msg.type !== "ready") {
        onMessageRef.current?.(msg);
      }
    }
  });

  return { connected };
}
```

This creates a WebSocket that stays connected but never subscribes to a conversation room. It will still receive `broadcastAll()` messages since those go to all connected sockets.

- [ ] **Step 3: Wire useGlobalWebSocket in Shell and pass to Sidebar**

In `components/shell.tsx`:

```typescript
import { useGlobalWebSocket } from "@/lib/ws-client";
import type { ServerMessage } from "@/lib/ws-protocol";

export function Shell({
  conversationPage,
  folders,
  children
}: PropsWithChildren<{ conversationPage: ConversationListPage; folders?: Folder[] }>) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [serverMessage, setServerMessage] = useState<ServerMessage | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const activeConversationId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;
  const isSettingsPage = pathname.startsWith("/settings");

  useGlobalWebSocket((msg) => {
    setServerMessage(msg);
  });

  return (
    // ... existing JSX ...
    <Sidebar
      conversationPage={conversationPage}
      folders={folders}
      onClose={() => setIsSidebarOpen(false)}
      serverMessage={serverMessage}
    />
    // ...
  );
}
```

Wait, this `useState` pattern will miss messages if two arrive in the same render tick. Better to use a ref + a version counter:

```typescript
const [serverMessageVersion, setServerMessageVersion] = useState(0);
const serverMessageRef = useRef<ServerMessage | null>(null);

useGlobalWebSocket((msg) => {
  serverMessageRef.current = msg;
  setServerMessageVersion((v) => v + 1);
});
```

And pass `serverMessageRef` and `serverMessageVersion` as props. The sidebar reads from the ref.

Actually, even simpler: pass the ref directly and trigger re-render with a counter. But the cleanest React pattern is to use a callback ref that the sidebar can register.

**Final simplest approach:** Use a module-level event bus. Since the sidebar already uses `CustomEvent`, and the issue is that CustomEvent is same-tab only, we can use a lightweight module-level pubsub that works across the Shell's children:

In `lib/ws-client.ts`:

```typescript
const globalListeners = new Set<(msg: ServerMessage) => void>();

export function addGlobalWsListener(listener: (msg: ServerMessage) => void) {
  globalListeners.add(listener);
  return () => globalListeners.delete(listener);
}

export function useGlobalWebSocket(): { connected: boolean } {
  const { connected } = useWebSocket({
    onMessage: (msg) => {
      if (msg.type === "conversation_created" || msg.type === "conversation_deleted" || msg.type === "conversation_updated") {
        for (const listener of globalListeners) {
          listener(msg);
        }
      }
    }
  });

  return { connected };
}
```

Then in Sidebar, use `addGlobalWsListener` in a useEffect to receive messages. This avoids prop drilling and works regardless of mounting order.

- [ ] **Step 4: Listen in Sidebar**

In `components/sidebar.tsx`, add:

```typescript
import { addGlobalWsListener } from "@/lib/ws-client";
import type { ServerMessage } from "@/lib/ws-protocol";

// Inside Sidebar component, add a useEffect:
useEffect(() => {
  return addGlobalWsListener((msg: ServerMessage) => {
    switch (msg.type) {
      case "conversation_created": {
        const { conversation } = msg;
        setLocalConversations((current) =>
          mergeConversations([conversation as Conversation], current)
        );
        break;
      }
      case "conversation_deleted": {
        setLocalConversations((current) =>
          current.filter((c) => c.id !== msg.conversationId)
        );
        setSearchResults((current) =>
          current ? current.filter((c) => c.id !== msg.conversationId) : current
        );
        break;
      }
      case "conversation_updated": {
        const { conversation } = msg;
        setLocalConversations((current) =>
          mergeConversations([conversation as Conversation], current)
        );
        break;
      }
    }
  });
}, []);
```

- [ ] **Step 5: Mount useGlobalWebSocket in Shell**

In `components/shell.tsx`:

```typescript
import { useGlobalWebSocket } from "@/lib/ws-client";

// Inside Shell component:
useGlobalWebSocket();
```

This is a one-liner — the hook creates the connection and fans out to listeners.

- [ ] **Step 6: Commit**

```bash
git add lib/ws-client.ts components/shell.tsx components/sidebar.tsx
git commit -m "feat: sidebar listens for global WS events to sync conversation list"
```

---

### Task 6: Handle edge case — avoid duplicate conversations

**Files:**
- Modify: `components/sidebar.tsx`

When Client A creates a conversation, it gets the response from the REST API and calls `router.push()` + `router.refresh()`. The `router.refresh()` triggers a server re-render which passes updated `conversationPage` to Sidebar. The sidebar's existing `useEffect` on `conversationPage` merges the incoming data with local state via `mergeConversations()`.

If the WebSocket `conversation_created` message also arrives around the same time, `mergeConversations` will deduplicate by ID since it uses a `Map` keyed by `conversation.id`. So no duplicate will appear. No additional handling needed — the existing merge logic is safe.

- [ ] **Step 1: Verify no duplicate handling needed**

Read the `mergeConversations` function to confirm it deduplicates by ID:

```typescript
function mergeConversations(current: Conversation[], incoming: Conversation[]) {
  const merged = new Map(current.map((conversation) => [conversation.id, conversation]));
  incoming.forEach((conversation) => {
    merged.set(conversation.id, conversation);
  });
  return [...merged.values()].sort(compareConversations);
}
```

Confirmed: the `Map` overwrites entries with the same key. No duplicates possible.

- [ ] **Step 2: Commit (no changes needed)**

No commit — this task documents that the existing merge logic is safe.

---

### Task 7: Manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open two browser tabs**

Open `http://localhost:<port>` in Tab A and Tab B.

- [ ] **Step 3: Test conversation creation sync**

1. In Tab A, click "New chat"
2. Verify the new conversation appears in Tab B's sidebar without refresh

- [ ] **Step 4: Test conversation deletion sync**

1. In Tab A, create a conversation and then delete it via the sidebar menu
2. Verify it disappears from Tab B's sidebar

- [ ] **Step 5: Test folder move sync**

1. In Tab A, move a conversation to a folder
2. Verify it moves in Tab B's sidebar

- [ ] **Step 6: Test title update sync**

1. In Tab A, send a message in a conversation to trigger title generation
2. Wait for title to generate
3. Verify the title updates in Tab B's sidebar (this should work via the existing `conversation_updated` broadcast once the title change triggers a PATCH, OR we need to also broadcast from the title generator)

**Important note on title sync:** Title generation happens asynchronously in `generateConversationTitleFromFirstUserMessage()` in `lib/conversations.ts`. After generating, it calls `updateConversationTitle()` which does a direct DB write — it does NOT call the REST API. So the broadcast won't fire from Task 4's API route changes. We need to also broadcast from the title generator. See Task 8.

---

### Task 8: Broadcast title updates from the title generator

**Files:**
- Modify: `lib/conversations.ts`

- [ ] **Step 1: Import getConversationManager and broadcast after title update**

Find the function that updates the conversation title after generation. This is likely `updateConversationTitle` or the function called by `generateConversationTitleFromFirstUserMessage`.

In `lib/conversations.ts`, find where `title_generation_status` is set to `"completed"` and the title is written to the DB. After that write, broadcast:

```typescript
import { getConversationManager } from "@/lib/ws-handler";

// After the DB update that sets the new title and status to "completed":
try {
  const manager = getConversationManager();
  manager.broadcastAll({
    type: "conversation_updated",
    conversation: {
      id: conversationId,
      title: newTitle,
      folderId: conversation.folderId,
      updatedAt: new Date().toISOString(),
      isActive: conversation.isActive
    }
  });
} catch {
  // broadcastAll may fail if no WS server is running (e.g., tests)
}
```

Wrap in try/catch because `getConversationManager()` creates the manager lazily — in test environments or API route contexts where the WS server isn't running, this could fail.

- [ ] **Step 2: Commit**

```bash
git add lib/conversations.ts
git commit -m "feat: broadcast title updates via WebSocket for cross-client sync"
```

---

### Task 9: Build verification

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Final commit if any fixes needed**

---

## Self-Review

**1. Spec coverage:**
- Conversation creation sync → Task 4 Step 1 + Task 5 Step 4
- Conversation deletion sync → Task 4 Step 2 + Task 5 Step 4
- Folder move sync → Task 4 Step 3 + Task 5 Step 4
- Title update sync → Task 8 + Task 5 Step 4
- Duplicate prevention → Task 6 (no code change needed)

**2. Placeholder scan:** None found. All steps contain actual code.

**3. Type consistency:**
- `conversation_created.conversation` and `conversation_updated.conversation` use the same inline type from `ws-protocol.ts` Task 1
- All broadcast calls construct objects matching the `ServerMessage` type
- Sidebar casts `msg.conversation as Conversation` which is safe since the broadcast payloads are subsets of `Conversation`
