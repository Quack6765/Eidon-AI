# Features

The complete capability reference: what Eidon does, where the controls are, and the limits that apply.

## Chat

**Streaming over WebSocket.** Turns stream over a WebSocket connection rather than an HTTP response, and every event is broadcast to all subscribers of the conversation. Open the same chat in two browsers or on a phone and a laptop, and both watch the same reply arrive token by token. Reconnecting requests a snapshot so a client that was asleep catches up.

**Action timeline.** Each assistant message carries an ordered timeline interleaved with its text: thinking blocks with the model's reasoning summary, and one entry per tool call with its arguments, live status, and result. Statuses are `running`, `pending`, `completed`, `error`, and `stopped`. A per-user preference renders tool calls either as expandable **pills** (default) or as a single compact **status line**.

**Branching and redoing.** Three different ways to change course:

| Action | Where | Effect |
| --- | --- | --- |
| Fork | On an assistant reply | Copies the conversation up to that reply into a new conversation, leaving the original intact |
| Edit and restart | On one of your messages | Rewrites that message and re-runs the turn from there, discarding what followed |
| Regenerate | On an assistant reply | Re-runs the same turn to get a different answer |

A failed turn can also be retried directly.

**Queued follow-ups.** While a reply is streaming you can keep typing. Queued messages are held in order and sent when the current turn finishes. The queue is editable: reorder it, edit an entry, delete one, or push one to the front and send it immediately.

