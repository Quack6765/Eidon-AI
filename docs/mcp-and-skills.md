# MCP and skills

How to extend what the assistant can do: connect Model Context Protocol servers (including OAuth-protected remote ones), and write reusable skills the model can load on demand.

MCP servers and skills both live under **Settings** and are admin-managed.

## MCP servers

**Settings → MCP** holds the server list. Each server is stored with its slug, transport, credentials, and enable flag.

### Transports

| Transport | Fields | Use for |
| --- | --- | --- |
| `streamable_http` | URL, custom headers | Remote and hosted MCP servers |
| `stdio` | Command, argument array, environment variables | Servers you run as a local child process |

The production image already contains `uv`/`uvx`, `npx` (via Node), Python 3, and Chromium, so the common `stdio` invocations — `uvx some-mcp-server` for Python servers and `npx -y some-mcp-server` for Node ones — work with no extra setup inside the container.

### Per-server configuration

- **Headers** (HTTP transport) — sent on every request. Values are encrypted at rest.
- **Command, args, env** (stdio transport) — the process to spawn. Environment values are encrypted at rest.
- **Enabled** — a disabled server keeps its configuration but contributes no tools.
- **Vision backend** — see [Vision MCP](#vision-mcp) below.
- **Test** — connects, negotiates the protocol, and lists the server's tools. This is also how Eidon detects that a remote server requires OAuth.

Discovered tools are shown in settings with their titles, descriptions, and read-only hints. Once a server is connected and enabled, its tools are exposed to the model as:

```
mcp_<server-slug>_<tool-name>
```

The slug is derived from the server name, so `Composio Connect` becomes `composio_connect` and a `GMAIL_SEND_EMAIL` tool becomes `mcp_composio_connect_GMAIL_SEND_EMAIL`. Tool calls appear in the message timeline with their arguments and results.

A per-user MCP timeout setting bounds how long a single tool call may run.

### Message drafts

When the model writes something that a connected tool would send on your behalf — an email through Gmail, a Slack message, a reply, a post — it calls `draft_message` instead of the sending tool. The draft appears as a card in the conversation with its recipients, subject, and body. Nothing is sent until you press **Send**; you can edit any text field first, or **Discard** the draft.

- Drafts wait as long as you need. They survive restarts, and bots and routines can leave drafts for you to review later; a bot with a waiting draft shows **Waiting for input**.
- **Send** calls the named tool once with the draft's arguments and your edits. If the connector fails, the error appears on the card and the draft stays editable so you can fix it and send again.
- To revise a draft, ask in the chat. The model writes a new draft and withdraws the old one.
- The model sees what happened to each draft on your next message — what was sent (including your edits), what was discarded, and what is still waiting.
- Sending from a draft is its own approval, so it does not need a tool-approval rule. The model can still call a sending tool directly when you explicitly ask it to skip the draft, and that call goes through the normal tool approval.

## MCP OAuth

Remote MCP servers that follow the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) — OAuth 2.1 with PKCE — can be connected with a browser sign-in instead of a static API key. This works with hosted MCP gateways such as [Composio Connect](https://docs.composio.dev/docs/composio-connect).

1. Open **Settings → MCP** and add a server with the Streamable HTTP transport, for example `https://connect.composio.dev/mcp`.
2. Click **Test**. Eidon detects that the server requires authentication and shows an **Authenticate** button.
3. Click **Authenticate** and approve the provider's consent page.
4. You are redirected back to the MCP servers settings with the server connected and its tools available.

Details worth knowing:

- **Dynamic client registration.** The first sign-in registers Eidon with the provider automatically. No client id or secret needs to be configured. The registration includes Eidon's name, avatar, and public URL, so the provider's consent page can show the app's branding.
- **Encrypted token storage.** Access and refresh tokens, along with the PKCE verifier and discovery state, are encrypted with `EIDON_ENCRYPTION_SECRET` and stored in the SQLite database under the data directory, so they survive container restarts and recreation.
- **Automatic refresh.** Expired access tokens are refreshed transparently on the next call.
- **Expired state.** A server whose refresh token has been revoked shows an **Authentication expired** state with a one-click reconnect. A server that has never been authorized shows an authentication-required state instead.

Keep `EIDON_ENCRYPTION_SECRET` stable across deployments. Changing it makes previously stored OAuth tokens undecryptable and every OAuth server has to be reconnected. See [Configuration](./configuration.md#keep-eidon_encryption_secret-stable).

## Vision MCP

A server can be marked as the vision backend. This pairs with the `mcp` vision mode on a provider profile:

- Servers flagged as vision servers are **hidden from the model** unless the active provider profile has `visionMode: "mcp"`.
- With `visionMode: "mcp"`, those servers' tools become available and the model uses them to look at images.

This keeps a dedicated image-analysis server out of the tool list for profiles that see images natively. If you would rather route image analysis to another *provider profile* than to an MCP server, use `visionMode: "provider"` instead, which exposes an `analyze_image` tool. Both modes are described in [Providers](./providers.md#vision).

## Skills

A skill is a Markdown document you write once and the model loads on demand. Skills live in a **shared library, one per team**, under `bot-workspaces/<user>/shared/skills/` in the data directory — shared with every agent on this team, so a skill one bot learns is available to the rest. There is no per-bot collection and no per-agent ownership. Skills managed under **Settings → Skills** are deployment-wide: they appear in every chat, including your own, and are read-only to agents.

A skill lives in a folder — `[category/]<name>/SKILL.md` plus optional support folders `references/`, `templates/`, `scripts/`, and `assets/` for material the skill points at. A skill is identified by its name, or `category/name`; the folder name is its identity, so editing a skill's text never renames it.

When at least one skill is available, the model gets a `load_skill` tool whose description lists the available skill names. Calling it injects the skill's full text into the turn, and the loaded skill shows up in the message timeline.

### Front matter

A skill may begin with a YAML front-matter block. These keys are recognized:

| Key | Effect |
| --- | --- |
| `name` | Overrides the skill's display name. This is the name the model sees and passes to `load_skill`. In the shared library it should match the folder name |
| `description` | Overrides the description. This is the model's only cue for when to load the skill, so write it as trigger conditions |
| `shell_command_prefixes` | Marks the skill as shell-based and gates when it is offered. Accepts an inline array or a YAML list. `allowed_command_prefixes` and `command_prefixes` are accepted as aliases |
| `platforms`, `tags`, `related_skills`, `author`, `version` | Extra details recorded with the skill: where it applies, how it is tagged, which skills it relates to, who wrote it, and its version. They do not change when the skill is offered |

If `description` is absent, Eidon derives one from the first non-heading line of the document.

### `shell_command_prefixes` is not a sandbox

This field controls **skill visibility**, not command execution. Getting this wrong is a security mistake, so be precise about what it does:

- A skill that declares `shell_command_prefixes` is **withheld from the model's skill list** unless the latest user message names the skill, contains something URL-like, or matches Eidon's browser/shell intent patterns (words like *browser*, *website*, *click*, *navigate*, *screenshot*, *form*, *login*, *dom*). On those triggers only skills that look like browser skills — their name or description mentions *browser* — are offered. A skill with no prefixes is always offered.
- It does **not** restrict what `execute_shell_command` or `run_python` may run. Both tools are always available to the model and run as the container user, with the container's full filesystem access. There is no per-command allowlist anywhere in the execution path.

Treat the prefixes as documentation plus a relevance filter. If you need to constrain what the assistant can do to a machine, constrain the container — not the skill front matter. See [Security and storage notes](./configuration.md#security-and-storage-notes).

### Example skill

```markdown
---
name: Postgres Reports
description: Use when the user asks for a query, report, or row count against the analytics Postgres database.
shell_command_prefixes:
  - psql
---

# Postgres Reports

Read-only access to the analytics database.

## Connecting

- Connection string is in `$ANALYTICS_DATABASE_URL`.
- Always run queries through `psql "$ANALYTICS_DATABASE_URL" -c "<sql>"`.
- Add `--csv` when the user wants tabular output they can paste elsewhere.

## Rules

- Never run `INSERT`, `UPDATE`, `DELETE`, or DDL. This database is read-only.
- Always add a `LIMIT` unless the user explicitly asks for the full result set.
- Report the row count alongside the results.

## Common tables

- `events` — one row per tracked event, partitioned by day on `occurred_at`.
- `accounts` — one row per customer account; join on `events.account_id`.
```

### The skill tools

`load_skill` loads a skill's full text into the turn. `skill_manage` creates and changes skills in the shared library; bot teammates get it whenever skills are enabled. It takes a list of `operations`, applied in order:

| Operation | What it does |
| --- | --- |
| `create` | Adds a new skill. `content` is the full `SKILL.md` text (front matter plus body); `category` is optional |
| `patch` | Edits text: `old_string`/`new_string` (with `replace_all`, and `file_path` to edit a support file instead), or `content` to rewrite the whole `SKILL.md` |
| `write_file` | Adds or replaces a support file under `references/`, `templates/`, `scripts/`, or `assets/` |
| `remove_file` | Deletes a support file |
| `delete` | Removes a skill. `absorbed_into` names the umbrella skill that absorbed this one — required whenever the delete was not asked for directly |

Up to 20 operations go in one call, and `delete` must be the sole operation. A batch is atomic: if one operation fails, none of them are applied.

### When to write a skill

A skill captures a **class of work**, not one job, and extending an existing skill always beats creating a new one. The model is instructed to work down this list, stopping at the first step that fits:

1. Patch the skill it has loaded for the task.
2. Patch the existing umbrella skill that covers the class of task.
3. Add a support file — under `references/`, `templates/`, or `scripts/` — to that umbrella.
4. Create a new skill only when no existing skill covers the class of task.

The rule the model is given, in its own words: *"Never create a skill for a one-off task, a single-step task, or an incident that only made sense today. Names must be class-level and lowercase."* A name that only makes sense for today's task is wrong.

### Learning in the background

After a task, an agent reviews what it did and saves or improves a skill when the workflow will come up again. One-off work is never saved. After each completed bot turn an optional background pass reviews the conversation and may create or update skills on its own — that is how a recurring workflow gets captured without anyone asking for it. It writes curator-managed skills into the shared library and shows up in the message timeline as a **Skill review** action.

The **Learn from each task** switch under **Settings → Skills → Skill maintenance** turns this pass off. It is on by default.

The pass is deliberately narrow: it runs with only the two skill tools and cannot change your agent's instructions or its memory. When a lesson belongs somewhere else it says so in its summary rather than writing a skill.

### Where a lesson belongs

Three places can hold something an agent learned, and a lesson goes in exactly one:

| | Holds | Changed with |
| --- | --- | --- |
| **Instructions** | How the agent behaves — tone, verbosity, language, output format, standing rules such as "always answer in French" | `update_own_instructions`, or `update_bot` from the chief of staff |
| **Memory** | Who you are — identity, environment, long-running projects, stable facts and tastes | `create_memory`, which you approve first |
| **Skills** | How to do a class of task — the workflow, the steps, the pitfalls, which tool to reach for | `skill_manage` |

A preference that could read either way is treated as a fact about you, unless you frame it as a standing rule. A user-preference lesson lives in exactly one place: the skill that governs the task when one exists, or instructions or memory for a cross-cutting preference no skill owns — never two, or a memory ends up restating a skill until both fill up.

### Who may edit what

Every skill records who created it:

| `created_by` | Meaning |
| --- | --- |
| `agent` | Curator-managed: written by the assistant or by a background pass |
| `learn` | Saved at your request |
| `installed` | Shipped with Eidon, such as the bundled `skill-authoring` skill |

Background passes may only touch curator-managed skills. A user-authored skill is safe from autonomous changes until you hand it over with **adopt** in the bot's skill list. A **pinned** skill cannot be deleted (edits are still allowed), and an **essential** skill such as the bundled `agent-browser` can never be deleted at all (edits are still allowed there too). Skills managed under **Settings → Skills** are a separate, deployment-wide collection and are read-only to every agent. There is no per-agent ownership: every agent on the team works in the same shared library.

### Keeping the library tidy

A maintenance pass keeps the shared library from growing without bound:

- A skill unused for **14 days** is marked stale.
- At **30 days** it is moved to `.archive/` and leaves the skill list. The curator **never hard-deletes a skill** — archiving is reversible, and **Restore** brings an archived skill back. A skill is removed for good only when you delete it yourself or when the archive TTL removes old archives.
- Pinned, essential, and user-authored skills are exempt.
- An optional consolidation pass (**Merge near-duplicate skills**, off by default) folds narrow sibling skills into one umbrella skill.

By default maintenance runs once a week, only after 2 hours of idle time, and the first run waits one full interval. Everything is editable under **Settings → Skills → Skill maintenance**:

| Setting | Default |
| --- | --- |
| Skill maintenance | On |
| Run maintenance every | 168 hours (one week) |
| Only when idle for | 2 hours |
| Mark unused skills stale after | 14 days |
| Archive unused skills after | 30 days |
| Delete archived skills after | 0 — archives are kept forever |
| Merge near-duplicate skills | Off |
| Learn from each task | On |
| Keep this many maintenance backups | 5 |

### Limits

| Limit | Value |
| --- | --- |
| Skill name | 64 characters |
| Description | 1,024 characters |
| Description shown in the skill list | 60 characters — longer ones raise a warning, since every skill's description is always in front of the model |
| `SKILL.md` text | 100,000 characters |
| Each supporting file | 1 MiB |

There is deliberately **no limit on how many skills you can have**. Marking unused skills stale and folding near-duplicates together is what keeps the list short; a cap would only make the agent stop saving useful things.

A description over **60 characters** raises a warning when a skill is created: descriptions must fit the system-prompt budget, so the model is nudged to keep them short. The warning does not block saving.

Everything else the linter checks — missing sections, a long body, dangling file references, soft size caps — is advisory and never blocks. Saving is refused only for a name that is too long or invalid, an empty description or one over 1,024 characters, content over 100,000 characters, or a supporting file over 1 MiB.

There is deliberately **no cap on the number of skills**. Staleness and consolidation are what keep the library small.

## Built-in: the Agent Browser skill

Eidon ships one skill out of the box. It is an **essential** skill: it can be edited but never deleted. The production image installs the `agent-browser` CLI globally and Chromium alongside it, and wraps the CLI so it always uses the bundled Chromium binary.

The skill documents the CLI's commands and tells the model how to use them:

| Command | Purpose |
| --- | --- |
| `agent-browser open <url>` | Navigate to a URL |
| `agent-browser snapshot` | Accessibility tree with `@e1`-style element refs |
| `agent-browser click <sel>` | Click an element, usually by ref |
| `agent-browser fill <sel> <text>` | Clear and fill an input |
| `agent-browser type <sel> <text>` | Type into an element |
| `agent-browser press <key>` | Press a key such as `Enter`, `Tab`, `Control+a` |
| `agent-browser select <sel> <val>` | Choose a dropdown option |
| `agent-browser hover <sel>` | Hover an element |
| `agent-browser scroll <dir> [px]` | Scroll the page |
| `agent-browser get text <sel>` | Read an element's text |
| `agent-browser eval <js>` | Run JavaScript in the page |
| `agent-browser screenshot [path]` | Capture a screenshot, `--full` for full page |
| `agent-browser close` | Close the browser |

This is what makes the assistant able to read JavaScript-heavy pages, log into sites, fill forms, and take screenshots, where the lighter-weight `read_page` tool can only fetch static content.

Each bot teammate gets its own browser session — its own socket directory, cookies, and logins — so one bot signing into a site does not affect any other. See [Features](./features.md#bot-teammates).

## See also

- [Providers](./providers.md) — provider profiles and the vision modes MCP plugs into
- [Features](./features.md) — the full capability reference, including every tool the model gets
- [Configuration](./configuration.md) — secrets, encryption, and storage
- [Development](./development.md) — local setup and architecture
- [README](../README.md)
