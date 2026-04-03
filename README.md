<div align="center">

# Hermes

<p>
  <strong>A self-hosted conversational workspace with streaming, visible reasoning, reusable skills, MCP integrations, and long-memory compaction.</strong>
</p>

<p>
  <a href="#what-is-hermes">What is Hermes?</a>
  ·
  <a href="#feature-snapshot">Feature Snapshot</a>
  ·
  <a href="#local-development">Local Development</a>
  ·
  <a href="#production-with-docker">Production with Docker</a>
  ·
  <a href="#configuration">Configuration</a>
  ·
  <a href="#security-notes">Security Notes</a>
</p>

<p>
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/SQLite-local-003b57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white" alt="Docker ready" />
  <img src="https://img.shields.io/badge/Auth-single--user-4f46e5" alt="Single-user auth" />
</p>

</div>

Hermes is a private, self-hosted chat application for people who want a clean ChatGPT-style interface on infrastructure they control. It is designed as a single-user workspace: you bring your own provider API key, configure tools and skills, and keep conversations, settings, and credentials on your own machine or server.

It combines a polished conversational UI with production-minded primitives: streaming responses, provider profiles, local auth, MCP servers, reusable skills, configurable retention, and context compaction that keeps long threads usable without throwing away important state.

## What is Hermes?

Hermes gives you a local-first assistant workspace with:

- Streaming chat with support for visible reasoning and tool call timelines
- OpenAI-compatible provider profiles, including custom API base URLs
- Long-memory compaction to preserve context in lengthy conversations
- MCP server support for external tools and services
- Reusable skills, including a built-in browser automation skill in the Docker image
- Single-user local authentication with a settings UI for account management
- SQLite-backed persistence for chats, settings, sessions, skills, and memory nodes

Hermes is not a multi-tenant SaaS control plane. It is closer to a private operator console for your own assistant workflow.

## Feature Snapshot

| Capability | What it means in practice |
| --- | --- |
| Streaming responses | Assistant output streams into the UI as it is generated |
| Long-memory compaction | Older messages are compacted into structured memory nodes so long threads remain useful |
| Provider profiles | Save multiple model/API configurations and switch conversation behavior cleanly |
| MCP servers | Connect tools over streamable HTTP or `stdio` transports |
| Skills | Save reusable `SKILL.md` instructions and enable them globally |
| Local auth | Password login with server-backed sessions and an in-app account screen |
| Local persistence | Data lives in SQLite plus a writable data directory you can back up or mount |

## Architecture

```mermaid
flowchart LR
  Browser["Browser UI"] --> Hermes["Hermes (Next.js + route handlers)"]
  Hermes --> SQLite["SQLite database"]
  Hermes --> Data["/app/data attachments + runtime data"]
  Hermes --> Provider["OpenAI-compatible provider APIs"]
  Hermes --> MCP["MCP servers"]
  Hermes --> Skills["Local skills + browser automation"]
```

## Local Development

### Prerequisites

- Node.js 22+
- npm
- A local toolchain capable of building `better-sqlite3`

### 1. Install dependencies

```bash
npm install
```

### 2. Create a local env file

Create `.env.local` in the repo root:

```bash
HERMES_PASSWORD_LOGIN_ENABLED=false
HERMES_ADMIN_USERNAME=admin
HERMES_ADMIN_PASSWORD=dev-password-change-me
HERMES_SESSION_SECRET=dev-session-secret-change-me-with-32-plus-chars
HERMES_ENCRYPTION_SECRET=dev-encryption-secret-change-me-with-32-plus-chars
```

Notes:

- `HERMES_PASSWORD_LOGIN_ENABLED=false` is the simplest development mode. Hermes boots the admin user directly and bypasses the login screen.
- If you want to test the password login flow locally, set `HERMES_PASSWORD_LOGIN_ENABLED=true`.
- In non-production environments, Hermes can fall back to development defaults for the admin password and secrets, but explicitly setting them is cleaner and closer to real deployments.

### 3. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Configure your model provider

After the app is running:

1. Open **Settings**
2. Go to **Providers**
3. Add your API key and model configuration
4. Start a new chat

Hermes does not ship with a provider API key.

### Useful development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run unit tests with coverage |
| `npm run test:e2e` | Run Playwright smoke and feature tests |

## Production With Docker

The repository includes a production Dockerfile. The image runs Hermes as a non-root user, stores runtime data under `/app/data`, and enables password login by default.

