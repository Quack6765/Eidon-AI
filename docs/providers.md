# Providers

Eidon ships no API key. You add provider profiles, and every chat routes through the profile you pick. This covers the built-in presets, the settings on each profile, the GitHub Copilot OAuth flow, and the non-chat providers for web search, image generation, and speech-to-text.

Chat provider profiles live under **Settings → Providers** and are admin-only.

## Provider kinds

Every profile has one of three kinds, which determines how Eidon talks to the endpoint.

| Kind | Wire protocol | Connection | Model selection |
| --- | --- | --- | --- |
| `openai_compatible` | OpenAI Responses API or Chat Completions API, selectable per profile | API key | Typed in manually |
| `anthropic` | Anthropic Messages API | API key | Typed in manually |
| `github_copilot` | GitHub Copilot API | OAuth (GitHub App) | Discovered from the connected account |

Because the first two kinds only need a base URL and a key, **any service exposing an OpenAI-compatible or an Anthropic Messages API can be connected manually** — pick the matching kind, paste the base URL, paste the key, and type the model id. The presets below are shortcuts, not a whitelist.

## Built-in presets

Selecting a preset fills in the base URL, a starting model, the API mode, and sensible context and sampling defaults. You can edit anything afterwards; a profile that no longer matches a preset simply stops being labelled as one.

| Preset | Kind | Base URL | Starting model | API mode |
| --- | --- | --- | --- | --- |
| OpenAI | `openai_compatible` | `https://api.openai.com/v1` | `gpt-5.6-luna` | Responses |
| Anthropic | `anthropic` | `https://api.anthropic.com` | `claude-opus-4-8` | Messages |
| OpenRouter | `openai_compatible` | `https://openrouter.ai/api/v1` | none — pick your own | Responses |
| Ollama Cloud | `openai_compatible` | `https://ollama.com/v1` | `glm-4.7:cloud` | Chat Completions |
| GLM Coding Plan | `openai_compatible` | `https://api.z.ai/api/coding/paas/v4` | `glm-5.1` | Chat Completions |
| DeepSeek | `openai_compatible` | `https://api.deepseek.com` | `deepseek-v4-flash` | Chat Completions |
| Xiaomi Mimo | `openai_compatible` | `https://api.xiaomimimo.com/v1` | `mimo-v2.5` | Chat Completions |
| OpenCode Go | `openai_compatible` | `https://opencode.ai/zen/go/v1` | `kimi-k2.6` | Chat Completions |
| OpenCode Go | `anthropic` | `https://opencode.ai/zen/go` | `qwen3.7-max` | Messages |

OpenCode Go appears twice because it exposes both an OpenAI-compatible and an Anthropic-compatible surface; choose whichever kind matches the model you want.

Notable preset defaults: Ollama Cloud uses mirrored reasoning parameters and a 64K context limit; DeepSeek defaults to temperature 1.3 and a 1M context limit; Xiaomi Mimo defaults to a ~1M context limit with native vision on; OpenAI defaults to a 1.05M context limit, 128K max output, and native vision on.

GitHub Copilot has no preset — it is configured entirely through the OAuth connection described below.

## Per-profile settings

Each profile carries its own behavior, so you can keep, say, a cheap fast profile and a long-context reasoning profile side by side and switch between them in the composer.

### Model and prompt

| Setting | Default | Notes |
| --- | --- | --- |
| System prompt | A step-by-step reasoning prompt | Prepended to every turn using this profile |
| Temperature | `0.7` | Only offered when the endpoint and model support it. It is hidden for the official OpenAI endpoint and for models the model registry knows reject it |
| Max output tokens | `1200` | Raise this for long answers; several presets raise it for you |
| Reasoning effort | `medium` | `none`, `low`, `medium`, `high`, `xhigh`. `max` is additionally offered on the official OpenAI endpoint with a `gpt-5.6*` model |
| Reasoning summaries | on | Streams the model's reasoning summary into the message's thinking block when the provider emits one |
| Processing mode | `standard` | `standard` or `fast`, offered only on the official OpenAI endpoint |

### Context and compaction

| Setting | Default | Notes |
| --- | --- | --- |
| Model context limit | `200000` | Drives the context gauge and when compaction triggers |
| Compaction threshold | `0.8` | Fraction of the context limit at which hierarchical compaction runs |
| Fresh tail count | `28` | Most recent messages always kept verbatim |
| Tokenizer | `gpt-tokenizer` | Or `off` to skip token counting entirely |
| Safety margin tokens | `1200` | Reserve held back from the limit |
| Leaf source token limit | `12000` | Size of a chunk summarized into one leaf node |
| Leaf minimum message count | `6` | Fewest messages that will be folded into a leaf |
| Merged minimum node count | `4` | Leaf nodes needed before they are merged upward |
| Merged target tokens | `1600` | Target size of a merged summary |

