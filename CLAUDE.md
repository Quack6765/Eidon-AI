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

### Release highlights (the "What's new" pop-up)

`lib/release-notes/` is the source of truth for the "What's new" pop-up that
every user sees once after the server is updated. One file per release keeps any
single file small — releases ship weekly, so a combined file would grow without
bound.

Adding a release takes two edits:

1. Create `lib/release-notes/<tag>.ts` — for example `lib/release-notes/v4.1.0.ts`
   — exporting `releaseNote`.
2. Register it in the `RELEASE_NOTES` array in `lib/release-notes/index.ts`.

A unit test globs the folder and fails if a file is not registered, so a missed
two-line edit cannot silently ship a release that announces nothing.

Each entry has:

- `version` — the exact GitHub release tag, e.g. `v4.1.0`, matching the file
  name. It must match `NEXT_PUBLIC_APP_VERSION`, which the stable workflow takes
  from `github.event.release.tag_name`.
- `date` — the release date, `YYYY-MM-DD`.
- `bullets` — 3 to 6 single-line highlights.

The array order does not matter; the newest release is selected by version.

Write for a non-technical self-hoster, not for a contributor:

- Say what the user can now do, or what stopped going wrong: "Get a Pushover
  notification when an automation finishes", not "Add Pushover notifier".
- Name the service or provider a user would recognise — Pushover, Mistral,
  GitHub Copilot, OpenRouter.
- List a fix when a user would have felt it. Skip internal-only work such as
  CI, docs, tests, and dependency bumps unless it changes what a self-hoster
  has to do.
- No PR numbers, author handles, "What's Changed" boilerplate, or internal
  terms such as contract, route, migration, or refactor.
- Keep each bullet on one line, under roughly 120 characters. Do not let one
  grow past that to avoid a second line — split it into two bullets instead.

The entries are bundled into the image, so the file has to land in the same PR
that cuts the release. Keep them as TypeScript rather than loose markdown: the
standalone Docker build only ships traced/imported files, so an untraced `.md`
would work in dev and be missing in production.

Only real release tags can trigger the pop-up: `dev`, `dev-<sha>`, and
`*-native-test` builds never auto-open it, and a release with no entry stays
silent. The version label in Settings opens it on demand, which is the
deterministic way to preview a change. A brand-new account is seeded with the
version it was installed on, so only an existing install upgrading onto a
release is announced.

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
