# Local Development

## Prerequisites
- **Runtime:** Node.js 22+
- **Tools:** npm and a local toolchain capable of building `better-sqlite3`

## Setup
```bash
npm install
export EIDON_PASSWORD_LOGIN_ENABLED=false
export EIDON_ADMIN_USERNAME=admin
export EIDON_ADMIN_PASSWORD=changeme123
export EIDON_SESSION_SECRET=replace-with-32-plus-chars
export EIDON_ENCRYPTION_SECRET=replace-with-32-plus-chars
npm run dev
```

`npm run dev` starts the custom websocket server so the `/ws` realtime chat transport is available locally. `npm run dev:next` starts plain Next.js without websocket chat support and should only be used for debugging non-chat surfaces.

## Services
| Service | Port | URL |
|---------|------|-----|
| Eidon web app | 3000 | http://localhost:3000 |

## Common Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the app locally with websocket chat support |
| `npm run dev:next` | Start plain Next.js without the websocket chat server |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run unit tests with coverage |
| `npm run test:e2e` | Run Playwright smoke test |
