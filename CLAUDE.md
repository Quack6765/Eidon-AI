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

### Mobile API contract and the iOS client spec

`contracts/mobile-api-v1.openapi.json` (and
`contracts/mobile-api-v1.websocket.schema.json`) define the mobile API that the
native iOS client (`Quack6765/Eidon-AI-IOS`, sibling checkout at
`/Users/charles/Documents/Github/Eidon-AI-IOS`) is built against. The contract
is the source of truth; the iOS app derives its generated client from it.

**After any change to the API surface** — new or modified routes, request/response
schemas, enums, or the WebSocket event set — always:

1. Update `contracts/mobile-api-v1.openapi.json` in the same PR (and the
   gateway route table in `app/api/v1/[...path]/route.ts` when mounting new
   shared handlers). Update `tests/unit/mobile-contracts.test.ts` and
   `tests/unit/mobile-routes.test.ts` expectations (documented operation and
   request-body counts) so the contract stays verified.
2. Regenerate the iOS client spec — never hand-edit it. From the iOS repo, run
   the prepare script once per artifact, sourcing the contract from this repo
   at the ref the iOS work targets (a release tag for release parity,
   `origin/dev` for dev parity; the Orca worktree `openapi-spec-sync` is a
   stable `origin/dev` source):
   ```
   swift Scripts/prepare-openapi-contract.swift <this-repo>/contracts/mobile-api-v1.openapi.json Eidon/openapi.yaml
   swift Scripts/prepare-openapi-contract.swift <this-repo>/contracts/mobile-api-v1.openapi.json Eidon/OpenAPI/mobile-api-v1.openapi.json
   ```
   `Eidon/openapi.yaml` is the build input for swift-openapi-generator — a stale
   one makes the iOS app decode against an old schema and fail at runtime with
   `DecodingError`, so regenerating both artifacts is mandatory, not optional.
3. Coordinate the follow-through: the regenerated spec plus a decoding test for
   the new/changed shape belong in the iOS repo, committed together with the
   consuming client code. If you only changed the web side, flag the iOS
   regeneration explicitly in the PR description so it is not forgotten.
