---
name: GitHub Copilot Provider
description: Per-profile GitHub OAuth connection that lets users talk to LLMs in Eidon using their own Copilot subscription
type: design
---

# GitHub Copilot Provider Design

## Overview

Add GitHub Copilot as a provider type in the existing settings-driven provider profile system. A Copilot profile is connected to one GitHub account through OAuth and uses that account's Copilot entitlement to power chat requests inside Eidon. This does not replace Eidon's existing site authentication.

The integration is profile-scoped:
- each provider profile can be either `openai_compatible` or `github_copilot`
- each Copilot profile owns its own GitHub OAuth connection
- duplicated Copilot profiles start disconnected
- tokens are stored and refreshed server-side only
- the available model list is loaded from the connected account and exposed in the profile editor

## Requirements

- GitHub Copilot must appear as a provider option on `/settings/providers`
- Copilot provider authentication must use OAuth only
- GitHub sign-in must not become the main site authentication flow
- OAuth credentials must belong to a single provider profile, not the whole app
- Duplicating a Copilot profile must not copy GitHub tokens or connection state
- The server must use lazy token refresh before model discovery or chat execution when a token is near expiry
- Users must be able to disconnect a Copilot profile without affecting other profiles
- The settings UI must show the full model list exposed to the connected GitHub account
- Existing OpenAI-compatible profiles must continue working without behavior changes
- Provider failures must surface explicit errors instead of silent fallback

## Recommended Approach

Use a GitHub App with the OAuth authorization code web flow and the `@github/copilot-sdk` client for inference.

This is the recommended approach because GitHub documents GitHub App OAuth for web and multi-user applications, recommends GitHub Apps over OAuth Apps for new work, and leaves token lifecycle management to the integrating app.

## External References

