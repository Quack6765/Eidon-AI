# Mobile API v1 coordinated release

The mobile v1 contract is replaced in place by this release. The server and native client must ship together; older v1 clients are not supported after the upgrade.

Provider profiles now expose a discriminated `providerConfig` and a generic `connection` summary. Credentials are write-only and are changed through `/providers/{profileId}/connection`. OAuth-capable providers use `/providers/{profileId}/connection/flows`, while model discovery uses `/providers/{profileId}/models`. The registered GitHub browser callback remains provider-specific because it is an external OAuth callback.

Settings now expose `webSearch`, `imageGeneration`, and `speechTranscription` selections with `providerId`, typed configuration, configured state, and scope. Every credential update uses `preserve`, `replace`, or `clear`. All three integrations are admin-managed with `global` scope: non-admin `PUT /settings/general` requests that include them are rejected with 403.

Server-backed transcription now uses `/speech/transcription/prepare` and `/speech/transcription/transcribe`. The selected transcription provider determines preparation, sample-rate validation, upload limits, and response details.

Run-done notifications are now available. Automations accept an optional `notifyConfig` with independent channels: `ntfy` (self-hostable topic), `webhook` (JSON POST with extra headers), `pushover` (per-user credentials managed outside the automation), and `push` (Web Push). Channel secrets such as webhook URLs and header values are write-only: reads return `{ "set": true }` markers and updates preserve stored values by sending the marker back. Payloads are title-only unless a channel opts in with `includeSummary`. When the server is configured with `EIDON_BASE_URL`, every payload also carries a `runUrl` deep link to `/automations/{automationId}/runs/{runId}` (ntfy `click`, Pushover `url`, web push `url`).

`server-info` now reports `pushNotifications: true`. Web Push uses `GET /push/vapid` (public key only); VAPID keys are generated automatically by the server on first use and the private key is stored encrypted and never returned. `GET`/`POST`/`DELETE /push/subscribe` manage the session user's subscriptions. A 404/410 from a push service purges the subscription.

The server-info capability is `providerConnections`. Regenerate, retry, edit-restart, queues, automations, SSE, and WebSocket turns continue to use the same v1 conversation and event schemas.
