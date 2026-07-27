# Mobile API v1

Eidon Mobile API v1 is the platform-neutral server contract for native clients. The Docker deployment remains authoritative for identity, providers, conversations, messages, attachments, memories, skills, MCP servers, automations, settings, OAuth credentials, and AI execution. Native clients are online-first and do not run provider, MCP, skill, memory, or automation infrastructure on the device.

The first native-compatible release is `v3.7.0`. Until that GitHub release and Docker image are published with passing quality gates, Mobile API v1 must be described as pre-release and must not be advertised for external TestFlight use.

The checked-in sources of truth are:

- `contracts/mobile-api-v1.openapi.json`
- `contracts/mobile-api-v1.websocket.schema.json`

Release and CI artifacts use those exact resolved JSON documents. A native repository should pin the documents from a specific Eidon release rather than following `main`.

## Compatibility

Clients begin with unauthenticated `GET /api/v1/server-info`. A compatible response identifies Eidon, includes `v1` in `supportedApiVersions`, advertises `/api/v1/ws`, and reports attachment limits and password-login availability.

The client states are:

| State | Client behavior |
| --- | --- |
| Mobile API v1 is present and password login is enabled | Permit native sign-in |
| Mobile API v1 is present and password login is disabled | Explain that the administrator must enable password login; do not fall back to cookies |
| `/api/v1/server-info` is absent or predates `v3.7.0` | Show server-upgrade-required instructions |
| Only unsupported future API versions are advertised | Stop and request a compatible client update |
| The response is not valid Eidon metadata | Reject the endpoint |

Within v1, new optional fields and optional event types may be added. Removing fields, changing their meaning, or making optional fields required needs API v2. Dates are RFC 3339 strings. IDs and cursors are opaque strings. If a client cannot safely apply an optional future event, it requests an authoritative snapshot.

## Authentication and session operations

Browser sessions remain cookie-only at `/api/auth/*`. Native sessions are purpose-isolated bearer sessions:

1. `POST /api/v1/auth/login` accepts `username`, `password`, and a 1–80 character `deviceName`.
2. The response returns the bearer token once, with a 30-day absolute expiry and no refresh token.
3. `GET /api/v1/auth/session` validates the current bearer and returns a sanitized user.
4. `GET /api/v1/auth/sessions` lists live mobile sessions and their device names.
5. `DELETE /api/v1/auth/sessions/{sessionId}` revokes an owned mobile session.
6. `POST /api/v1/auth/logout` revokes the current mobile session.

Tokens must be stored in the operating system credential store. They must never be placed in URLs, query strings, application logs, analytics events, crash annotations, or synchronized preferences.

Mobile and browser JWTs use distinct audiences, token-use claims, signing-key domains, and persisted session purposes. Browser tokens fail mobile authentication, mobile tokens fail browser-cookie authentication, and `/api/v1/ws` accepts only `Authorization: Bearer …` during the WebSocket upgrade. Password changes, administrator password resets, user deletion, explicit revocation, expiry, and global session invalidation revoke the affected mobile sessions.

Login failures use a generic invalid-credentials response. Login attempts are throttled by normalized username and source address through a bounded, expiring registry. Audit events contain only hashed subjects/sources, result codes, and server-generated session IDs.

## Authorization and redaction

Every protected REST adapter authenticates the bearer first and then enters the same route-independent user context consumed by existing Eidon services. Existing owner checks and administrator checks therefore remain authoritative. Client-supplied role data is ignored.

Administrators can manage providers, image generation, title generation, GitHub Copilot, MCP servers, skills, and users. Members can access only their own conversations, folders, messages, attachments, automations, personas, memories, and user settings. Public conversation and attachment access remains behind the existing high-entropy share-token routes and is never widened by bearer authentication.

Mobile response sanitation removes database-only attachment paths and extracted file bodies, encrypted credential fields, raw API keys, GitHub tokens, MCP header/environment values, bearer credentials, and password hashes. The API returns state booleans and sanitized metadata such as `hasApiKey`, `hasHeaders`, `hasEnv`, and GitHub connection status.

## PWA parity inventory

| PWA surface | Mobile API operations | Authorization |
| --- | --- | --- |
| `/`, `/chat/{conversationId}` | Conversations, global search, snapshots, send/stop, retry, regenerate, edit-and-restart, fork, queues, memory proposals, realtime | Resource owner |
| Sidebar folders and ordering | `/folders`, `/folders/{folderId}`, conversation reorder/move | Resource owner |
| Conversation sharing | `/conversations/{conversationId}/share`; returned public HTTPS URL uses existing `/api/share/{shareToken}` boundary | Resource owner; public token for shared reads |
| Attachment upload/preview/download/delete | `/attachments`, `/attachments/{attachmentId}` | Conversation owner |
| `/automations`, `/automations/{id}`, run detail pages | Automation CRUD, run-now, cursor-paginated history, transcript, retry | Resource owner |
| `/settings/general` and `/settings/account` | `/settings`, `/settings/general`, `/auth/account` | Authenticated user; deployment rules still apply |
| `/settings/personas`, `/settings/memories` | `/personas`, `/memories` | Resource owner |
| Provider selection in chat | Sanitized provider summaries in `/settings`; conversation update selects a profile | Authenticated user using allowed profile metadata |
| `/settings/providers` | Provider catalog update/duplication/test, models, title/image generation, GitHub connect/disconnect | Administrator |
| `/settings/mcp-servers` | MCP CRUD and test | Administrator |
| `/settings/skills` | Skill list/create/import/edit/enable/delete | Administrator |
| `/settings/users` | User list/create/role/password/delete | Administrator |

