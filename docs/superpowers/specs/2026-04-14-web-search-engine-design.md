# Web Search Engine Selection Design

## Goal

Add a user-facing web search engine setting in General settings so each user can choose between `Exa`, `Tavily`, or `Disabled`, while keeping search MCP servers hidden from the MCP configuration UI and injecting the selected search connector dynamically at runtime.

## Scope

Included:

- Add a new per-user general setting for web search engine selection.
- Add encrypted per-user secret storage for Exa and Tavily API keys.
- Default fresh instances to `Exa` with no API key required.
- Render conditional key inputs in the General settings UI.
- Inject the selected search MCP server dynamically into chat runtime.
- Keep built-in search MCP servers out of the saved MCP server list and MCP settings UI.
- Add regression coverage for settings persistence, validation, and runtime injection.

Not included:

- OAuth support for Tavily or any other search provider.
- User-managed Exa or Tavily MCP records in the MCP Servers page.
- A broader provider abstraction for non-search MCP tools.
- Changes to the visible MCP Servers settings UX beyond ensuring built-in search connectors never appear there.

## Product Decisions

- `Exa` is the default selection on fresh instances.
- `Exa` works against the public remote MCP endpoint at `https://mcp.exa.ai/mcp`.
- Exa API key is optional. Users may save the form with no Exa key.
- `Tavily` requires a user-supplied API key. Saving must be rejected when Tavily is selected and the key is empty.
- `Disabled` means no web search MCP server is injected at all.
- Search MCP servers are built-in runtime constructs, not persisted rows in `mcp_servers`.

## Current State

- General settings already persist per-user preferences such as conversation retention, MCP timeout, and speech-to-text options through `user_settings`.
- The chat route currently loads persisted MCP servers from `mcp_servers` and exposes all enabled servers to the model.
- The MCP Servers page is user-visible and intended for user-managed connectors.
- There is no existing concept of a selected search provider or dynamically injected built-in MCP server.

## Approach Options Considered

### 1. Recommended: per-user search setting plus dynamic built-in MCP injection

Store the selected engine and API keys in `user_settings`, then construct a synthetic MCP server at runtime based on the active user setting.

Pros:

- Matches the requested product UX exactly.
- Keeps search selection simple and user-scoped.
- Prevents built-in search connectors from cluttering the MCP settings page.
- Ensures only the selected search provider is exposed to the model.

Cons:

- Introduces special runtime handling for built-in search MCP connectors.
- Requires a small amount of duplication between persisted MCP servers and synthetic MCP servers.

### 2. Persist Exa and Tavily as ordinary MCP server rows

Store Exa and Tavily in `mcp_servers`, then use the general setting only to enable or disable them.

Pros:

- Reuses the existing MCP server persistence path more directly.
- Keeps all MCP server definitions in one storage model.

Cons:

- Violates the product requirement that web search MCP servers stay hidden from the MCP config UI.
- Becomes awkward in multi-user scenarios because `mcp_servers` is not user-scoped.
- Makes a simple preference dependent on visible infrastructure rows.

### 3. Add a custom non-MCP search provider abstraction

Create a separate search layer in the runtime and bypass MCP entirely for Exa and Tavily.

Pros:

- Maximum control over search behavior.
- Avoids synthetic MCP server handling.

Cons:

- Diverges from the app's current MCP-based tool architecture.
- Requires more custom runtime logic than necessary for this feature.
- Reduces consistency with existing tool discovery and tool-call handling.

## Chosen Design

Use option 1.

Web search engine selection should live in per-user general settings. The runtime should derive zero or one synthetic search MCP server from those settings and append it to the normal persisted MCP server list before tool discovery. The selected search connector remains invisible in the MCP Servers page because it is never stored in `mcp_servers`.

## Settings Model

Extend `AppSettings` with:

- `webSearchEngine`: `"exa" | "tavily" | "disabled"`
- `exaApiKey`: decrypted value exposed only in user-scoped settings reads that already sanitize secrets appropriately for the General settings page
- `tavilyApiKey`: same handling as above

Persist encrypted values in `user_settings` as:

- `web_search_engine`
- `exa_api_key_encrypted`
- `tavily_api_key_encrypted`

Defaults for newly created `user_settings` rows:

- `web_search_engine = 'exa'`
- `exa_api_key_encrypted = ''`
- `tavily_api_key_encrypted = ''`

The values should be stored per user, not globally, matching the current behavior of other general settings.

## Database Migration

Add `ALTER TABLE user_settings` migrations for:

- `web_search_engine TEXT NOT NULL DEFAULT 'exa'`
- `exa_api_key_encrypted TEXT NOT NULL DEFAULT ''`
- `tavily_api_key_encrypted TEXT NOT NULL DEFAULT ''`

The migration should preserve existing user rows and backfill the Exa default automatically.

