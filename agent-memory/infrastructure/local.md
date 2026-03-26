# Local Development

## Prerequisites
- **Runtime:** Node.js 22+
- **Tools:** npm and a local toolchain capable of building `better-sqlite3`

## Setup
```bash
npm install
export HERMES_ADMIN_USERNAME=admin
export HERMES_ADMIN_PASSWORD=changeme123
export HERMES_SESSION_SECRET=replace-with-32-plus-chars
export HERMES_ENCRYPTION_SECRET=replace-with-32-plus-chars
npm run dev
```

## Services
| Service | Port | URL |
|---------|------|-----|
| Hermes web app | 3000 | http://localhost:3000 |

## Common Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the app locally |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript checks |
| `npm run test` | Run unit tests with coverage |
| `npm run test:e2e` | Run Playwright smoke test |
