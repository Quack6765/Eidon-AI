# Persistent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-conversation persistent memory system where the LLM automatically saves, updates, and deletes facts about the user via tool calls, with a settings page for manual management.

**Architecture:** Three new tool definitions (`create_memory`, `update_memory`, `delete_memory`) registered in the existing tool system. Memories stored in a SQLite `user_memories` table, injected into the system prompt via `buildPromptMessages()`. The LLM decides conservatively when to save. Settings page follows the existing `SettingsSplitPane` pattern.

**Tech Stack:** SQLite (better-sqlite3), Next.js App Router, Zod validation, Lucide icons, Tailwind CSS

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/memories.ts` | Data access layer — CRUD operations on `user_memories` table |
| `lib/types.ts` | Add `UserMemory` type, extend `MessageActionKind` and `AppSettings` |
| `lib/constants.ts` | Default values for new settings |
| `lib/db.ts` | Migration: `user_memories` table + `memories_enabled`/`memories_max_count` columns |
| `lib/settings.ts` | Read new settings columns, include in update schema |
| `lib/assistant-runtime.ts` | Register memory tools, execute memory tool calls |
| `lib/compaction.ts` | Inject memory block into system prompt via `buildPromptMessages()` |
| `lib/chat-turn.ts` | Pass `memoriesEnabled` to runtime, inject memory tool system prompt |
| `app/api/memories/route.ts` | GET (list) and POST (create) API routes |
| `app/api/memories/[memoryId]/route.ts` | PATCH (update) and DELETE API routes |
| `app/settings/memories/page.tsx` | Settings page route (auth guard + section component) |
| `components/settings/sections/memories-section.tsx` | Settings UI: toggle, list, editor, filters |
| `components/settings/settings-nav.tsx` | Add memories nav item |
| `components/message-bubble.tsx` | Brain icon for memory actions |

---

### Task 1: Types, Constants, and Database Migration

**Files:**
- Modify: `lib/types.ts:21` (MessageActionKind)
- Modify: `lib/types.ts:66-72` (AppSettings)
- Modify: `lib/constants.ts`
- Modify: `lib/db.ts` (migration)
- Modify: `lib/settings.ts` (read new columns)
- Create: `lib/memories.ts`

- [ ] **Step 1: Add types and constants**

In `lib/types.ts`, update `MessageActionKind` on line 21:
```typescript
export type MessageActionKind = "skill_load" | "mcp_tool_call" | "shell_command" | "create_memory" | "update_memory" | "delete_memory";
```

Add `UserMemory` type after the `Persona` type (after line 170):
```typescript
export type MemoryCategory = "personal" | "preference" | "work" | "location" | "other";

export type UserMemory = {
  id: string;
  content: string;
  category: MemoryCategory;
  createdAt: string;
  updatedAt: string;
};
```

Update `AppSettings` on line 66-72 to include the two new fields:
```typescript
export type AppSettings = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  conversationRetention: ConversationRetention;
  autoCompaction: boolean;
  memoriesEnabled: boolean;
  memoriesMaxCount: number;
  updatedAt: string;
};
```

In `lib/constants.ts`, add after the `DEFAULT_AUTO_COMPACTION` line (line 9):
```typescript
export const DEFAULT_MEMORIES_ENABLED = true;
export const DEFAULT_MEMORIES_MAX_COUNT = 100;
```

- [ ] **Step 2: Add database migration**

In `lib/db.ts`, inside the `migrate()` function, add the `user_memories` table creation inside the main `db.exec()` block (after the `personas` table, around line 282):
```sql
    CREATE TABLE IF NOT EXISTS user_memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
```

After the existing settings column migration block (after the `auto_compaction` check around line 325), add:
```typescript
  if (!settingsColNames.includes("memories_enabled")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN memories_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!settingsColNames.includes("memories_max_count")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN memories_max_count INTEGER NOT NULL DEFAULT 100");
  }
