# Vision MCP Support Design

## Overview

Add vision support for non-vision models via MCP servers. Provider profiles gain a `visionMode` setting (`none`, `native`, `mcp`) and optional `visionMcpServerId`. When images are attached and vision mode is "mcp", images are intercepted before the provider call and a system prompt directive instructs the agent to use the specified MCP server for image analysis.

## User Flow

1. User configures a provider profile
2. For models with native vision support, vision mode defaults to "native"
3. For models without native vision, user can set vision mode to "mcp"
4. User selects an enabled MCP server from their configured servers
5. When the user attaches an image in a conversation using this profile:
   - The image is NOT sent to the model directly
   - A system directive is injected telling the agent to use the MCP server for image analysis
   - The agent discovers and uses the appropriate vision tool from that MCP server

## Data Model Changes

### Type Definitions (`lib/types.ts`)

```typescript
// Add to ProviderProfile type
visionMode: "none" | "native" | "mcp";
visionMcpServerId: string | null;
```

### Database Schema

Add columns to `provider_profiles` table:
- `vision_mode` (TEXT, NOT NULL, DEFAULT "native")
- `vision_mcp_server_id` (TEXT, NULLABLE)

### Settings Validation

When `visionMode === "mcp"`:
- `visionMcpServerId` is required
- Must reference an existing enabled MCP server

## UI Changes

### Provider Settings Form (`components/settings/sections/providers-section.tsx`)

Add in Advanced Settings section:

1. **Vision Mode Dropdown**
   - Label: "Vision mode"
   - Options: `none`, `native`, `mcp`
   - Default: `"native"` if model supports images, otherwise `"none"`

2. **Vision MCP Server Dropdown** (conditional)
   - Shows when `visionMode === "mcp"`
   - Label: "Vision MCP server"
   - Populated from `listMcpServers()` filtered to enabled servers
   - Required when visible

## Runtime Logic

### Image Handling (`lib/assistant-runtime.ts`)

When building prompt messages for the provider, check `settings.visionMode`:

**If `"mcp"`:**
1. Extract all image content parts from user messages
2. Build attachment references list (attachment IDs and filenames)
3. Strip images from the prompt messages (model cannot process them)
4. Fetch MCP server name from `visionMcpServerId`
5. Inject system directive:
   ```
   This model cannot process images directly. When the user provides images, use the MCP server "{server_name}" (id: {server_id}) to analyze them.

   User attachments in this conversation:
   - {filename} (attachment ID: {id})
   ```

**If `"native"` or `"none"`:**
- Pass images through unchanged to the provider

### Default Vision Mode Helper (`lib/model-capabilities.ts`)

```typescript
export function getDefaultVisionMode(model: string, apiMode: ApiMode): "native" | "none" {
  return supportsImageInput(model, apiMode) ? "native" : "none";
}
```

## Migration

Add database migration for new columns:
```sql
ALTER TABLE provider_profiles ADD COLUMN vision_mode TEXT NOT NULL DEFAULT 'native';
ALTER TABLE provider_profiles ADD COLUMN vision_mcp_server_id TEXT;
```

## Files to Modify

1. `lib/types.ts` - Add vision fields to ProviderProfile type
2. `lib/settings.ts` - Update schema, validation, and database operations
3. `lib/model-capabilities.ts` - Add getDefaultVisionMode helper
4. `lib/assistant-runtime.ts` - Add image interception and system directive injection
5. `lib/constants.ts` - Add default values for new fields
6. `components/settings/sections/providers-section.tsx` - Add UI controls
7. Database migration file