### Production requirements

You must provide all of the following at runtime:

- `HERMES_ADMIN_USERNAME`
- `HERMES_ADMIN_PASSWORD`
- `HERMES_SESSION_SECRET`
- `HERMES_ENCRYPTION_SECRET`

Production startup fails fast if:

- `HERMES_ADMIN_PASSWORD` is missing
- `HERMES_SESSION_SECRET` is missing
- `HERMES_ENCRYPTION_SECRET` is missing
- Any of those values are still set to a published placeholder/default value

Generate the two secrets on macOS or Linux with:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Or export them directly in your shell:

```bash
export HERMES_SESSION_SECRET="$(openssl rand -hex 32)"
export HERMES_ENCRYPTION_SECRET="$(openssl rand -hex 32)"
```

### Build the image

```bash
docker build -t hermes:latest .
```

### Run with `docker run`

```bash
docker run -d \
  --name hermes \
  --restart unless-stopped \
  -p 3000:3000 \
  -v hermes-data:/app/data \
  -e HERMES_PASSWORD_LOGIN_ENABLED=true \
  -e HERMES_ADMIN_USERNAME=admin \
  -e HERMES_ADMIN_PASSWORD='replace-this-with-a-long-random-password' \
  -e HERMES_SESSION_SECRET='replace-this-with-a-long-random-session-secret' \
  -e HERMES_ENCRYPTION_SECRET='replace-this-with-a-long-random-encryption-secret' \
  hermes:latest
```

Then put Hermes behind HTTPS with your reverse proxy of choice.

### Run with Docker Compose

```yaml
services:
  hermes:
    build: .
    image: hermes:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      HERMES_PASSWORD_LOGIN_ENABLED: "true"
      HERMES_ADMIN_USERNAME: "admin"
      HERMES_ADMIN_PASSWORD: "replace-this-with-a-long-random-password"
      HERMES_SESSION_SECRET: "replace-this-with-a-long-random-session-secret"
      HERMES_ENCRYPTION_SECRET: "replace-this-with-a-long-random-encryption-secret"
    volumes:
      - hermes-data:/app/data

volumes:
  hermes-data:
```

Start it with:

```bash
docker compose up -d --build
```

### First production login

1. Visit your Hermes URL
2. Sign in with `HERMES_ADMIN_USERNAME` and `HERMES_ADMIN_PASSWORD`
3. Open **Settings → Account**
4. Rotate the username/password if needed
5. Open **Settings → Providers** and set your provider API key

## Configuration

| Variable | Purpose | Required in production |
| --- | --- | --- |
| `HERMES_PASSWORD_LOGIN_ENABLED` | Enables password-based login | No, but `true` is the normal production mode |
| `HERMES_ADMIN_USERNAME` | Initial admin username | Yes |
| `HERMES_ADMIN_PASSWORD` | Initial admin password | Yes |
| `HERMES_SESSION_SECRET` | Session signing secret | Yes |
| `HERMES_ENCRYPTION_SECRET` | Encryption seed for stored provider credentials | Yes |
| `HERMES_DATA_DIR` | Directory for SQLite and runtime data | No |

Runtime defaults:

- Default model: `gpt-5-mini`
- Default API mode: `responses`
- Default storage path in the Docker image: `/app/data`

## Security Notes

Hermes is single-user, but that user is highly privileged inside the app.

- Always terminate TLS before exposing Hermes to the internet
- Rate-limit `POST /api/auth/login` at the reverse proxy
- Use long, random values for the admin password and both secrets
- Persist `/app/data` on a named volume or host mount
- Treat configured MCP servers and shell-capable skills as trusted/admin-level features
- Rotate provider API keys and bootstrap secrets during redeploys when needed

If you are deploying Hermes on a public VPS, the minimum baseline should be:

- HTTPS
- Strong secrets
- A persistent data volume
- Login rate limiting
- A reverse proxy such as Caddy, Nginx, or Traefik

## Project Stack

- Next.js App Router
- React 19
- TypeScript
- SQLite via `better-sqlite3`
- `argon2` for password hashing
- `jose` for signed session cookies
- `zod` for validation

## Inspiration

This README structure was influenced by the centered hero, quick-link rail, and self-hosting sections used in a few polished open-source READMEs:

- [Trigger.dev](https://github.com/triggerdotdev/trigger.dev)
- [Langfuse](https://github.com/langfuse/langfuse)
- [Supabase](https://github.com/supabase/supabase)