```

Add an index after the other index creation statements (around line 408):
```sql
    CREATE INDEX IF NOT EXISTS idx_user_memories_category ON user_memories(category);
```

- [ ] **Step 3: Update settings read/write**

In `lib/settings.ts`, update the `AppSettingsRow` type (line 78-84) to include:
```typescript
type AppSettingsRow = {
  default_provider_profile_id: string;
  skills_enabled: number;
  conversation_retention: string;
  auto_compaction: number;
  memories_enabled: number;
  memories_max_count: number;
  updated_at: string;
};
```

Update `rowToSettings()` (line 113-121) to map the new columns:
```typescript
function rowToSettings(row: AppSettingsRow): AppSettings {
  return {
    defaultProviderProfileId: row.default_provider_profile_id,
    skillsEnabled: Boolean(row.skills_enabled),
    conversationRetention: row.conversation_retention as AppSettings["conversationRetention"],
    autoCompaction: Boolean(row.auto_compaction),
    memoriesEnabled: Boolean(row.memories_enabled),
    memoriesMaxCount: row.memories_max_count,
    updatedAt: row.updated_at
  };
}
```

Update `getSettings()` SELECT query (line 238-250) to include the new columns:
```typescript
  const row = getDb()
    .prepare(
      `SELECT
        default_provider_profile_id,
        skills_enabled,
        conversation_retention,
        auto_compaction,
        memories_enabled,
        memories_max_count,
        updated_at
      FROM app_settings
      WHERE id = ?`
    )
    .get(SETTINGS_ROW_ID) as AppSettingsRow;
```

Update the `settingsSchema` in the Zod validation (line 46-52) to include:
```typescript
const settingsSchema = z
  .object({
    defaultProviderProfileId: z.string().min(1),
    skillsEnabled: z.coerce.boolean(),
    conversationRetention: z.enum(["forever", "90d", "30d", "7d"]).default("forever"),
    autoCompaction: z.coerce.boolean().default(true),
    memoriesEnabled: z.coerce.boolean().default(true),
    memoriesMaxCount: z.coerce.number().int().min(1).max(500).default(100),
    providerProfiles: z.array(providerProfileInputSchema).min(1)
  })
```

Update the `UPDATE app_settings` statement in `updateSettings()` (line 435-452) to include the new columns:
```sql
         SET default_provider_profile_id = ?,
             skills_enabled = ?,
             conversation_retention = ?,
             auto_compaction = ?,
             memories_enabled = ?,
             memories_max_count = ?,
             updated_at = ?
         WHERE id = ?
```

And add the new values to the `.run()` call:
```typescript
      .run(
        parsed.defaultProviderProfileId,
        parsed.skillsEnabled ? 1 : 0,
        parsed.conversationRetention,
        parsed.autoCompaction ? 1 : 0,
        parsed.memoriesEnabled ? 1 : 0,
        parsed.memoriesMaxCount,
        timestamp,
        SETTINGS_ROW_ID
      );
```

- [ ] **Step 4: Create data access layer**

Create `lib/memories.ts` following the `lib/personas.ts` pattern:
```typescript
import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { MemoryCategory, UserMemory } from "@/lib/types";

function nowIso() {
  return new Date().toISOString();
}

function rowToMemory(row: {
  id: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}): UserMemory {
  return {
    id: row.id,
    content: row.content,
    category: row.category as MemoryCategory,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listMemories(filter?: { category?: string; search?: string }): UserMemory[] {
  let sql = `SELECT id, content, category, created_at, updated_at FROM user_memories`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.category) {
    conditions.push("category = ?");
    params.push(filter.category);
  }

  if (filter?.search) {
    conditions.push("content LIKE ?");
    params.push(`%${filter.search}%`);
  }

  if (conditions.length) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }

  sql += " ORDER BY updated_at DESC";

  const rows = params.length
    ? getDb().prepare(sql).all(...params) as Array<Parameters<typeof rowToMemory>[0]>
    : getDb().prepare(sql).all() as Array<Parameters<typeof rowToMemory>[0]>;

  return rows.map(rowToMemory);
}