The compaction settings shape the hierarchical summary tree described in [Features](./features.md#chat). The defaults are reasonable; treat the lower five as tuning knobs, not required setup.

### Vision

`visionMode` decides how images reach the model:

| Mode | Behaviour |
| --- | --- |
| `none` | Images are attached to the conversation but never sent to the model |
| `native` | Images are sent inline in the request. Falls back to `none` if the model is not known to accept image input |
| `mcp` | Image handling is delegated to MCP servers flagged as vision servers. Their tools are only exposed to the model in this mode |
| `provider` | A second provider profile does the looking. Set `visionProviderProfileId` to that profile, and the model gets an `analyze_image` tool that routes image paths to it |

`provider` mode is how you give a strong text model that cannot see images a vision capability: point it at a small vision-capable profile. The referenced profile cannot be the profile itself, and if it is deleted the profile falls back to `none`.

## GitHub Copilot

Eidon can route chats through your GitHub Copilot subscription instead of a direct provider API key. This requires a GitHub App you own, because the OAuth flow runs against your own client credentials.

### 1. Register the GitHub App

1. Go to [github.com/settings/developers](https://github.com/settings/developers) and create a new GitHub App.
2. Use your Eidon URL as the homepage.
3. Set the callback URL to `https://<your-host>/api/providers/github/callback`.
4. Under user authorization, enable OAuth during installation.
5. Copy the Client ID and generate a Client Secret.

### 2. Set the environment variables

```bash
EIDON_GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxx
EIDON_GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EIDON_GITHUB_APP_CALLBACK_URL=https://your-host/api/providers/github/callback
```

All three are required. Without them the GitHub Copilot profile type is still visible in settings, but **Connect GitHub** cannot complete. See [Configuration](./configuration.md#environment-variables).

### 3. Connect a profile

1. Open **Settings → Providers**.
2. Add a profile and switch **Provider type** to **GitHub Copilot**.
3. Click **Connect GitHub**.
4. Approve the authorization flow.
5. Pick a model from the discovered list and start chatting.

Access and refresh tokens are encrypted with `EIDON_ENCRYPTION_SECRET` before being stored. Copilot profiles do not expose temperature, API mode, or tokenizer settings — those are fixed by the Copilot API.

## OpenCode Go specifics

Two behaviors are automatic for any profile whose base URL starts with `https://opencode.ai/zen/go`:

- **Per-conversation session header.** Requests carry an `x-opencode-session` header set to the conversation id (falling back to the profile id), so the upstream service can key its own session state per conversation.
- **Per-model API mode override.** The OpenAI-compatible OpenCode Go preset defaults to Chat Completions, but any model whose id starts with `gpt-5.6` is sent over the Responses API regardless of the profile's configured mode. This is a request rule attached to the preset, so it only applies when the profile's base URL still matches the preset's.

## Web search

Configured under **Settings → General** as a single global, admin-managed selection. When enabled, the model gets a `web_search` tool.

| Provider | Credential | Notes |
| --- | --- | --- |
| Exa | none | Works without an API key — the default choice |
| Tavily | API key required | |
| SearXNG | none | Requires the base URL of your own instance; must be an `http(s)` URL with no credentials or fragment |
| Disabled | — | Removes the `web_search` tool |

A search pipeline mode controls query fan-out: `auto` (the default), `always`, or `off`, with a maximum of 1–5 parallel queries (default 4). With fan-out on, the tool accepts several distinct queries in one call and runs them in parallel, and a single complex query is decomposed automatically. See [Features](./features.md#deep-research) for how deep research uses this.

## Image generation

Also a global, admin-managed selection under **Settings → General**. When configured, the model gets a `generate_image` tool that returns images as attachments on its reply.

| Provider | Models | Options |
| --- | --- | --- |
| Google Nano Banana | `gemini-3.1-flash-image-preview` (default), `gemini-3-pro-image-preview`, `gemini-2.5-flash-image` | API key required |
| OpenAI GPT Image | `gpt-image-2` | API key required; quality `auto` (default), `low`, `medium`, `high` |
| Disabled | — | Removes the `generate_image` tool |

The tool itself accepts a prompt, an optional negative prompt, an aspect ratio (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`), and a count of 1–4.

## Speech-to-text

Dictation in the composer. Also a global, admin-managed selection.

| Provider | Engine | Credential | Languages |
| --- | --- | --- | --- |
| Browser speech recognition | Browser Web Speech API | none | Auto, English, French, Spanish |
| Canary 180M Flash | Embedded, offline | none | English, French, Spanish (no auto-detect) |
| ElevenLabs | External API | API key | Scribe v2 language list |
| AssemblyAI | External API | API key | Universal 3.5 Pro model list; automatic detection works best with 15+ seconds of speech |
| Soniox | External API | API key | `stt-rt-v5`, multi-language selection |

The Canary option runs entirely on the server through `sherpa-onnx`. Its model files are downloaded from Hugging Face on first use, pinned to a specific revision and verified by size and SHA-256, then cached under `model-cache/` in the data directory. Audio is capped at 5 minutes per transcription.

An optional cleanup pass can run the raw transcript through a provider profile to strip filler words, fix punctuation, apply spoken corrections, and expand dictation commands, without answering anything the transcript happens to ask. The prompt is editable in settings.

## See also

- [Configuration](./configuration.md) — environment variables and secret handling
- [MCP and skills](./mcp-and-skills.md) — MCP servers, OAuth, and the vision MCP backend
- [Features](./features.md) — the full capability reference
- [Development](./development.md) — local setup and architecture
- [README](../README.md)