## General Settings API

Update the general settings request schema to accept:

- `webSearchEngine`
- `exaApiKey`
- `tavilyApiKey`

Validation rules:

- `webSearchEngine === 'exa'`: valid whether `exaApiKey` is empty or non-empty
- `webSearchEngine === 'tavily'`: invalid when `tavilyApiKey` is blank after trimming
- `webSearchEngine === 'disabled'`: valid regardless of whether either key is present

The API should preserve previously stored keys when a different engine is selected, unless the user explicitly edits the field contents.

## General Settings UI

Add a new `Web Search` card to [`components/settings/sections/general-section.tsx`](/Users/charles/conductor/workspaces/Eidon-AI/brasilia/components/settings/sections/general-section.tsx).

Controls:

- A dropdown labeled for web search engine selection with:
  - `Exa`
  - `Tavily`
  - `Disabled`

Conditional rendering:

- `Exa` selected:
  - show an informational note above the API key input
  - note explains that the key is optional and Exa also works without one on the public endpoint
  - show an Exa API key input
  - allow save when the field is empty
- `Tavily` selected:
  - show a Tavily API key input
  - no optional note
  - disable save and surface inline error state when the field is empty
- `Disabled` selected:
  - hide both API key inputs

UI behavior:

- Fresh instances load with `Exa` selected and an empty Exa API key field.
- Switching between `Exa` and `Tavily` should not clear previously entered secrets.
- Client-side validation should mirror the server-side rules, but server validation remains authoritative.

## Runtime Injection

Introduce a helper that derives a built-in search MCP server from the current user's general settings.

Behavior:

- `disabled`: return no built-in search MCP server
- `exa`: return a synthetic remote MCP server with:
  - name: stable built-in name such as `Exa`
  - slug: stable built-in slug such as `exa_builtin_search`
  - transport: `streamable_http`
  - url: `https://mcp.exa.ai/mcp`
  - headers:
    - empty by default
    - include `x-api-key` only when the user supplied an Exa key
- `tavily`: return a synthetic remote MCP server configured per Tavily's MCP documentation using the user-supplied API key

The runtime should append this synthetic server to the list returned from persisted `mcp_servers` before tool discovery. Only one built-in search connector may be appended at a time.

## MCP Settings Isolation

Built-in search connectors must never appear in:

- `listMcpServers()`
- the MCP Servers settings page
- MCP server CRUD routes

This is achieved by not persisting them in `mcp_servers` at all.

## Security

- Exa and Tavily API keys should be encrypted at rest using the same encryption utilities already used for provider API keys.
- Sanitized settings responses should expose only the fields needed by the General settings page and should not leak encrypted values.
- Tavily runtime injection must not proceed unless a non-empty Tavily key is available.

## Error Handling

- If Tavily is selected without an API key, the settings form should show a validation error and the API should reject the save request.
- If a built-in search server fails during tool discovery or tool execution, it should follow the existing MCP failure behavior already used for normal MCP servers.
- Exa with no key should not be treated as a configuration error.

## Testing

Add or update tests to cover:

- `user_settings` migration adds `web_search_engine`, `exa_api_key_encrypted`, and `tavily_api_key_encrypted`
- fresh user settings default to `webSearchEngine: 'exa'`
- settings persistence round-trips Exa optional key and Tavily required key correctly
- general settings API accepts Exa with an empty key
- general settings API rejects Tavily with an empty key
- General settings UI renders the new dropdown and conditional fields
- General settings UI shows the Exa optional info note
- General settings UI blocks save client-side for empty Tavily key
- runtime injection returns no server for `disabled`
- runtime injection returns Exa with no auth header when no key is set
- runtime injection returns Exa with `x-api-key` header when key is set
- runtime injection returns Tavily with the documented auth configuration
- persisted MCP server listings remain unchanged and do not include built-in search connectors

Most relevant coverage points:

- `tests/unit/settings.test.ts`
- `tests/unit/general-section.test.tsx`
- `tests/unit/db.test.ts`
- `tests/unit/assistant-runtime.test.ts` or a new focused runtime helper test

## Files Expected To Change

- `lib/types.ts`
- `lib/settings.ts`
- `lib/db.ts`
- `app/api/settings/general/route.ts`
- `components/settings/sections/general-section.tsx`
- `app/api/conversations/[conversationId]/chat/route.ts`
- a new runtime helper if extracted from the chat route
- related unit tests

## Implementation Notes

- Keep the dropdown labels exactly `Exa`, `Tavily`, and `Disabled`.
- Do not label Exa as `Exa (MCP)` in the UI.
- Do not persist synthetic search connectors into `mcp_servers` as part of save or migration flows.
- Prefer a small dedicated helper for built-in search MCP construction so the chat route stays readable and testable.
