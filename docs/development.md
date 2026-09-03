# Development

Running Eidon from source: prerequisites, every npm script, testing, the README screenshot pipeline, Docker image channels, and a short tour of the architecture.

## Prerequisites

- Node.js 22+
- npm
- A local toolchain able to build `better-sqlite3` (a C/C++ compiler and Python; on macOS, Xcode Command Line Tools)

## Setup

```bash
npm install
```

Create a local `.env`:

```bash
EIDON_PASSWORD_LOGIN_ENABLED=false
EIDON_ADMIN_USERNAME=admin
EIDON_ADMIN_PASSWORD=dev-password-change-me
EIDON_SESSION_SECRET=dev-session-secret-change-me-with-32-plus-chars
EIDON_ENCRYPTION_SECRET=dev-encryption-secret-change-me-with-32-plus-chars
```

Outside production these three secrets fall back to development placeholders if unset, so the file is a convenience rather than a requirement. Production startup rejects both missing values and those placeholder values. See [Configuration](./configuration.md#environment-variables) for the full list, including `EIDON_DATA_DIR`, which defaults to `./.data` in development.

Then:

```bash
npm run dev
```

### The dev server picks its own port

By convention in this repo, `npm run dev` binds a **random free port in the 3000–4000 range** and writes it to a `.dev-server` file in the project root:

```
http://localhost:3127
PID: 12345
```

This lets several worktrees run at once without colliding. Read the first line of `.dev-server` to find the URL. If the file exists but nothing answers on that port, the process is gone — delete the file and start again. Setting `PORT` explicitly overrides the random choice.

### `dev` vs `dev:next`

`npm run dev` starts `server.cjs`, a custom Node server that wraps Next.js and attaches a `ws` WebSocket server. The realtime chat runtime depends on it: streaming turns, multi-client sync, the automation scheduler, and the bot run pipeline all live behind that WebSocket. This is the script you normally want.

`npm run dev:next` runs plain `next dev` with no WebSocket layer. Use it only when you are working on something that does not need the chat runtime — pages will render, but chat will not stream.

## npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Bundle the WebSocket handler and start the custom dev server |
| `npm run dev:ws` | Identical to `dev`; kept as an explicit alias |
| `npm run dev:next` | Plain `next dev` without the WebSocket runtime |
| `npm run build` | Production Next.js build |
| `npm run start` | Bundle the WebSocket handler and start the server with `NODE_ENV=production` |
| `npm run lint` | ESLint over the repo |
| `npm run typecheck` | `next typegen` followed by `tsc --noEmit` |
| `npm run test` | Vitest unit tests with coverage |
| `npm run test:watch` | Vitest in watch mode, no coverage |
| `npm run test:e2e` | Playwright end-to-end specs |
| `npm run seed:readme-demo` | Seed the disposable README screenshot dataset |
| `npm run screenshots` | Capture the README screenshots against that dataset |
| `npm run assets:warrior-icons` | Regenerate the app and PWA icon assets in `public/` from `public/eidon-banner.png` |

## Testing

**Unit tests** run under Vitest from `tests/unit/`, in a Node environment, single-worker and without file parallelism because they share a real SQLite database per run. Coverage is measured over `lib/**/*.ts` and the config enforces **85% for lines, functions, branches, and statements** — `npm run test` fails below that.

**End-to-end tests** run under Playwright from `tests/e2e/` (`smoke`, `features`, `bots`) against Desktop Chrome. The Playwright config boots its own dev server on port 3117 with a throwaway `.e2e-data` directory and its own test credentials, so no manual setup is needed; just run `npm run test:e2e`.

## README screenshot pipeline

The screenshots in the README are generated, not hand-taken, so they can be refreshed after a UI change. Two scripts do the work.

**`npm run seed:readme-demo`** builds a disposable demo dataset into `.context/readme-demo-data`, wiping the directory first: accounts, provider profiles, personas, memories, folders, skills, MCP servers, a representative conversation, and an automation with a completed run. It prints JSON with the demo login credentials and the ids it created. The script refuses to run against a data directory whose final path segment does not contain `readme-demo`, so it cannot destroy your real `.data` or a production volume by accident.

**`npm run screenshots`** is the whole pipeline. It seeds the dataset, starts a dev server pointed at it, drives the bundled `agent-browser` CLI through the app at desktop and mobile viewports, writes the images into `.github/readme/`, and tears the server and browser down afterwards.

Requirements on your PATH: `jq`, `curl`, and `agent-browser`.

```bash
npm run screenshots
```

Then review the changed files under `.github/readme/` before committing them. Because the dataset is regenerated from scratch each time, the output is reproducible; if a capture comes out wrong it is usually because the UI moved and the script needs updating alongside it.

## Docker image channels

Two channels are published to `ghcr.io/quack6765/eidon-ai`.

| Channel | Tags | Published when |
| --- | --- | --- |
| Stable | `:latest`, `:<release version>` | A GitHub release is published whose target is `main` |
| Dev | `:dev`, `:dev-<short sha>` | The Docker Dev workflow is run manually on the `dev` branch |

Pull requests against `main` build the image to prove it still builds, but publish nothing.

Most users should stay on stable, which only moves when a release is cut. To test changes before release, merge them into `dev`, trigger the dev image build, then run it alongside your stable instance with its own data volume and port. Save as `docker-compose.dev.yml`:

```yaml
services:
  eidon-dev:
    image: ghcr.io/quack6765/eidon-ai:dev
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      EIDON_PASSWORD_LOGIN_ENABLED: "true"
      EIDON_ADMIN_USERNAME: "admin"
      EIDON_ADMIN_PASSWORD: "${EIDON_ADMIN_PASSWORD}"
      EIDON_SESSION_SECRET: "${EIDON_SESSION_SECRET}"
      EIDON_ENCRYPTION_SECRET: "${EIDON_ENCRYPTION_SECRET}"
    volumes:
      - eidon-dev-data:/app/data

volumes:
  eidon-dev-data:
```

The `:dev` tag is mutable and always points at the latest dev build, so pull before restarting:

```bash
docker compose -f docker-compose.dev.yml pull
docker compose -f docker-compose.dev.yml up -d
```

Use a separate volume, as shown. Pointing a dev image at your production volume runs unreleased migrations against your real data.

The in-app version shows `dev-<short sha>` on dev builds and the release tag on stable ones, so you can confirm exactly which build you are looking at.

## Architecture orientation

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 App Router with React 19 |
| Server | A custom Node server wrapping Next, plus a `ws` WebSocket server sharing the same HTTP listener |
| Database | SQLite through `better-sqlite3`, with hand-rolled sequential migrations |
| Styling | Tailwind CSS v4 with shadcn-style components on Radix primitives |
| Animation | `framer-motion` |
| Markdown | `streamdown` with code, math, Mermaid, and CJK plugins |

Useful entry points:

- [`server.ts`](../server.ts) / `server.cjs` — the custom server: port selection, `.dev-server` handling, WebSocket upgrade routing for `/ws` and `/api/v1/ws`, runtime bootstrap, and the automation scheduler
- [`lib/ws-handler.ts`](../lib/ws-handler.ts) — the WebSocket protocol: subscribe, snapshot, send, stop, and the queued-message operations. It is bundled to CommonJS by esbuild before the server starts, which is why `dev` and `start` have a build step in front of them
- [`lib/db.ts`](../lib/db.ts) — database handle and path resolution
- [`lib/db-migrations.ts`](../lib/db-migrations.ts) — the migration list, applied on first database access
- [`lib/chat-turn.ts`](../lib/chat-turn.ts) and [`lib/assistant-runtime.ts`](../lib/assistant-runtime.ts) — one turn end to end: prompt assembly, the tool loop, and streaming
- [`lib/tool-definitions.ts`](../lib/tool-definitions.ts) and `lib/tool-executors.ts` — which tools the model gets and what they do

## Versioned mobile API

Native and mobile clients use a separate versioned surface rather than the app's internal routes:

- REST under `/api/v1/*`, implemented as a catch-all that delegates to the same route handlers the web app uses
- WebSocket at `/api/v1/ws`

Published contracts live in [`contracts/`](../contracts):

| File | Contents |
| --- | --- |
| `mobile-api-v1.openapi.json` | OpenAPI description of the REST surface |
| `mobile-api-v1.websocket.schema.json` | JSON Schema for the WebSocket message envelope |
| `mobile-api-v1-handoff.md` | Release notes for client authors: what changed and what it means |

They are attached to stable GitHub releases as assets, and a unit test checks the implementation against them.

Mobile sessions are distinct from browser sessions: they use their own JWT audience (`eidon-mobile-v1`), last **30 days**, and are individually listable and revocable through `/api/v1/auth/sessions`. A minimum server version is declared in the contract so a client can refuse to talk to a server that is too old.

## Reference documents

- [`DESIGN.md`](../DESIGN.md) and [`DESIGN.json`](../DESIGN.json) — the design system: tokens, colour, type, spacing, and component conventions. `DESIGN.json` is the machine-readable form
- [`PRODUCT.md`](../PRODUCT.md) — product intent, audience, brand personality, anti-references, and design principles. Read it before making product or copy decisions

## See also

- [Configuration](./configuration.md) — environment variables, storage, and security
- [Providers](./providers.md) — provider presets and per-profile options
- [MCP and skills](./mcp-and-skills.md) — extending the tool layer
- [Features](./features.md) — the full capability reference
- [README](../README.md)
