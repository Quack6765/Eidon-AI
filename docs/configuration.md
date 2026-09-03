# Configuration

Every environment variable Eidon reads, how secrets are generated and stored, what lives in the data directory, and how to back it up.

## Environment variables

Eidon parses and validates its environment at startup (`lib/env.ts`). Anything not listed here is not read by the app.

| Variable | Purpose | Default | Required in production |
| --- | --- | --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`. Production mode enforces the secret checks below. | `development` | Set to `production` (the Docker image already does) |
| `PORT` | Port the server listens on. | `3000` in production; a random free port in 3000–4000 in development | No |
| `TZ` | IANA timezone used for calendar automation schedules and date formatting. Must be a zone name such as `Europe/Paris`; fixed offsets like `+02:00` are rejected. | The host's system timezone, falling back to `UTC` | No |
| `EIDON_PASSWORD_LOGIN_ENABLED` | `true` or `false`. Enables password login and the multi-user account system. | `false` (the Docker image sets `true`) | No, but `true` is the normal production mode |
| `EIDON_ADMIN_USERNAME` | Username of the environment super-admin. | `admin` | No |
| `EIDON_ADMIN_PASSWORD` | Password of the environment super-admin. Minimum 8 characters. | Development-only placeholder | Yes |
| `EIDON_SESSION_SECRET` | HMAC key for signing session JWTs. Minimum 32 characters. | Development-only placeholder | Yes |
| `EIDON_ENCRYPTION_SECRET` | Key material for encrypting stored provider credentials, MCP headers and env values, and MCP OAuth tokens. Minimum 32 characters. | Development-only placeholder | Yes |
| `EIDON_DATA_DIR` | Directory holding the SQLite database and all runtime data. | `./.data` (the Docker image sets `/app/data`) | No |
| `EIDON_GITHUB_APP_CLIENT_ID` | GitHub App client ID for the GitHub Copilot provider. | unset | No |
| `EIDON_GITHUB_APP_CLIENT_SECRET` | GitHub App client secret for the GitHub Copilot provider. | unset | No |
| `EIDON_GITHUB_APP_CALLBACK_URL` | OAuth callback URL for the GitHub Copilot flow. Must be an absolute URL. | unset | No |
| `EIDON_EMBEDDING_MODEL` | Hugging Face model id used for local embeddings powering semantic recall. | `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | No |
| `EIDON_EMBEDDING_DISABLED` | Set to `1` to skip loading the embedding model entirely. Semantic recall and the `search_workspace` tool become unavailable. | unset | No |

All three GitHub App variables must be set together. If any is missing, the GitHub Copilot provider type still appears in settings but **Connect GitHub** will not complete.

The production image also sets `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR`, and `AGENT_BROWSER_SOCKET_DIR` to paths inside `/app/data` so the non-root user has writable locations, and `NEXT_TELEMETRY_DISABLED=1`. You do not normally need to override these.

`NEXT_PUBLIC_APP_VERSION` is a build argument, not a runtime variable. It is what the in-app version string displays. See [Development](./development.md) for the image channels that set it.

## Generating secrets

```bash
export EIDON_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export EIDON_SESSION_SECRET="$(openssl rand -hex 32)"
export EIDON_ENCRYPTION_SECRET="$(openssl rand -hex 32)"
```

In production, Eidon refuses to start if any of these three are missing, and also refuses to start if they still hold a known development placeholder value. Use fresh random values.

### Keep `EIDON_ENCRYPTION_SECRET` stable

`EIDON_ENCRYPTION_SECRET` is hashed into an AES-256-GCM key that encrypts every secret Eidon stores: provider API keys, GitHub Copilot access and refresh tokens, MCP server headers and environment values, and MCP OAuth access and refresh tokens.

If you change it, those records can no longer be decrypted. You will have to re-enter every provider API key, reconnect GitHub Copilot, and re-authenticate every OAuth MCP server. Store it somewhere durable before your first deployment and carry the same value across container recreations, host migrations, and compose-file rewrites.

Changing `EIDON_SESSION_SECRET` is less destructive — it only invalidates existing browser and mobile sessions, forcing everyone to sign in again.

## Data storage

Everything Eidon persists lives under `EIDON_DATA_DIR` (`/app/data` in the image), which the Dockerfile declares as a volume.