- [Authenticating with Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/authenticate-copilot-sdk/authenticate-copilot-sdk)
- [Using GitHub OAuth with Copilot SDK](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth)
- [Best practices for creating an OAuth app](https://docs.github.com/en/enterprise-cloud@latest/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [Refreshing user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
- [REST API endpoints for models inference](https://docs.github.com/en/rest/models/inference)
- [Models catalog](https://docs.github.com/en/rest/models/catalog)

## Data Model

### Provider Profile Kind

Extend provider profiles with a provider kind discriminator.

```typescript
type ProviderKind = "openai_compatible" | "github_copilot";
```

### TypeScript Types

```typescript
type ProviderProfile = {
  id: string;
  providerKind: ProviderKind;
  name: string;
  apiBaseUrl: string;
  apiKeyEncrypted: string;
  model: string;
  apiMode: ApiMode;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  reasoningSummaryEnabled: boolean;
  modelContextLimit: number;
  compactionThreshold: number;
  freshTailCount: number;
  tokenizerModel: "gpt-tokenizer" | "off";
  safetyMarginTokens: number;
  leafSourceTokenLimit: number;
  leafMinMessageCount: number;
  mergedMinNodeCount: number;
  mergedTargetTokens: number;
  visionMode: VisionMode;
  visionMcpServerId: string | null;
  githubUserAccessTokenEncrypted: string;
  githubRefreshTokenEncrypted: string;
  githubTokenExpiresAt: string | null;
  githubRefreshTokenExpiresAt: string | null;
  githubAccountLogin: string | null;
  githubAccountName: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProviderProfileSummary = Omit<
  ProviderProfile,
  "apiKeyEncrypted" | "githubUserAccessTokenEncrypted" | "githubRefreshTokenEncrypted"
> & {
  hasApiKey: boolean;
  githubConnectionStatus: "disconnected" | "connected" | "expired";
};
```

### Database Schema

Add nullable Copilot-specific columns to `provider_profiles`.

```sql
ALTER TABLE provider_profiles ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'openai_compatible';
ALTER TABLE provider_profiles ADD COLUMN github_user_access_token_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_profiles ADD COLUMN github_refresh_token_encrypted TEXT NOT NULL DEFAULT '';
ALTER TABLE provider_profiles ADD COLUMN github_token_expires_at TEXT;
ALTER TABLE provider_profiles ADD COLUMN github_refresh_token_expires_at TEXT;
ALTER TABLE provider_profiles ADD COLUMN github_account_login TEXT;
ALTER TABLE provider_profiles ADD COLUMN github_account_name TEXT;
```

Existing rows migrate to `provider_kind = 'openai_compatible'`.

## Configuration

Add server-side environment variables for the GitHub App OAuth integration.

| Variable | Purpose |
|----------|---------|
| `EIDON_GITHUB_APP_CLIENT_ID` | GitHub App OAuth client ID |
| `EIDON_GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret |
| `EIDON_GITHUB_APP_CALLBACK_URL` | Absolute OAuth callback URL |

These values are app-wide integration config and do not belong in the per-profile settings form.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers/github/connect` | Start OAuth for one provider profile |
| GET | `/api/providers/github/callback` | Complete OAuth and attach tokens to the target profile |
| POST | `/api/providers/github/disconnect` | Clear Copilot OAuth credentials from one profile |
| GET | `/api/providers/github/models` | Return models available to the connected account for one profile |

## OAuth Flow

### Connect

1. User clicks `Connect GitHub` on a Copilot profile in settings
2. Client sends the target `providerProfileId`
3. Server validates that the profile exists and is `github_copilot`
4. Server creates a signed, short-lived `state` payload containing:
   - `providerProfileId`
   - current local user/session identity
   - timestamp and nonce
5. Server redirects the browser to GitHub OAuth authorization

### Callback

1. GitHub redirects to the configured callback URL with `code` and `state`
2. Server validates the signed `state`
3. Server exchanges the code for GitHub App user tokens
4. Server fetches the connected GitHub identity
5. Server encrypts and stores:
   - user access token
   - refresh token
   - access token expiry
   - refresh token expiry
   - GitHub account login and display name
6. Server redirects back to `/settings/providers` with success or failure status

### Disconnect

Disconnect clears only Copilot-specific credential fields on the targeted profile:
- `githubUserAccessTokenEncrypted`
- `githubRefreshTokenEncrypted`
- `githubTokenExpiresAt`
- `githubRefreshTokenExpiresAt`
- `githubAccountLogin`
- `githubAccountName`

The profile record itself stays intact.

## Runtime Behavior

### Lazy Token Refresh

Token refresh is server-side and demand-driven.

Refresh points:
- before loading the model list for a Copilot profile
- before chat execution for a Copilot profile

Refresh policy:
- if the access token is missing, treat the profile as disconnected
- if the access token is near expiry, exchange the refresh token and persist the returned credentials
- if refresh fails, mark the profile unusable until the user reconnects

No background refresh job is included in v1.

### Model Discovery

When a Copilot profile is connected, Eidon loads the model catalog using the connected account's credentials and returns the models available to that account.

Model discovery behavior:
- fetch models server-side
- map results to the settings dropdown
- preserve the saved model only if it still exists in the returned set
- show an explicit validation error if a previously saved model is no longer available

### Chat Execution

At send time:

1. Resolve the selected provider profile
2. Branch by `providerKind`
3. For `openai_compatible`, keep the existing path unchanged
4. For `github_copilot`:
   - refresh token if needed
   - construct the Copilot client using the GitHub user access token
   - execute the prompt against the selected model
   - normalize and stream the result into the existing chat event pipeline

## UI Design

### Provider Editor

Update the provider settings editor in `providers-section.tsx` to expose provider type.

For `openai_compatible` profiles, keep the current UI.

For `github_copilot` profiles, show:
- provider type selector
- connection status
- connected GitHub account label
- `Connect GitHub` button when disconnected
- `Reconnect GitHub` and `Disconnect` when connected
- model dropdown sourced from the server
- non-editable status text for token state or entitlement errors

Hide these fields for Copilot profiles:
- API base URL
- API key
- API mode preset buttons tied only to OpenAI-compatible endpoints

OpenAI-compatible profile duplication keeps current behavior. Copilot profile duplication copies non-secret fields but clears all GitHub credential and account metadata.

### UX States

Required UI states:
- disconnected
- connecting
- connected
- refresh failed
- entitlement missing
- model list unavailable

The settings form should not silently save a Copilot profile as usable if it is disconnected.

## Files to Create

| File | Purpose |
|------|---------|
| `app/api/providers/github/connect/route.ts` | Start profile-scoped GitHub OAuth |
| `app/api/providers/github/callback/route.ts` | Complete OAuth and persist tokens |
| `app/api/providers/github/disconnect/route.ts` | Disconnect one Copilot profile |
| `app/api/providers/github/models/route.ts` | Return model list for one Copilot profile |
| `lib/github-copilot.ts` | OAuth helpers, token refresh, model discovery, Copilot client wiring |

## Files to Modify

| File | Changes |
|------|---------|
| `lib/types.ts` | Add provider kind and Copilot credential metadata |
| `lib/db.ts` | Migrate `provider_profiles` for Copilot fields |
| `lib/settings.ts` | Validate, persist, sanitize, and duplicate mixed provider kinds |
| `lib/provider.ts` | Add provider-kind branching and Copilot inference path |
| `lib/provider-presets.ts` | Limit presets to OpenAI-compatible profiles or make them provider-kind aware |
| `components/settings/sections/providers-section.tsx` | Add provider-type UI, GitHub connection controls, and model discovery UX |
| `tests/unit/settings.test.ts` | Cover persistence and duplication rules |
| `tests/unit/provider.test.ts` | Cover Copilot runtime path and lazy refresh behavior |

## Validation Rules

- `providerKind` is required on every profile
- `openai_compatible` profiles require existing runtime provider fields
- `github_copilot` profiles must not require `apiKey`
- `github_copilot` profiles are allowed to save while disconnected, but they cannot pass connection tests or be used for chat until connected
- a connected `github_copilot` profile must have:
  - encrypted user access token
  - refresh token
  - access token expiry
  - connected GitHub account login

## Error Handling

Return explicit, user-visible errors for:
- invalid or expired OAuth `state`
- callback profile mismatch
- token exchange failure
- refresh failure
- missing refresh token
- missing Copilot entitlement
- failed model discovery
- selected model no longer available
- empty provider response

The app must not fall back from Copilot to the default OpenAI-compatible provider.

## Security

- Store GitHub OAuth credentials encrypted at rest using the existing crypto helpers
- Keep OAuth secrets in environment variables only
- Sign and validate the OAuth `state` payload server-side
- Scope each callback to a single provider profile and current session
- Never expose raw GitHub tokens to the client
- Clear credential fields completely on disconnect

## Testing

### Unit Tests

- settings parsing for mixed provider kinds
- sanitization excludes GitHub credential fields from client payloads
- duplication clears Copilot credentials and account metadata
- disconnect clears only the targeted profile's GitHub credential fields
- lazy refresh updates stored credentials before models or chat when expiry is near
- chat execution uses Copilot path only for `github_copilot`
- OpenAI-compatible profiles preserve current behavior

### Integration-Level Behavior

- OAuth callback attaches credentials to the intended profile only
- invalid `state` is rejected
- model discovery returns account-scoped models
- disconnected Copilot profile cannot run provider test or chat

## Non-Goals

- replacing site authentication with GitHub sign-in
- sharing one GitHub connection across multiple provider profiles
- manual token entry
- background token refresh jobs
- organization-wide Copilot connection management

## Rollout Notes

- Existing installs migrate all provider profiles to `openai_compatible`
- The Copilot provider UI appears only when GitHub App environment variables are configured correctly
- If integration env vars are missing, the settings page should either hide the Copilot option or present it as unavailable with a clear setup message
