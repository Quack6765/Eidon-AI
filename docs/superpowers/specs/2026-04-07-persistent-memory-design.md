# Persistent Memory Design

## Summary

Add a cross-conversation persistent memory system that lets the LLM automatically save, update, and delete facts about the user. Memories are stored in SQLite and injected into every conversation's system prompt. The LLM decides conservatively when to save — only durable, recurring facts that are likely to come up in future conversations. Memory operations appear as visible tool calls in the chat, and a dedicated settings page lets the user view, edit, and delete memories.

## Data Model

### New table: `user_memories`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `TEXT PRIMARY KEY` | Nanoid-generated unique identifier |
| `content` | `TEXT NOT NULL` | The fact, e.g. "User lives in Montreal" |
| `category` | `TEXT NOT NULL` | One of: `personal`, `preference`, `work`, `location`, `other` |
| `created_at` | `TEXT NOT NULL` | ISO 8601 timestamp |
| `updated_at` | `TEXT NOT NULL` | ISO 8601 timestamp, bumped on update |

Single-user app — no user_id foreign key needed. Cap of 100 memories by default (configurable via `memories_max_count` setting).

### New columns on `app_settings`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `memories_enabled` | `INTEGER` | `1` | Global toggle to enable/disable the feature |
| `memories_max_count` | `INTEGER` | `100` | Maximum number of memories allowed |

## Tool System

Three new tools registered in `buildToolDefinitions()` when `memories_enabled` is true. They follow the same pattern as existing tools (MCP, skill load, shell command).

### `create_memory`

Parameters:
- `content` (string, required) — The fact to remember
- `category` (string, required) — One of: `personal`, `preference`, `work`, `location`, `other`

Behavior:
- Insert a new row into `user_memories`
- If the current count equals `memories_max_count`, return an error telling the LLM to update or delete an existing memory instead
- Fire `onActionStart` / `onActionComplete` callbacks to create a `MessageAction` record
- Show in chat: "Saved memory: [content]" with category badge and brain icon

### `update_memory`

Parameters:
- `id` (string, required) — The memory ID to update
- `content` (string, required) — The updated fact
- `category` (string, optional) — New category if changing

Behavior:
- Fetch the existing memory; if not found, return an error
- Update the row, set `updated_at` to now
- Store the old content in the `MessageAction.detail` field (for display: "was: [old content]")
- Fire `onActionStart` / `onActionComplete` callbacks
- Show in chat: "Updated memory: [new content]" with "was: [old content]" detail

### `delete_memory`

Parameters:
- `id` (string, required) — The memory ID to delete

Behavior:
- Fetch the existing memory; if not found, return an error
- Store the content in the `MessageAction.detail` field before deleting
- Delete the row from `user_memories`
- Fire `onActionStart` / `onActionComplete` callbacks
- Show in chat: "Deleted memory: [content]"

### System prompt guidance

When memories are enabled, the system prompt includes:

```
You have access to memory tools (create_memory, update_memory, delete_memory) to persist facts about the user across conversations. Use these conservatively — only save durable, recurring facts (name, location, preferences, work details). Do not save transient details about the current task. Before creating a new memory, check if a similar one already exists and update it instead. The user can see and manage all memories in their settings.
```

## Context Injection

Memories are injected into the system prompt inside `ensureCompactedContext()` in `compaction.ts`, after persona content and before conversation-scoped context.

### Format

```
<memory>
abc123: [personal] User lives in Montreal
def456: [preference] Prefers TypeScript over JavaScript
ghi789: [work] Full-stack developer at Acme Corp
</memory>
```

Each line shows: `[nanoid]: [category] [content]`. The LLM uses the nanoid to reference memories in `update_memory` and `delete_memory` calls.

### Token budget

With a cap of 100 memories at ~10 tokens each, this adds roughly 1,000 tokens — modest compared to the typical 4K-8K system prompt. The existing compaction system manages the overall context budget; no separate handling needed.

### Context window order

1. System instructions (existing)
2. Persona content (existing)
3. Memory block (new)
4. Compacted context / memory nodes (existing)
5. Recent messages (existing)

## Chat UI

Memory tool calls reuse the existing `MessageAction` system. No new UI components — just new `kind` values in the existing action renderer.

### MessageAction kinds

- `create_memory` — Brain icon, label "Saved memory", content + category badge as detail
- `update_memory` — Brain icon, label "Updated memory", new content + "was: [old content]" detail
- `delete_memory` — Brain icon, label "Deleted memory", removed content as detail

### Rendering

These are handled in the existing switch/if chain that renders `MessageActionTimelineItem` types. The brain icon comes from Lucide (`Brain`).

## Settings Page

New route: `/settings/memories`, added to `settings-nav.tsx`.

### Layout

Follows the `SettingsSplitPane` pattern (used by personas, skills, MCP servers) — list on the left, detail/editor on the right.

### Settings card (above split pane)

- "Enable memories" toggle — maps to `memories_enabled` in `app_settings`
- "Max memories" number input — maps to `memories_max_count`

### Left panel (list)

- Category filter pills: All, Personal, Preference, Work, Location, Other
- Search input to filter memories by content text
- Each memory item shows: truncated content, category badge, relative timestamp
- Click to select for editing
- Delete button (trash icon) on each item
- Empty state: "No memories yet. The assistant will automatically save important facts about you as you chat."

### Right panel (detail/editor)

- Selected state: editable textarea for content, category dropdown, created/updated timestamps, Save and Cancel buttons
- Unselected state: brief description of how the memory feature works

## Data Access Layer

New file: `lib/memories.ts`

Functions following the existing pattern (direct `better-sqlite3` prepared statements):

- `listMemories(filter?: { category?: string, search?: string })` — List memories with optional category and text search filters
- `getMemory(id: string)` — Get a single memory by ID
- `createMemory(content: string, category: string)` — Insert a new memory
- `updateMemory(id: string, content: string, category?: string)` — Update an existing memory
- `deleteMemory(id: string)` — Delete a memory
- `getMemoryCount()` — Get total count (for enforcing max)

## Files Changed

| File | Change |
|------|--------|
| `lib/db.ts` | Add `user_memories` table migration + `memories_enabled` / `memories_max_count` columns on `app_settings` |
| `lib/memories.ts` | New file — data access layer |
| `lib/types.ts` | Add `UserMemory` type, add memory kinds to `MessageActionKind` |
| `lib/assistant-runtime.ts` | Register memory tools in `buildToolDefinitions()`, add executor functions |
| `lib/compaction.ts` | Inject memory block into system prompt in `ensureCompactedContext()` |
| `lib/constants.ts` | Add default values for new settings |
| `components/settings/settings-nav.tsx` | Add memories route |
| `app/settings/memories/page.tsx` | New route page |
| `components/settings/sections/memories-section.tsx` | New settings section component |
| `components/message/action-timeline-item.tsx` | Handle memory action kinds in renderer |

## Out of Scope

- Recent conversations summary (ChatGPT's "past 15 chats" feature) — deferred
- Vector search / semantic retrieval — deferred; table schema is forward-compatible if needed later
- Per-user memories — Hermes is single-user
- Memory export/import — deferred
