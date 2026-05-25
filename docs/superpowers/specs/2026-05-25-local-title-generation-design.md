# Local LLM Title Generation

## Problem

Conversation title generation currently uses the same LLM provider as the conversation itself (`callProviderText()`). Every new conversation triggers an API call that costs tokens, adds latency, and requires an active provider with a valid API key. If no provider is configured, title generation silently fails.

## Solution

Replace the remote LLM API call with a local SmolLM2-135M-Instruct model running server-side via `@huggingface/transformers` (onnxruntime-node backend). The model runs on CPU, requires no GPU, and generates titles in under 1 second. It is completely hidden from the user — no UI, no settings, no provider listing.

## Model

- **Model:** HuggingFaceTB/SmolLM2-135M-Instruct
- **Format:** ONNX, q4 quantized (~118 MB on disk)
- **Backend:** `@huggingface/transformers` + `onnxruntime-node` (native C++ bindings, not WASM)
- **Device:** CPU only (no GPU required)
- **Latency:** ~0.1–0.5 seconds for ~10 tokens on modern CPU
- **Loading:** Singleton — loaded once on first title generation request, reused for all subsequent requests (~1–2s cold start)

## Packaging

### Docker
- Model pre-downloaded during `docker build` into `./.cache/huggingface/`.
- Adds ~118 MB to image size.
- Uses `local_files_only: true` to prevent runtime downloads.

### Local dev (`npm run dev`)
- Model auto-downloads on first title generation request.
- Cached in `.cache/huggingface/` (or configurable via `env.cacheDir`).
- Subsequent startups use cached model (no network needed).

## System Prompt

```
Generate a short conversation title from the user's first message.
Return only the title.
Prefer 2 to 4 words.
Keep it natural and specific.
Do not use quotes, markdown, labels, or trailing punctuation.
```

This is the same prompt currently used in `buildConversationTitlePrompt()` — the local model receives it as a system message via the chat template.

## Architecture

```
User sends first message
  → chat-turn.ts: startChatTurn()
    → void generateConversationTitleFromFirstUserMessage()
      → claimConversationTitleGeneration()     [atomic SQL claim, unchanged]
      → generateConversationTitle({ firstMessage })
        → SmolLM2-135M-Instruct (local ONNX, CPU)
          → system prompt + user message → ~10 tokens generated
        → sanitizeGeneratedConversationTitle()  [unchanged]
      → completeConversationTitleGeneration()   [unchanged]
      → broadcastAll({ type: "conversation_title_updated" })  [unchanged]
```

## Files Changed

### `lib/conversation-title-generator.ts`
- Remove `callProviderText` import and `ProviderProfileWithApiKey` dependency.
- Remove `buildConversationTitlePrompt()`.
- Add `@huggingface/transformers` import.
- Add singleton model pipeline initialization (lazy-loaded, cached).
- Rewrite `generateConversationTitle()` to accept `{ firstMessage: string }` only and use local model inference internally.
- Keep `sanitizeGeneratedConversationTitle()`, `DEFAULT_CONVERSATION_TITLE`, `DEFAULT_ATTACHMENT_ONLY_CONVERSATION_TITLE`, `MAX_CONVERSATION_TITLE_LENGTH` unchanged.

### `lib/conversations.ts`
- Simplify `generateConversationTitleFromFirstUserMessage()` (lines 2449–2532):
  - Remove provider resolution (`getProviderProfileWithApiKey`, `getDefaultProviderProfileWithApiKey`).
  - Remove API key check (`if (!settings?.apiKey)`).
  - Call `generateConversationTitle({ firstMessage: trimmedContent })` directly (no `settings` parameter).
- `claimConversationTitleGeneration()`, `completeConversationTitleGeneration()`, `failConversationTitleGeneration()` remain unchanged.

### `Dockerfile`
- Add a build stage to pre-download the SmolLM2-135M-Instruct ONNX model (q4 quantized) into the cache directory.
- Ensure `.cache/huggingface/` is copied into the runner stage.

### `package.json`
- Add `@huggingface/transformers` as a production dependency.
- `onnxruntime-node` is a transitive dependency (auto-installed).

### Tests
- `tests/unit/conversation-title-generator.test.ts` — update tests to match new function signature (no `settings` parameter), mock the model pipeline.
- `tests/unit/conversations.test.ts` — update title generation integration tests to remove provider/API key setup.

## Not Changed
- WebSocket protocol (`ws-protocol.ts`) — same `conversation_title_updated` message.
- Client-side code (`sidebar.tsx`, `chat-view.tsx`, `conversation-events.ts`, `ws-client.ts`) — receives title the same way.
- Database schema — same `title_generation_status` column.
- `chat-turn.ts` trigger — still calls `generateConversationTitleFromFirstUserMessage()` fire-and-forget.
- `provider.ts` — no changes (just no longer called for title generation).

## Error Handling
- If model fails to load: fall back to `DEFAULT_CONVERSATION_TITLE` ("Conversation").
- If model inference fails: `failConversationTitleGeneration()` is called (sets status to "failed", resets title to "Conversation").
- If model is not cached (first run in dev): auto-download with progress logging to console. Title generation waits for download to complete.

## Constraints
- Hidden from users — no UI, no settings, no provider listing.
- CPU-only — no GPU required.
- Works in Docker (model pre-baked) and local dev (model auto-downloads).
- Title generation survives browser close (server-side).
- Model is a singleton — loaded once, reused across all conversations.
