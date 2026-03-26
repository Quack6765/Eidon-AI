# API

## Style
- **Type:** REST-style route handlers
- **Base Path:** `/api`

## Patterns
- **Read Operations:** `GET` routes return JSON via `NextResponse.json`
- **Write Operations:** `POST`, `PUT`, and `DELETE` mutate SQLite through `lib/` helpers
- **Async Operations:** Chat streaming uses `ReadableStream` and `text/event-stream`

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
