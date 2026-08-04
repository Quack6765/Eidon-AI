# Mobile API v1 coordinated release

The mobile v1 contract is replaced in place by this release. The server and native client must ship together; older v1 clients are not supported after the upgrade.

Provider profiles now expose a discriminated `providerConfig` and a generic `connection` summary. Credentials are write-only and are changed through `/providers/{profileId}/connection`. OAuth-capable providers use `/providers/{profileId}/connection/flows`, while model discovery uses `/providers/{profileId}/models`. The registered GitHub browser callback remains provider-specific because it is an external OAuth callback.

Settings now expose `webSearch`, `imageGeneration`, and `speechTranscription` selections with `providerId`, typed configuration, configured state, and scope. Every credential update uses `preserve`, `replace`, or `clear`.

Server-backed transcription now uses `/speech/transcription/prepare` and `/speech/transcription/transcribe`. The selected transcription provider determines preparation, sample-rate validation, upload limits, and response details.

The server-info capability is `providerConnections`. Regenerate, retry, edit-restart, queues, automations, SSE, and WebSocket turns continue to use the same v1 conversation and event schemas.
