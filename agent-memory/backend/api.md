# API

## Style
- **Type:** REST-style route handlers
- **Base Path:** `/api`

## Patterns
- **Read Operations:** `GET` routes return JSON via `NextResponse.json`
- **Write Operations:** `POST`, `PUT`, and `DELETE` mutate SQLite through `lib/` helpers
- **Async Operations:** Chat streaming uses `ReadableStream` and `text/event-stream`
- **Sidebar Writes:** `PATCH /api/conversations/[conversationId]` updates a conversation folder assignment, and `PUT /api/folders` persists folder reorder payloads as ordered folder id arrays
- **Sidebar Reads:** `GET /api/conversations` is cursor-paginated for the sidebar and returns `conversations`, `nextCursor`, and `hasMore`; the default page size is 10 and older pages are fetched by passing the returned cursor back as `?cursor=...`
- **Settings Writes:** `PUT /api/settings` saves the full provider profile collection plus the default profile id
- **Conversation Runtime Selection:** `PATCH /api/conversations/[conversationId]` also accepts `providerProfileId` and `toolExecutionMode` so the active thread can switch presets and tool permissions without leaving chat
- **Chat Streaming Events:** `POST /api/conversations/[conversationId]/chat` streams `thinking_delta`, `answer_delta`, `system_notice`, `action_start`, `action_complete`, `action_error`, `done`, and `error` SSE events
- **Message Action Persistence:** Assistant tool activity is stored separately from message content in `message_actions` rows keyed by `message_id`, then attached back onto assistant messages when conversations are loaded
- **MCP Connection Testing:** `POST /api/mcp-servers/test` accepts either a saved `serverId` or a draft MCP config and returns negotiated protocol metadata plus discovered tool counts

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
