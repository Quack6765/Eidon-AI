# Jobs

## Scheduled Tasks
| Job | Schedule | Purpose |
|-----|----------|---------|
| [Name] | [Cron / Interval] | [What it does] |

## Background Processing
- **Queue System:** No durable queue. Conversation title generation runs as fire-and-forget async work from the chat route after the first user message is stored
- **Retry Policy:** None for auto-titles. If the provider is unavailable or title generation fails, the conversation stays on the placeholder title and the status becomes `failed`

## Conventions
- **Idempotency:** Background helpers should claim work atomically before running. Conversation auto-titles only claim once from `pending` to `running`
- **Timeout:** Background title generation should stay small and reuse the profile model with a short output budget
- **Logging:** Keep the flow silent to the user; failures update state instead of emitting UI-visible notices
