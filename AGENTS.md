# Project Instructions

### Dev Server

- You may start the dev server (`npm run dev`) when needed.
- The dev server uses a random port in the 3000-4000 range to support multiple worktrees.
- **Before starting**, check if a `.dev-server` file exists in the project root.
  - If it exists, read the URL from it (first line) and use that for testing.
  - If the file exists but the server is not running (cannot connect), delete it and start fresh.
- After starting `npm run dev`, wait for the `.dev-server` file to appear, then read the URL from it.
- The `.dev-server` file format is:
  ```
  http://localhost:3127
  PID: 12345
  ```

### Mobile API contract and native clients

`contracts/mobile-api-v1.openapi.json` (and
`contracts/mobile-api-v1.websocket.schema.json`) define the mobile API that
native clients are built against. The contract is the source of truth; clients
derive their generated API layers from it — they never hand-edit their side.

**After any change to the API surface** — new or modified routes,
request/response schemas, enums, or the WebSocket event set — always:

1. Update `contracts/mobile-api-v1.openapi.json` in the same PR (and the
   gateway route table in `app/api/v1/[...path]/route.ts` when mounting new
   shared handlers). Update `tests/unit/mobile-contracts.test.ts` and
   `tests/unit/mobile-routes.test.ts` expectations (documented operation and
   request-body counts) so the contract stays verified.
2. Note in the PR description that native clients must regenerate their
   derived specs from the updated contract. A stale generated client compiles
   cleanly and fails only at runtime with decoding errors, so this
   regeneration step must be called out explicitly — never assumed.
