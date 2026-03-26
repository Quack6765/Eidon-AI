# External Services

## Active Integrations
| Service | Purpose | Config |
|---------|---------|--------|
| OpenAI-compatible API | Chat inference, streaming, and compaction summarization | Stored in `app_settings` from `/settings` |

## OpenAI-compatible API
- **Endpoint:** User-configurable `apiBaseUrl`
- **Auth:** API key
- **Usage:** Main chat responses and memory compaction summarization in `lib/provider.ts`
- **Error Handling:** Bubble provider failures back to the UI with explicit error messages; no silent fallback provider
