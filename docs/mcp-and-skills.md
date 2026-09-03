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

A skill is a Markdown document you write once and the model loads on demand. Skills are stored in the app — there is no filesystem to manage — and are available across every chat.

When at least one skill is enabled, the model gets a `load_skill` tool whose description lists the available skill names. Calling it injects the skill's full text into the turn, and the loaded skill shows up in the message timeline.

### Front matter

A skill may begin with a YAML front-matter block. Three keys are recognized:

| Key | Effect |
| --- | --- |
| `name` | Overrides the skill's display name. This is the name the model sees and passes to `load_skill` |
| `description` | Overrides the description. This is the model's only cue for when to load the skill, so write it as trigger conditions |
| `shell_command_prefixes` | Marks the skill as shell-based and gates when it is offered. Accepts an inline array or a YAML list. `allowed_command_prefixes` and `command_prefixes` are accepted as aliases |

If `description` is absent, Eidon derives one from the first non-heading line of the document.

### `shell_command_prefixes` is not a sandbox

This field controls **skill visibility**, not command execution. Getting this wrong is a security mistake, so be precise about what it does:

- A skill that declares `shell_command_prefixes` is **withheld from the model's skill list** unless the latest user message names the skill, contains something URL-like, or matches Eidon's browser/shell intent patterns (words like *browser*, *website*, *click*, *navigate*, *screenshot*, *form*, *login*, *dom*). A skill with no prefixes is always offered.
- It does **not** restrict what `execute_shell_command` may run. That tool is always available to the model and passes the command to a shell as the container user, with the container's full filesystem access. There is no per-command allowlist anywhere in the execution path.

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

## Built-in: the Agent Browser skill

Eidon ships one skill out of the box. The production image installs the `agent-browser` CLI globally and Chromium alongside it, and wraps the CLI so it always uses the bundled Chromium binary.

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