Server speech endpoints remain available under `/speech/canary/*` for compatible clients, but native clients may use operating-system speech input without changing the Mobile API contract.

The existing web APIs remain under `/api/*`. Mobile adapters under `/api/v1/*` reuse their domain services and normalize JSON into one envelope:

```json
{ "data": { "example": true } }
```

Errors have a stable code and bounded optional details:

```json
{ "error": { "code": "invalid_request", "message": "Invalid request" } }
```

Binary attachment responses and the legacy-compatible chat SSE stream retain their declared media types instead of being JSON-wrapped.

## Realtime recovery

Connect to `wss://SERVER/api/v1/ws` with the mobile bearer header. The server applies the existing connection ceiling, 30-second heartbeat, per-user broadcasts, conversation ownership checks, chat-turn coordinator, and queue dispatcher.

After `ready`, a client subscribes to visible conversations and receives authoritative snapshots. Reconnecting clients authenticate again, receive active-conversation state, resubscribe, and send `request_snapshot` for state they were tracking. Snapshot messages replace locally accumulated state. Message and action IDs make repeated events idempotent. Authentication close code `1008` and API compatibility failures stop automatic reconnect; transient transport failures may use bounded backoff.

The schema defines subscribe/unsubscribe, snapshot requests, send/stop, queue create/update/delete/reorder/send-now, ready state, snapshots, persisted messages, queue updates, answer/thinking deltas, action lifecycle, compaction lifecycle, usage, retries, completion, conversation lifecycle, and stable errors.

## GitHub Copilot OAuth

An authenticated administrator starts native OAuth with `POST /api/v1/providers/github/connect` and a Copilot provider-profile ID. Eidon returns a GitHub authorization URL plus a short-lived flow ID. The native app opens that URL with an operating-system authentication session.

GitHub returns to the configured Eidon HTTPS callback. Signed state binds the administrator, profile, flow, and current profile nonce. The callback atomically consumes the flow before token exchange, verifies that the user is still an administrator and the profile intent is still current, encrypts credentials on the server, and redirects only to:

```text
eidon://oauth/github?flowId=OPAQUE_ID&status=success
```

or the same URL with `status=failure`. Tokens and internal errors never enter the redirect. `GET /api/v1/providers/github/connect/{flowId}` exposes sanitized status; `DELETE` cancels a pending attempt. Expired, replayed, canceled, wrong-user, wrong-role, stale-profile, malformed, and already-consumed flows fail closed.

## HTTPS and reverse proxies

Production native clients require a publicly trusted certificate, HTTPS, and WSS. Do not recommend arbitrary HTTP exceptions, certificate-trust bypasses, or application transport security exemptions. Private deployments must install a certificate chain the device legitimately trusts.

The reverse proxy must:

- terminate trusted TLS;
- forward the original host and one unambiguous HTTPS protocol value;
- preserve `Authorization` on REST requests and WebSocket upgrades;
- support WebSocket upgrade/connection headers on `/api/v1/ws`;
- preserve streaming responses without buffering them indefinitely;
- route the GitHub callback to the same Eidon deployment.

Mobile login rejects ambiguous forwarded-protocol chains and production HTTP. If both standardized `Forwarded` and `X-Forwarded-Proto` are present, they must agree.

## Seeded Docker integration deployment

`docker-compose.native-test.yml` reuses the README demo seeder to create administrator and member users, conversations, folders, an attachment, memories, personas, provider profiles, skills, MCP records, automations, and run history. It replaces provider destinations with a deterministic local OpenAI-compatible fixture that supports streaming success and a `[fail]` failure prompt.

Start it with:

```bash
docker compose -f docker-compose.native-test.yml up --build
```

The endpoint is `https://eidon.localhost:8443`. Caddy generates a local CA. Extract its root certificate from `/data/caddy/pki/authorities/local/root.crt` in the Caddy container and install it only on dedicated test devices using the operating system trust workflow. Never ship that CA or disable certificate validation.

Fixture users are `readme_admin` and `readme_member`; both use `ReadmeDemo123!`. The environment super-administrator is `native_super_admin` with the password declared in the test-only Compose file.

## Release gate and upgrades

Before publishing the native-compatible tag:

1. Run the full unit/integration suite with every global coverage metric at or above 85%.
2. Run lint, typecheck, the production Next.js build, the production Docker build, built-in-browser desktop/mobile PWA regression checks, and `git diff --check`.
3. Run administrator and member contract tests against the seeded HTTPS/WSS deployment.
4. Confirm the OpenAPI and WebSocket schema artifacts are attached to the release.
5. Publish the tagged Docker image only from `main` after all checks pass.

An operator seeing an incompatible-server message should back up the Eidon data volume, pull the documented `v3.7.0` or newer Docker tag, restart the same deployment with unchanged secrets and volume mapping, verify `/api/v1/server-info`, and then reconnect the native client. Existing web and PWA sessions remain supported throughout the upgrade.

For authentication troubleshooting, verify trusted TLS first, then password-login availability, server/client compatibility, bearer expiry, the session list, and reverse-proxy preservation of `Authorization`. Do not ask users to paste tokens or provider credentials into support messages.