**Context and compaction.** A gauge shows how much of the model's context window the conversation currently occupies. When it crosses the profile's compaction threshold (0.8 by default), Eidon compacts hierarchically rather than truncating: older messages are summarised into leaf nodes, leaf nodes are merged into higher-level summaries as they accumulate, and the most recent messages (28 by default) are always kept verbatim. A system notice marks where compaction happened. The tree parameters are per provider profile — see [Providers](./providers.md#context-and-compaction).

**Temporary chats.** A chat can be marked temporary. It works exactly like a normal conversation while you are in it, but it is kept out of the conversation list, out of search results, and out of the semantic index — useful for a one-off question you do not want cluttering your history.

**Search, folders, and titles.** Conversations are searchable with matching snippets. They can be organised into folders and reordered by drag and drop. Titles are generated automatically, with three modes: reuse the conversation's own provider profile, use a specific profile you nominate, or run a small local model (`SmolLM2-360M-Instruct`) on the server so titling costs nothing at your provider.

**Retention.** A per-user retention setting keeps conversations `forever` (default) or prunes them after `90d`, `30d`, or `7d`.

**Share links.** Any conversation can be given a public read-only link at `/share/<token>`. The share view serves the transcript and that conversation's attachments without authentication — the token is the credential. Turning sharing off deletes the token, so old links stop working and re-enabling produces a new one. See [Security and storage notes](./configuration.md#security-and-storage-notes).

**Per-conversation overrides.** Each conversation remembers its own provider profile and reasoning effort, so you can move one thread to a stronger model without touching the rest.

## Bot teammates

The **Agents** area gives every user a team of persistent bots, up to **25 per user**. A **Chief of Staff** is created automatically; message it like any teammate.

**Peer-to-peer messaging.** Any bot can message any other bot with the `message_bot` tool — this is not a chief-only hub-and-spoke arrangement. The call returns immediately with an acknowledgement; the target bot runs the task in **its own conversation**, with its own workspace and browser session, and when it finishes its reply is injected back into the sender's thread as a new message. The sender is instructed to report that reply to the user rather than messaging the bot back.

Only the Chief of Staff can call `create_bot` and `update_bot`. Other bots that need a new teammate or a changed role are told to message the chief.

**Isolated sandbox.** Every bot gets:

- its own workspace directory under `bot-workspaces/<user>/<bot>/`, which is the working directory for its shell commands
- its own `agent-browser` session with a dedicated socket directory, so its cookies and logins are entirely separate from every other bot's

**Status and visibility.** Each bot shows a live status of `idle`, `queued`, or `running`. A **Waiting for input** indicator appears when a bot has left a proposal pending your approval. Runs are recorded with their trigger source — a direct message, another bot's delegation, or a scheduled routine — plus timings and any error.

**Per-bot state.** For each bot you can browse its workspace file tree, read and manage its private memories, and reset its browser session (which closes any open browser and wipes that session's directory). Bots read the shared account memory but their memory tools write into their own pool, so one bot's notes never leak into another's.

**Routines.** An automation can be bound to a bot, so the scheduled run happens inside that bot's thread with that bot's workspace and browser.

Bots use the provider profiles and settings already configured in the workspace. A shared base system prompt for all bots is editable in settings, and each bot's own prompt can be refined by the chief.

## Deep research

A toggle in the composer switches a turn into deep research mode.

**Plan first.** Eidon drafts a research plan for your request, then shows it to you as an editable card before any searching starts. You can rewrite each step, reorder them, add or remove steps, or regenerate the whole plan, then press **Start research**. A plan holds 1 to 12 steps of up to 500 characters each. If plan generation fails or times out, a sensible generic four-step plan is substituted.

**Execution.** The model works the plan in rounds: one `web_search` call carrying several distinct queries that run in parallel, then several `read_page` calls in the same step to read the most relevant results in full rather than relying on snippets. After each round it writes a short findings digest — key facts with their source URLs, what remains open, what it will search next. It finishes with a self-contained Markdown report: title, executive summary, findings organised by plan section with inline citations, gaps and open questions, and a sources list.

**Expanded budgets.** Research turns get a tool-step budget of four times the normal limit, capped at 120 steps, and a 30-minute deadline by default. As the context fills past 70% of the limit, tool results from earlier rounds are collapsed to a few hundred characters with a note pointing at the digest — which is why the per-round digests matter, they are the model's durable memory once the raw results are gone.

**Scheduled research.** An automation can be flagged as a research run, with its own run timeout (240 minutes by default, up to 720).

## Memory

**Memory tools with a rigor setting.** When memories are enabled the model gets `create_memory`, `update_memory`, and `delete_memory`. A rigor preference of `low`, `balanced` (default), or `high` changes the guidance in those tool descriptions, tuning how proactively the assistant reaches for them.

**Approval flow.** Memory writes are never silent. Every create, update, or delete surfaces in the transcript as a proposal card showing exactly what would change; nothing is written until you approve it, and you can dismiss it instead. A superseded proposal is marked as such.

**Prompt selection.** Memories are stored per user with a category (`personal`, `preference`, `work`, `location`, `other`) and a cap of 100 by default. All of them go into the prompt until you hold more than 35, at which point semantic recall starts choosing: the 10 most recently updated, plus up to 25 that are semantically relevant to the current message, plus **every pinned memory** regardless of relevance. Without semantic recall there is no trimming step.

**Semantic recall.** With semantic recall enabled, a local embedding model indexes memories, past messages including automation transcripts, compaction summaries, and extracted attachment text. This powers both the memory selection above and a `search_workspace` tool the model can call to look things up in your own history. Settings show the index status and offer an admin-only rebuild. Embeddings run on the server on CPU — nothing is sent to an embedding API. The model is configurable and the whole subsystem can be switched off; see [Configuration](./configuration.md#environment-variables).

## Automations

Scheduled prompts that run on their own and leave a normal transcript behind.

**Schedules.** Either `interval` (every N minutes, minimum 5) or `calendar` (daily, or weekly on chosen weekdays, at a local `HH:MM`). Calendar schedules use the server's `TZ`.

**Per-automation configuration.** Each automation carries its own provider profile, an optional persona, an optional bot to run inside, a deep-research flag with its own run timeout, and a *continue previous conversation* switch — with it on, each run appends to the previous run's conversation so daily briefs build on prior results; with it off, every run starts fresh.

**Prompt templating.** Three variables are substituted at run time:

| Variable | Value |
| --- | --- |
| `{{date}}` | The run's date |
| `{{run_number}}` | 1-based ordinal of this run |
| `{{last_result}}` | The previous run's result, empty on the first run |

**Running and reviewing.** **Run now** triggers an automation outside its schedule and a failed run can be retried. Every run is recorded with its scheduled time, trigger source (`schedule`, `manual_run`, `manual_retry`), status, and error, and links to the full transcript of what the assistant actually did — the same message and timeline view as a normal chat.

**Assistant-proposed automations.** The model can call `create_automation` when a request is obviously recurring. Like memory writes, this creates a proposal card you approve or dismiss; nothing gets scheduled without your sign-off.

## Tools available to the model

Which tools appear depends on your configuration. The full set:

| Tool | Available when | Purpose |
| --- | --- | --- |
| `mcp_<server>_<tool>` | An MCP server is enabled and connected | One entry per discovered tool. Vision-flagged servers only appear in `mcp` vision mode |
| `load_skill` | At least one skill is enabled and relevant | Loads a skill's full instructions into the turn |
| `execute_shell_command` | Always | Runs a shell command in the container (or the bot's workspace). Default timeout 30s, 120s for `agent-browser` commands, output capped at 8,000 characters |
| `read_page` | Always | Fetches a URL and returns its main content as Markdown, up to 32,000 characters. Static content only; parallel calls in one step are supported |
| `create_automation` | Always | Proposes a scheduled automation for your approval |
| `web_search` | Web search is configured | Searches with the selected provider. Accepts up to 5 parallel queries and up to 10 results each |
| `search_workspace` | Semantic recall is available | Read-only semantic search over your memories, past conversations, summaries, and attachment text |
| `generate_image` | Image generation is configured | Generates 1–4 images from a prompt, returned as attachments |
| `analyze_image` | Vision mode is `provider` and the vision profile is ready | Sends attached image paths to the nominated vision profile and returns a description |
| `message_bot` | The conversation belongs to a bot team | Sends work to another bot; returns immediately, reply arrives later |
| `create_bot` | Chief of Staff only | Creates a new specialist bot |
| `update_bot` | Chief of Staff only | Renames or revises a specialist bot |
| `create_memory` | Memories are enabled | Proposes a new memory |
| `update_memory` | Memories are enabled | Proposes a change to an existing memory |
| `delete_memory` | Memories are enabled | Proposes deleting a memory |

A per-user setting caps how many tool steps one turn may take (25 by default), which deep research multiplies as described above.

## Files and attachments

**Any file type**, up to **100 MB per file** and **100 files per upload**, with a 128 MB cap on the whole upload request. Attach them from the composer or drop them onto the chat.

**Text extraction.** Text and code files are read and their contents made available to the model — `.txt`, `.md`, `.json`, `.csv`, `.tsv`, `.yaml`/`.yml`, `.xml`, `.html`, `.css`, `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.rb`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, `.sh`, `.sql`, `.toml`, `.ini`, `.log` — and PDFs are parsed for their text. Images are handled according to the profile's vision mode. Anything else is stored, path-referenced in the prompt, and left for tools to inspect.

**Preview.** A modal previews attachments in place, including generated images.

**Assistant artifacts.** Files the assistant produces on disk — a screenshot, a generated chart, a downloaded document — are imported back into the transcript as attachments, so its output is browsable in the conversation instead of being stranded in a working directory.

## Voice input

Dictation from the composer, with a live audio level meter while recording. The transcription backend is an admin-managed choice between the browser's own speech recognition, an embedded offline model that runs on your server, or ElevenLabs, AssemblyAI, or Soniox — see [Providers](./providers.md#speech-to-text).

An optional cleanup pass sends the raw transcript through a provider profile to remove filler words, fix punctuation and capitalisation, convert spoken numbers, execute dictation commands, and apply spoken self-corrections, all in the language you spoke. The cleanup prompt is editable.

## Rendering

Assistant messages render as GitHub-flavored Markdown with:

- syntax-highlighted code blocks
- Mermaid diagrams
- LaTeX math via KaTeX
- CJK-aware text handling

Streaming-safe rendering means partially-received Markdown does not flicker or break mid-token. External links can be gated behind a confirmation modal, which is on by default.

## Multi-user

Password login is optional. With `EIDON_PASSWORD_LOGIN_ENABLED=false` the app runs without a sign-in step, which suits a single-user deployment behind your own authentication. With it enabled:

- The credentials in `EIDON_ADMIN_USERNAME` / `EIDON_ADMIN_PASSWORD` are an **environment super-admin** that always exists.
- Additional **local accounts** are created in-app and stored in the database with Argon2id password hashes.
- Every account has a role of `admin` or `user`.

**Data isolation.** Conversations, folders, memories, personas, automations, and bots are all scoped to their owner. One user cannot read another's.

**Admin-only settings.** Provider profiles, MCP servers, skills, user management, web search, image generation, speech transcription, title generation, speech cleanup, the shared bot prompt, the default provider profile, and the semantic recall toggle and index rebuild.

**Per-user settings.** Conversation retention, memory enablement, memory cap, memory rigor, MCP timeout, max tool steps per turn, external link confirmation, tool call display mode, and default landing view (`chat`, `agents`, or `automations`). Personas and memories are each user's own.

## Mobile and PWA

Eidon is an installable Progressive Web App: it ships a web app manifest and a service worker, so any mobile browser offers its own **Add to Home Screen** / install action. Installation is entirely browser-native — Eidon does not intercept `beforeinstallprompt` or show a custom install banner.

- Installed instances launch in `standalone` display mode, and iOS standalone mode is detected so its layout quirks can be handled.
- Layouts are mobile-specific rather than a scaled desktop: the composer collapses its model, persona, and reasoning-effort controls into bottom sheets, and settings use a master/detail navigation where a section pushes into its own view.
- The conversation scrollbar is a custom control that supports touch scrubbing, with a wider hit area on coarse pointers.

## Interface

A dark-only design system, documented in [`DESIGN.md`](../DESIGN.md) and machine-readable in [`DESIGN.json`](../DESIGN.json).

Keyboard support is deliberately modest and worth stating plainly: **Enter** sends a message (**Shift+Enter** inserts a newline, and on mobile Enter is a newline), **Escape** closes modals, sheets, and inline edit fields, and Enter confirms inline inputs like folder naming and conversation search. There is **no global keyboard shortcut palette** and no command menu.

## See also

- [Configuration](./configuration.md) — environment variables, storage, and security
- [Providers](./providers.md) — provider presets and per-profile options
- [MCP and skills](./mcp-and-skills.md) — extending the tool layer
- [Development](./development.md) — local setup, scripts, and architecture
- [README](../README.md)