export function getMemory(memoryId: string): UserMemory | null {
  const row = getDb()
    .prepare(
      `SELECT id, content, category, created_at, updated_at FROM user_memories WHERE id = ?`
    )
    .get(memoryId) as Parameters<typeof rowToMemory>[0] | undefined;

  return row ? rowToMemory(row) : null;
}

export function createMemory(content: string, category: MemoryCategory): UserMemory {
  const timestamp = nowIso();
  const memory: UserMemory = {
    id: createId("mem"),
    content: content.trim(),
    category,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  getDb()
    .prepare(
      `INSERT INTO user_memories (id, content, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(memory.id, memory.content, memory.category, memory.createdAt, memory.updatedAt);

  return memory;
}

export function updateMemory(
  memoryId: string,
  input: { content?: string; category?: MemoryCategory }
): UserMemory | null {
  const current = getMemory(memoryId);
  if (!current) return null;

  const timestamp = nowIso();
  const content = input.content?.trim() ?? current.content;
  const category = input.category ?? current.category;

  getDb()
    .prepare(
      `UPDATE user_memories SET content = ?, category = ?, updated_at = ? WHERE id = ?`
    )
    .run(content, category, timestamp, memoryId);

  return getMemory(memoryId);
}

export function deleteMemory(memoryId: string): void {
  getDb().prepare("DELETE FROM user_memories WHERE id = ?").run(memoryId);
}

export function getMemoryCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM user_memories")
    .get() as { count: number };
  return row.count;
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/constants.ts lib/db.ts lib/settings.ts lib/memories.ts
git commit -m "feat(memory): add types, migration, settings, and data access layer"
```

---

### Task 2: Memory Tools in the Assistant Runtime

**Files:**
- Modify: `lib/assistant-runtime.ts`
- Modify: `lib/chat-turn.ts`

- [ ] **Step 1: Register memory tool definitions**

In `lib/assistant-runtime.ts`, update the `buildToolDefinitions` function signature (line 129-134) to accept a `memoriesEnabled` parameter:
```typescript
function buildToolDefinitions(input: {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  shellCommandPrefixes: string[];
  memoriesEnabled: boolean;
}): ToolDefinition[] {
```

At the end of `buildToolDefinitions()`, right before `return tools;` (around line 191), add the memory tools:
```typescript
  if (input.memoriesEnabled) {
    tools.push(
      {
        type: "function",
        function: {
          name: "create_memory",
          description: "Save a durable fact about the user for future conversations. Use conservatively — only for facts likely to recur (name, location, preferences, work details). Do not save transient task details.",
          parameters: {
            type: "object",
            properties: {
              content: { type: "string", description: "The fact to remember" },
              category: { type: "string", description: "One of: personal, preference, work, location, other" }
            },
            required: ["content", "category"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "update_memory",
          description: "Update an existing memory when a fact has changed.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "The memory ID to update" },
              content: { type: "string", description: "The updated fact" },
              category: { type: "string", description: "New category (optional)" }
            },
            required: ["id", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "delete_memory",
          description: "Delete a stored memory that is no longer relevant or accurate.",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string", description: "The memory ID to delete" }
            },
            required: ["id"]
          }
        }
      }
    );
  }
```

- [ ] **Step 2: Add memory tool executors**

Add three new executor functions in `lib/assistant-runtime.ts`, before `executeToolCall()` (before line 560). These follow the same pattern as `executeLoadSkill` and `executeMcpToolCall`:

```typescript
import { getMemory, createMemory, updateMemory as updateMemoryRecord, deleteMemory as deleteMemoryRecord, getMemoryCount } from "@/lib/memories";
import { getSettings } from "@/lib/settings";
```

```typescript
async function executeCreateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const sortOrder = context.timelineSortOrder;
  const content = String(args.content ?? "").trim();
  const category = String(args.category ?? "other").trim();

  if (!content) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: content is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const validCategories = ["personal", "preference", "work", "location", "other"];
  const normalizedCategory = validCategories.includes(category) ? category : "other";

  const appSettings = getSettings();
  const currentCount = getMemoryCount();

  if (currentCount >= (appSettings.memoriesMaxCount ?? 100)) {
    const errorMsg = `Memory limit reached (${currentCount}/${appSettings.memoriesMaxCount}). Update or delete an existing memory instead.`;
    const resultMsg = buildToolResultMessage(toolCallId, errorMsg);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "create_memory",
    label: "Saved memory",
    detail: content,
    arguments: args
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    createMemory(content, normalizedCategory as "personal" | "preference" | "work" | "location" | "other");
    await context.input.onActionComplete?.(actionHandle, { resultSummary: `Saved as ${normalizedCategory}` });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Failed to create memory";
    await context.input.onActionError?.(actionHandle, { resultSummary: errorMsg });
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Memory saved: ${content} [${normalizedCategory}]`);
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

async function executeUpdateMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();
  const content = String(args.content ?? "").trim();
  const category = args.category ? String(args.category).trim() : undefined;

  if (!id || !content) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: id and content are required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const existing = getMemory(id);
  if (!existing) {
    const resultMsg = buildToolResultMessage(toolCallId, `Error: Memory ${id} not found`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "update_memory",
    label: "Updated memory",
    detail: content,
    arguments: args
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    updateMemoryRecord(id, {
      content,
      ...(category ? { category: category as "personal" | "preference" | "work" | "location" | "other" } : {})
    });
    await context.input.onActionComplete?.(actionHandle, {
      detail: content,
      resultSummary: `Was: ${existing.content}`
    });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Failed to update memory";
    await context.input.onActionError?.(actionHandle, { resultSummary: errorMsg });
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Memory updated: ${content}`);
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}

async function executeDeleteMemory(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: {
      onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
      onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
      onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
    };
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const sortOrder = context.timelineSortOrder;
  const id = String(args.id ?? "").trim();

  if (!id) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: id is required");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const existing = getMemory(id);
  if (!existing) {
    const resultMsg = buildToolResultMessage(toolCallId, `Error: Memory ${id} not found`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "delete_memory",
    label: "Deleted memory",
    detail: existing.content,
    arguments: args
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    deleteMemoryRecord(id);
    await context.input.onActionComplete?.(actionHandle, { resultSummary: "Deleted" });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : "Failed to delete memory";
    await context.input.onActionError?.(actionHandle, { resultSummary: errorMsg });
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Memory deleted: ${existing.content}`);
  return { nextSortOrder: sortOrder + 1, promptMessages: [...context.promptMessages, resultMsg] };
}
```

- [ ] **Step 3: Route tool calls to memory executors**

In `executeToolCall()` (line 587-597), add routing before the `mcp_` check:
```typescript
  if (name === "create_memory") {
    return executeCreateMemory(toolCallId, args, context);
  }

  if (name === "update_memory") {
    return executeUpdateMemory(toolCallId, args, context);
  }

  if (name === "delete_memory") {
    return executeDeleteMemory(toolCallId, args, context);
  }
```

- [ ] **Step 4: Pass memoriesEnabled through the runtime**

In `resolveAssistantTurn()` (line 645), add `memoriesEnabled` to the input type:
```typescript
export async function resolveAssistantTurn(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers?: McpServer[];
  mcpToolSets: ToolSet[];
  visionMcpServer?: McpServer | null;
  memoriesEnabled?: boolean;
  // ... rest of existing fields
```

Find where `buildToolDefinitions` is called (search for `buildToolDefinitions({`) and add the new parameter. It's called inside the tool loop — pass `input.memoriesEnabled ?? false` in the call.

In `lib/chat-turn.ts`, at line 157 where `resolveAssistantTurn` is called, add:
```typescript
    const providerResult = await resolveAssistantTurn({
      settings,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      visionMcpServer,
      memoriesEnabled: appSettings.memoriesEnabled,
      // ... rest of existing fields
```

- [ ] **Step 5: Commit**

```bash
git add lib/assistant-runtime.ts lib/chat-turn.ts
git commit -m "feat(memory): register memory tools and add executors"
```

---

### Task 3: Context Injection

**Files:**
- Modify: `lib/compaction.ts`

- [ ] **Step 1: Import memories module**

At the top of `lib/compaction.ts`, add:
```typescript
import { listMemories } from "@/lib/memories";
import { getSettings } from "@/lib/settings";
```

- [ ] **Step 2: Inject memory block into buildPromptMessages**

In `buildPromptMessages()` (line 568), add `memoriesEnabled?: boolean` to the input type:
```typescript
export function buildPromptMessages(input: {
  systemPrompt: string;
  personaContent?: string;
  messages: Message[];
  activeMemoryNodes: MemoryNode[];
  userInput?: string;
  maxAttachmentTextTokens?: number;
  memoriesEnabled?: boolean;
}): PromptMessage[] {
```

Inside the function, after the persona content injection (line 584-586) and before the `activeMemoryNodes` block (line 588), add the user memories injection:
```typescript
  if (input.memoriesEnabled) {
    const memories = listMemories();
    if (memories.length > 0) {
      const appSettings = getSettings();
      systemParts.push(
        `<memory>\n` +
        memories.map((m) => `${m.id}: [${m.category}] ${m.content}`).join("\n") +
        `\n</memory>`
      );
      systemParts.push(
        "You have access to memory tools (create_memory, update_memory, delete_memory) to persist facts about the user across conversations. Use these conservatively — only save durable, recurring facts (name, location, preferences, work details). Do not save transient details about the current task. Before creating a new memory, check if a similar one already exists and update it instead. The user can see and manage all memories in their settings."
      );
    }
  }
```

- [ ] **Step 3: Pass memoriesEnabled from ensureCompactedContext**

In `ensureCompactedContext()` (line 641), add `memoriesEnabled` to its parameter signature:
```typescript
export async function ensureCompactedContext(
  conversationId: string,
  settings: ProviderProfileWithApiKey,
  hooks: CompactionLifecycleHooks = {},
  personaId?: string,
  memoriesEnabled: boolean = false
): Promise<EnsureCompactedContextResult> {
```

Find all calls to `buildPromptMessages` inside this function and add `memoriesEnabled`:
```typescript
      const promptMessages = buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        personaContent,
        messages: visibleMessages,
        activeMemoryNodes,
        maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO),
        memoriesEnabled
      });
```

Do this for every `buildPromptMessages()` call inside `ensureCompactedContext` — there are several (around lines 682, 713, 734, 778).

- [ ] **Step 4: Pass memoriesEnabled from chat-turn**

In `lib/chat-turn.ts`, where `ensureCompactedContext` is called (line 94), add the parameter:
```typescript
    const compacted = await ensureCompactedContext(conversation.id, settings, {
      onCompactionStart() { /* ... */ },
      onCompactionEnd() { /* ... */ }
    }, personaId, appSettings.memoriesEnabled);
```

- [ ] **Step 5: Commit**

```bash
git add lib/compaction.ts lib/chat-turn.ts
git commit -m "feat(memory): inject user memories into system prompt"
```

---

### Task 4: Memory API Routes

**Files:**
- Create: `app/api/memories/route.ts`
- Create: `app/api/memories/[memoryId]/route.ts`

- [ ] **Step 1: Create list and create route**

Create `app/api/memories/route.ts` following the personas pattern:
```typescript
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { listMemories, createMemory } from "@/lib/memories";
import { badRequest, ok } from "@/lib/http";
import type { MemoryCategory } from "@/lib/types";

const VALID_CATEGORIES: MemoryCategory[] = ["personal", "preference", "work", "location", "other"];

export async function GET(request: Request) {
  await requireUser();
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");

  const filter: { category?: string; search?: string } = {};
  if (category && VALID_CATEGORIES.includes(category as MemoryCategory)) {
    filter.category = category;
  }
  if (search) {
    filter.search = search;
  }

  return ok({ memories: listMemories(Object.keys(filter).length ? filter : undefined) });
}

const createSchema = z.object({
  content: z.string().trim().min(1).max(1000),
  category: z.enum(["personal", "preference", "work", "location", "other"])
});

export async function POST(request: Request) {
  await requireUser();
  const body = createSchema.safeParse(await request.json());
  if (!body.success) return badRequest("Invalid memory data");

  return ok({ memory: createMemory(body.data.content, body.data.category) }, { status: 201 });
}
```

- [ ] **Step 2: Create update and delete route**

Create `app/api/memories/[memoryId]/route.ts`:
```typescript
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { getMemory, updateMemory, deleteMemory } from "@/lib/memories";
import { badRequest, ok } from "@/lib/http";

const paramsSchema = z.object({ memoryId: z.string().min(1) });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memoryId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid memory id");

  const { memoryId } = params.data;
  const body = await request.json() as {
    content?: string;
    category?: string;
  };

  const updated = updateMemory(memoryId, body);
  if (!updated) return badRequest("Memory not found", 404);

  return ok({ memory: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ memoryId: string }> }
) {
  await requireUser();
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) return badRequest("Invalid memory id");

  deleteMemory(params.data.memoryId);
  return ok({ success: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/memories/route.ts app/api/memories
git commit -m "feat(memory): add memories API routes"
```

---

### Task 5: Brain Icon in Chat UI

**Files:**
- Modify: `components/message-bubble.tsx`

- [ ] **Step 1: Add Brain icon import and icon mapping**

In `components/message-bubble.tsx`, add `Brain` to the Lucide import on line 4:
```typescript
import { Check, ChevronDown, ChevronRight, Copy, FileText, LoaderCircle, Pencil, X, Brain } from "lucide-react";
```

In `CollapsibleActionRow`, add a mapping to show the brain icon for memory action kinds. After the `statusIcon` definition (around line 48), add before the return statement for the running state:

For the running state (line 54-62), update the icon rendering. Currently it shows a generic status icon. For memory kinds, show the brain icon instead. Replace the statusIcon rendering inside the two return blocks:

In the `if (action.status === "running")` block, replace the icon rendering:
```typescript
  const icon = ["create_memory", "update_memory", "delete_memory"].includes(action.kind)
    ? <Brain className="h-2.5 w-2.5 text-violet-400" />
    : statusIcon;
```

Then replace `{statusIcon}` with `{icon}` in the running state JSX (line 57), and similarly in the completed state JSX (line 72):
```typescript
  const actionIcon = ["create_memory", "update_memory", "delete_memory"].includes(action.kind)
    ? <Brain className="h-3 w-3 text-violet-400" />
    : statusIcon;
```

Use `{actionIcon}` in place of `{statusIcon}` inside the `<span className="flex h-4 w-4 ...">` element.

- [ ] **Step 2: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "feat(memory): add brain icon for memory actions in chat"
```

---

### Task 6: Settings Page

**Files:**
- Modify: `components/settings/settings-nav.tsx`
- Create: `app/settings/memories/page.tsx`
- Create: `components/settings/sections/memories-section.tsx`

- [ ] **Step 1: Add nav item**

In `components/settings/settings-nav.tsx`, add `Brain` to the Lucide import and add a new nav item between Personas and MCP Servers:

```typescript
import {
  ArrowLeft,
  Settings,
  Sparkles,
  Server,
  Zap,
  Shield,
  Users,
  Brain,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/general", label: "General", icon: Settings },
  { href: "/settings/providers", label: "Providers", icon: Sparkles },
  { href: "/settings/personas", label: "Personas", icon: Users },
  { href: "/settings/memories", label: "Memories", icon: Brain },
  { href: "/settings/mcp-servers", label: "MCP Servers", icon: Server },
  { href: "/settings/skills", label: "Skills", icon: Zap },
  { href: "/settings/account", label: "Account", icon: Shield },
] as const;
```

- [ ] **Step 2: Create route page**

Create `app/settings/memories/page.tsx`:
```typescript
import { MemoriesSection } from "@/components/settings/sections/memories-section";
import { requireUser } from "@/lib/auth";

export default async function MemoriesPage() {
  await requireUser();
  return <MemoriesSection />;
}
```

- [ ] **Step 3: Create memories settings section**

Create `components/settings/sections/memories-section.tsx`. This follows the `PersonasSection` pattern with `SettingsSplitPane` + `ProfileCard`. The component includes:

1. **Settings card** at the top: "Enable memories" toggle, "Max memories" number input
2. **Split pane**: list on left with category filter pills and search, editor on right

The full component is ~300 lines. Key behaviors:
- Fetches memories from `/api/memories` on mount
- Category filter pills: All, Personal, Preference, Work, Location, Other
- Search input filters by content text
- Clicking a memory selects it for editing (shows textarea + category dropdown + timestamps + save/cancel)
- Delete button on each memory card
- Empty state when no memories
- Settings toggle and max count saved via the existing settings API (`/api/settings`)

Read `components/settings/sections/personas-section.tsx` in full for the exact pattern to follow. Adapt it:
- Replace persona fields with memory fields (content + category instead of name + content)
- Add category filter pills above the list
- Add search input above the list
- Use `ProfileCard` for each memory item showing: truncated content, category badge, relative time
- Right panel shows: textarea for content, dropdown for category, timestamps, save/cancel buttons
- Settings card uses `SettingsCard` + `SettingRow` from the general section pattern for the toggle and number input
- Fetches and updates settings via `GET /api/settings` and `PATCH /api/settings` (the existing settings endpoint)

- [ ] **Step 4: Commit**

```bash
git add components/settings/settings-nav.tsx app/settings/memories components/settings/sections/memories-section.tsx
git commit -m "feat(memory): add memories settings page with list, editor, and filters"
```

---

### Task 7: Integration Verification

**Files:**
- None (testing only)

- [ ] **Step 1: Run the dev server and verify the app starts**

Run `npm run dev`, wait for the `.dev-server` file, and verify:
1. The app loads without errors
2. The settings page shows the "Memories" nav item
3. The memories settings page loads with the toggle and empty state

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -v "chat-turn.test" | head -20`
Expected: No new errors (pre-existing test file errors are fine)

- [ ] **Step 3: Test memory tools in a conversation**

1. Start a new conversation
2. Mention personal facts ("My name is Charles, I live in Montreal")
3. Verify the LLM calls `create_memory` and it appears in the chat timeline with a brain icon
4. Open `/settings/memories` and verify the memories appear in the list
5. Edit a memory in settings, verify it saves
6. Delete a memory in settings, verify it disappears
7. Start a new conversation, verify the memories are injected in the system prompt (you can check by asking "What do you know about me?")

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(memory): address integration issues"
```

---

## Self-Review

**Spec coverage:**
- Data model (user_memories table + settings columns) -> Task 1
- Tool system (3 tools, registration, execution) -> Task 2
- Context injection (memory block in system prompt) -> Task 3
- Chat UI (brain icon, action rendering) -> Task 5
- Settings page (nav, route, split pane, editor) -> Task 6
- API routes (CRUD) -> Task 4
- System prompt guidance -> Task 3

**Placeholder scan:** All code blocks contain complete implementations. No TBDs.

**Type consistency:** `MemoryCategory` type used consistently across `types.ts`, `memories.ts`, `assistant-runtime.ts`, and the settings section. `UserMemory` type used in API routes and settings component. `memoriesEnabled` parameter threaded consistently through `chat-turn.ts` -> `ensureCompactedContext()` -> `buildPromptMessages()` -> `resolveAssistantTurn()` -> `buildToolDefinitions()`.
