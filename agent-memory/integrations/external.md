# External Services

## Active Integrations
| Service | Purpose | Config |
|---------|---------|--------|
| OpenAI-compatible API | Chat inference, streaming, and compaction summarization | Stored in `app_settings` from `/settings` |

## OpenAI-compatible API
- **Endpoint:** User-configurable `apiBaseUrl`
- **Auth:** API key
- **Usage:** Main chat responses and memory compaction summarization in `lib/provider.ts`
- **Preset Shortcuts:** Settings can prefill Ollama Cloud (`https://ollama.com/v1`), Z.AI GLM Coding Plan (`https://api.z.ai/api/coding/paas/v4`), or a generic OpenAI-compatible default (`https://api.openai.com/v1`)
- **Reasoning Visibility:** Hermes requests visible reasoning for supported models; OpenAI reasoning models use Responses API summaries, while Z.AI `glm-5`/`glm-4.7` style models can surface thinking through `chat.completions` reasoning deltas
- **Text Normalization:** Provider deltas and final text normalize escaped newline sequences like `\\n` and `\\r\\n` into real line breaks before persistence and rendering
- **Error Handling:** Bubble provider failures back to the UI with explicit error messages; no silent fallback provider
