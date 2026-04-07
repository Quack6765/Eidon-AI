---
name: Personas Feature
description: User-defined markdown prompts appended to system prompt for specialized AI behavior
type: design
---

# Personas Feature Design

## Overview

Personas allow users to define markdown prompts that get appended after the system prompt, enabling specialized AI behavior without modifying the base provider settings. Examples: "Finance Expert", "Senior Python Developer", "Technical Writer".

## Requirements

- Users can create, edit, and delete personas in settings
- Personas contain a name and markdown content
- Persona selection is ephemeral (session-scoped, resets on reload/new conversation)
- "None" is the default selection (no persona applied)
- Selected persona content is appended after system prompt in prompt construction
- Personas are global (shared across all provider profiles)

## Data Model

### Database Schema

```sql
CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### TypeScript Types

```typescript
type Persona = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/personas` | List all personas |
| PUT | `/api/personas` | Upsert personas (create/update batch) |
| DELETE | `/api/personas/:id` | Delete a persona |

## Components

### 1. Personas Settings Page

**Route:** `/settings/personas`

**Layout:** Follows `providers-section.tsx` pattern with `SettingsSplitPane`

**Left Panel:**
- List of persona cards showing name
- Add button (+) in header
- Empty state: "No personas. Create one to specialize AI behavior."

**Right Panel:**
- Name input field
- Markdown textarea for content (same component as system prompt field)
- Save button
- Delete button (disabled if only one persona exists)
- Preview section showing rendered markdown (optional enhancement)

### 2. Settings Navigation

**File:** `components/settings/settings-nav.tsx`

**Add nav item:**
```typescript
{ href: "/settings/personas", label: "Personas", icon: Users }
```

Position: After "Providers", before "MCP Servers"

### 3. Persona Dropdown in Chat Composer

**File:** `components/chat-composer.tsx`

**Location:** Next to model selector (Bot icon)

**Behavior:**
- Shows "None" by default
- Lists all persona names when expanded
- Selection stored in React state (not persisted to database)
- Resets to "None" on page reload or new conversation

## Prompt Construction Flow

**File:** `lib/compaction.ts` — `buildPromptMessages()`

```
buildPromptMessages(input) called
    ↓
systemParts = [input.systemPrompt]
    ↓
If personaId provided in input → fetch persona → systemParts.push(persona.content)
    ↓
Append compacted memory nodes
    ↓
Append visible system messages
    ↓
Return [{ role: "system", content: systemParts.join("\n\n") }, ...]
```

## Files to Create

| File | Purpose |
|------|---------|
| `lib/personas.ts` | Data layer: CRUD operations for personas |
| `app/settings/personas/page.tsx` | Settings page route |
| `components/settings/sections/personas-section.tsx` | Personas settings section |
| `app/api/personas/route.ts` | API routes (GET, PUT) |
| `app/api/personas/[id]/route.ts` | API route (DELETE) |

## Files to Modify

| File | Changes |
|------|---------|
| `lib/db.ts` | Add `personas` table migration |
| `lib/types.ts` | Add `Persona` type |
| `components/settings/settings-nav.tsx` | Add Personas nav item |
| `components/chat-composer.tsx` | Add persona dropdown |
| `components/chat-view.tsx` | Pass persona selection to backend |
| `lib/chat-turn.ts` | Pass persona ID to `ensureCompactedContext` |
| `lib/compaction.ts` | Accept and append persona content in `buildPromptMessages` |

## UX Considerations

- Persona content is markdown — users can format instructions with headers, lists, code blocks
- No character limit enforced (let users decide)
- Empty content validation on save
- Name required (minimum 1 character)