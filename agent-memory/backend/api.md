# API

## Style
- **Type:** REST-style route handlers
- **Base Path:** `/api`

## Patterns
- **Read Operations:** `GET` routes return JSON via `NextResponse.json`
- **Write Operations:** `POST`, `PUT`, and `DELETE` mutate SQLite through `lib/` helpers
- **Async Operations:** Chat streaming uses `ReadableStream` and `text/event-stream`
- **Sidebar Writes:** `PATCH /api/conversations/[conversationId]` updates a conversation folder assignment, and `PUT /api/folders` persists folder reorder payloads as ordered folder id arrays
- **Settings Writes:** `PUT /api/settings` saves the full provider profile collection plus the default profile id
- **Conversation Runtime Selection:** `PATCH /api/conversations/[conversationId]` also accepts `providerProfileId` so the active thread can switch presets without leaving chat

## Response Format
```
{
  "resource": "payloads are returned under descriptive keys"
}
```

Errors return:
```
{
  "error": "human readable message"
}
```

## Versioning
- **Strategy:** None