| Path | Contents |
| --- | --- |
| `eidon.db` | The SQLite database: users, conversations, messages, action timelines, attachments metadata, folders, memories, memory and automation proposals, automations and run history, bots and bot runs, provider profiles and encrypted credentials, MCP servers and OAuth state, skills, personas, compaction summaries, and the semantic index |
| `attachments/` | Uploaded files and assistant-generated images, stored on disk with database rows pointing at them |
| `bot-workspaces/<user>/<bot>/` | One isolated file workspace per bot; this is the working directory for that bot's shell commands |
| `model-cache/` | Downloaded local models: the embedding model, the local title-generation model, and the Canary speech-to-text model |
| `home/`, `tmp/`, `runtime/` | `HOME`, `TMPDIR`, and `XDG_RUNTIME_DIR` for the container user |
| `runtime/agent-browser/` | `agent-browser` control sockets, with `runtime/agent-browser/bots/<bot>/` giving each bot its own browser session |

There is no external datastore, cache, or queue. One volume holds the whole workspace.

## Security and storage notes

**Container user.** The image creates a system `eidon` user and group and runs as that user. The data directories are created with mode `700` and owned by `eidon`.

**Credentials at rest.** Secrets are encrypted with AES-256-GCM before being written to SQLite, using a SHA-256 digest of `EIDON_ENCRYPTION_SECRET` as the key and a fresh random IV per value. The database itself is not encrypted, so treat the volume as sensitive: conversation content, memories, and attachments are stored in the clear.

**Authentication.** Local account passwords are hashed with Argon2id. Sessions are JWTs signed with `EIDON_SESSION_SECRET` (HS256) and delivered in an `httpOnly`, `SameSite=Lax` cookie, marked `Secure` when the request arrives over HTTPS. Mobile and native clients get separate tokens with their own JWT audience; see [Development](./development.md#versioned-mobile-api).

**What leaves the box.** Eidon ships with no provider API key and makes no calls to an Eidon-operated service. Outbound network traffic only goes to endpoints you configure or actions you take:

- the model providers in your provider profiles
- MCP servers you add, including the OAuth authorization servers they advertise
- the web search provider you select, and pages the model fetches with `read_page` or browses with `agent-browser`
- the image generation and external speech-to-text providers you select
- `huggingface.co`, on first use, to download the local embedding, title, and Canary speech models into `model-cache/`

MCP OAuth dynamic client registration sends Eidon's application name, avatar URL, and public URL to the MCP provider so its consent screen can show them.

**Share links.** A conversation can be given a public share token. The share route serves a read-only transcript view and read-only access to that conversation's attachments — no authentication required, since the token is the credential. Anyone holding the URL can read it, so treat share links as public. Sharing is per-conversation and can be turned off again, which invalidates the link.

**Shell execution.** The `execute_shell_command` tool runs commands as the container user with the container's full filesystem access. Skill front-matter does not sandbox it — see [MCP and skills](./mcp-and-skills.md#shell_command_prefixes-is-not-a-sandbox) for exactly what that field does and does not do.

## Backup and restore

Eidon is one SQLite database plus a directory of files, so a backup is a copy of the volume.

To back up:

```bash
docker stop eidon
docker run --rm \
  -v eidon-data:/data:ro \
  -v "$PWD":/backup \
  busybox tar czf /backup/eidon-backup.tar.gz -C /data .
docker start eidon
```

Stopping the container first is what makes this safe: it guarantees no write is in flight and the SQLite database has no live journal. Copying a hot volume can capture a torn database file.

To restore, stop the container, replace the volume contents from the archive, and start it again with the **same** `EIDON_ENCRYPTION_SECRET` as when the backup was taken. Without that value the restored provider credentials and OAuth tokens are unreadable.

The semantic index and `model-cache/` are both derived data. If you want a smaller archive you can exclude `model-cache/` — it will be re-downloaded on demand — and rebuild the semantic index afterwards from **Settings → General**.

## See also

- [Providers](./providers.md) — provider presets, profile options, and non-chat providers
- [MCP and skills](./mcp-and-skills.md) — MCP transports, OAuth, and skill authoring
- [Features](./features.md) — the full capability reference
- [Development](./development.md) — local setup, scripts, and image channels
- [README](../README.md)
