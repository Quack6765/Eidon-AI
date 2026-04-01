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
- **Conversation Creation:** `POST /api/conversations` accepts optional `title`, `folderId`, `providerProfileId`, and `toolExecutionMode`, and empty JSON bodies are treated as the default new-chat flow
- **Settings Writes:** `PUT /api/settings` saves the full provider profile collection plus the default profile id
- **Conversation Runtime Selection:** `PATCH /api/conversations/[conversationId]` also accepts `providerProfileId` and `toolExecutionMode` so the active thread can switch presets and tool permissions without leaving chat
- **Message Editing:** `PATCH /api/messages/[messageId]` updates persisted user-message content and returns the refreshed `message` payload for the chat view
- **Chat Streaming Events:** `POST /api/conversations/[conversationId]/chat` streams `thinking_delta`, `answer_delta`, `system_notice`, `action_start`, `action_complete`, `action_error`, `done`, and `error` SSE events
- **Chat Attachments:** `POST /api/attachments` accepts authenticated multipart uploads for images and text-like files scoped to an existing conversation; `GET /api/attachments/[attachmentId]` serves stored attachment bytes back to authenticated users; `DELETE /api/attachments/[attachmentId]` removes only unbound pending uploads
- **Chat Send Payload:** `POST /api/conversations/[conversationId]/chat` accepts either non-empty `message`, `attachmentIds`, or both; uploaded attachment ids are bound onto the created user message before provider streaming starts
- **Message Action Persistence:** Assistant tool activity is stored separately from message content in `message_actions` rows keyed by `message_id`, then attached back onto assistant messages when conversations are loaded. Persisted action kinds now include `skill_load`, `mcp_tool_call`, and `shell_command`
- **Assistant Capability Inventory:** `POST /api/conversations/[conversationId]/chat` feeds enabled skills, configured MCP servers, and discovered executable tools into the assistant runtime; direct capability questions can be answered deterministically before the provider call
- **Assistant Skill Runtime:** `POST /api/conversations/[conversationId]/chat` supports progressive skill loading via `SKILL_REQUEST` and restricted host-side shell execution via `SHELL_CALL` for loaded skills that explicitly allow it through skill metadata. The model decides when to request a full skill based on the exposed skill header metadata instead of server-side keyword heuristics
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
