# MCP Server Tool Naming

## Problem

MCP server tool names use the server's UUID-based ID, producing unreadable names like `mcp_mcp_05b95fb6_4b62_450b_b487_d14b6b4a4170_web_search`. The double `mcp_` prefix is redundant, and the UUID wastes tokens while providing no human-readable context.

## Solution

Replace UUID-based tool naming with slug-based naming derived from the server's display name. Tool names become `mcp_{slug}_{toolName}` (e.g., `mcp_exa_web_search`).

## Design

### 1. Slug Field

Add a `slug` field to `McpServer`, auto-generated from the display `name`:

- Lowercase
- Replace non-alphanumeric characters (except underscores) with underscores
- Collapse consecutive underscores into one
- Strip leading/trailing underscores

Example: `"My Exa Server"` → `"my_exa_server"`

The slug is auto-generated on creation and update. Uniqueness is enforced case-insensitively.

### 2. Tool Naming

Change `mcpToolFunctionName` from:
```
mcp_{sanitize(serverId)}_{toolName}
```
To:
```
mcp_{server.slug}_{toolName}
```

Since slugs are already sanitized, no additional sanitization is needed.

### 3. Tool Call Routing

Replace the current iteration-based routing (strip `mcp_`, iterate all servers matching on sanitized ID) with a direct lookup:

- Strip `mcp_` prefix from the function name
- Find the server whose slug matches the next segment (up to the next `_`)
- Extract the tool name after `{slug}_`

### 4. Uniqueness Enforcement

At the API level, when creating or updating a server:
1. Slugify the name
2. Check for collisions (case-insensitive)
3. Reject with a clear error if a collision exists: "An MCP server with a similar name already exists."

### 5. System Message

Simplify the capabilities system message from:
```
Configured MCP servers:
- exa (mcp_05b95fb6-...)
```
To:
```
Configured MCP servers:
- exa
```

### 6. DB Schema

Add `slug TEXT UNIQUE` column to the `mcp_servers` table. No migration needed — the project is in dev and databases can be recreated.

### 7. Scope

No migration path required. Existing MCP servers can be deleted and re-added. Old conversations referencing UUID-based tool names will still render correctly (message actions store `server_id` and `tool_name` separately in the DB, not the composed function name).