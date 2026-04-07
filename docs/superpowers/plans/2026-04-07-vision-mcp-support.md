# Vision MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vision support for non-vision models via MCP servers, allowing users to configure vision mode per provider profile.

**Architecture:** Add `visionMode` and `visionMcpServerId` fields to provider profiles. When vision mode is "mcp", images are intercepted before the provider call and a system directive instructs the agent to use the specified MCP server for image analysis.

**Tech Stack:** TypeScript, React, SQLite (better-sqlite3), Zod for validation

---

## Task 1: Add Type Definitions

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add VisionMode type and update ProviderProfile**

Add the `VisionMode` type and new fields to `ProviderProfile`:

```typescript
// Add after line 5 (after ReasoningEffort type)
export type VisionMode = "none" | "native" | "mcp";

// In ProviderProfile type (around line 29-52), add after mergedTargetTokens:
  visionMode: VisionMode;
  visionMcpServerId: string | null;
```

Also update `ProviderProfileWithApiKey` which extends `ProviderProfile` (it will inherit the new fields automatically).

- [ ] **Step 2: Commit types**

```bash
git add lib/types.ts
git commit -m "feat: add VisionMode type and provider profile fields"
```

---

## Task 2: Add Database Migration

**Files:**
- Modify: `lib/db.ts`

- [ ] **Step 1: Add vision_mode and vision_mcp_server_id columns**

In the `migrate()` function, after the existing profile column migrations (around line 355), add:

```typescript
  const visionProfileCols = {
    vision_mode: "TEXT NOT NULL DEFAULT 'native'",
    vision_mcp_server_id: "TEXT"
  };
  for (const [colName, colDef] of Object.entries(visionProfileCols)) {
    if (!profileColNames.includes(colName)) {
      db.exec(`ALTER TABLE provider_profiles ADD COLUMN ${colName} ${colDef}`);
    }
  }
```

- [ ] **Step 2: Commit migration**

```bash
git add lib/db.ts
git commit -m "feat: add database migration for vision profile fields"
```

---

## Task 3: Add Default Vision Mode Helper

**Files:**
- Modify: `lib/model-capabilities.ts`

- [ ] **Step 1: Add getDefaultVisionMode function**

Add after the existing `supportsImageInput` function:

```typescript
export function getDefaultVisionMode(model: string, apiMode: ApiMode): VisionMode {
  return supportsImageInput(model, apiMode) ? "native" : "none";
}
```

Also add the import for `VisionMode` type at the top of the file:

```typescript
import type { ApiMode, VisionMode } from "@/lib/types";
```

- [ ] **Step 2: Commit helper function**

```bash
git add lib/model-capabilities.ts
git commit -m "feat: add getDefaultVisionMode helper function"
```

---

## Task 4: Update Settings Schema and Validation

**Files:**
- Modify: `lib/settings.ts`

- [ ] **Step 1: Add vision fields to runtimeSettingsSchema**

Update `runtimeSettingsSchema` to include the new fields (around line 17-36):

```typescript
const runtimeSettingsSchema = z.object({
  apiBaseUrl: z.string().url(),
  apiKey: z.string().optional().default(""),
  model: z.string().min(1),
  apiMode: z.enum(["responses", "chat_completions"]),
  systemPrompt: z.string().min(1),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(128).max(32768),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
  reasoningSummaryEnabled: z.coerce.boolean(),
  modelContextLimit: z.coerce.number().int().min(4096).max(2_000_000),
  compactionThreshold: z.coerce.number().min(0.5).max(0.95),
  freshTailCount: z.coerce.number().int().min(8).max(128),
  tokenizerModel: z.enum(["gpt-tokenizer", "off"]).default("gpt-tokenizer"),
  safetyMarginTokens: z.coerce.number().int().min(128).max(32768).default(1200),
  leafSourceTokenLimit: z.coerce.number().int().min(1000).max(100000).default(12000),
  leafMinMessageCount: z.coerce.number().int().min(2).max(50).default(6),
  mergedMinNodeCount: z.coerce.number().int().min(2).max(20).default(4),
  mergedTargetTokens: z.coerce.number().int().min(128).max(16000).default(1600),
  visionMode: z.enum(["none", "native", "mcp"]).default("native"),
  visionMcpServerId: z.string().nullable().default(null)
});
```

- [ ] **Step 2: Add import for VisionMode type**

At the top of the file, update the import:

```typescript
import type {
  AppSettings,
  ProviderProfile,
  ProviderProfileWithApiKey,
  ReasoningEffort,
  VisionMode
} from "@/lib/types";
```

- [ ] **Step 3: Update ProviderProfileRow type**

Add the new columns to `ProviderProfileRow` type (around line 83-106):

```typescript
type ProviderProfileRow = {
  id: string;
  name: string;
  api_base_url: string;
  api_key_encrypted: string;
  model: string;
  api_mode: "responses" | "chat_completions";
  system_prompt: string;
  temperature: number;
  max_output_tokens: number;
  reasoning_effort: ReasoningEffort;
  reasoning_summary_enabled: number;
  model_context_limit: number;
  compaction_threshold: number;
  fresh_tail_count: number;
  tokenizer_model: string;
  safety_margin_tokens: number;
  leaf_source_token_limit: number;
  leaf_min_message_count: number;
  merged_min_node_count: number;
  merged_target_tokens: number;
  vision_mode: string;
  vision_mcp_server_id: string | null;
  created_at: string;
  updated_at: string;
};
```

- [ ] **Step 4: Update rowToProviderProfile function**

Add the new fields in `rowToProviderProfile` (around line 118-143):

```typescript
function rowToProviderProfile(row: ProviderProfileRow): ProviderProfile {
  return {
    id: row.id,
    name: row.name,
    apiBaseUrl: row.api_base_url,
    apiKeyEncrypted: row.api_key_encrypted,
    model: row.model,
    apiMode: row.api_mode,
    systemPrompt: row.system_prompt,
    temperature: row.temperature,
    maxOutputTokens: row.max_output_tokens,
    reasoningEffort: row.reasoning_effort,
    reasoningSummaryEnabled: Boolean(row.reasoning_summary_enabled),
    modelContextLimit: row.model_context_limit,
    compactionThreshold: row.compaction_threshold,
    freshTailCount: row.fresh_tail_count,
    tokenizerModel: row.tokenizer_model as "gpt-tokenizer" | "off",
    safetyMarginTokens: row.safety_margin_tokens,
    leafSourceTokenLimit: row.leaf_source_token_limit,
    leafMinMessageCount: row.leaf_min_message_count,
    mergedMinNodeCount: row.merged_min_node_count,
    mergedTargetTokens: row.merged_target_tokens,
    visionMode: row.vision_mode as VisionMode,
    visionMcpServerId: row.vision_mcp_server_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

- [ ] **Step 5: Update SQL queries in listProviderProfileRows**

Add the new columns to the SELECT statement in `listProviderProfileRows` (around line 145-175):

```typescript
function listProviderProfileRows() {
  return getDb()
    .prepare(
      `SELECT
        id,
        name,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        tokenizer_model,
        safety_margin_tokens,
        leaf_source_token_limit,
        leaf_min_message_count,
        merged_min_node_count,
        merged_target_tokens,
        vision_mode,
        vision_mcp_server_id,
        created_at,
        updated_at
      FROM provider_profiles
      ORDER BY created_at ASC`
    )
    .all() as ProviderProfileRow[];
}
```

- [ ] **Step 6: Update SQL queries in getProviderProfileRow**

Update `getProviderProfileRow` similarly (around line 177-207):

```typescript
function getProviderProfileRow(profileId: string) {
  return getDb()
    .prepare(
      `SELECT
        id,
        name,
        api_base_url,
        api_key_encrypted,
        model,
        api_mode,
        system_prompt,
        temperature,
        max_output_tokens,
        reasoning_effort,
        reasoning_summary_enabled,
        model_context_limit,
        compaction_threshold,
        fresh_tail_count,
        tokenizer_model,
        safety_margin_tokens,
        leaf_source_token_limit,
        leaf_min_message_count,
        merged_min_node_count,
        merged_target_tokens,
        vision_mode,
        vision_mcp_server_id,
        created_at,
        updated_at
      FROM provider_profiles
      WHERE id = ?`
    )
    .get(profileId) as ProviderProfileRow | undefined;
}
```

- [ ] **Step 7: Update upsertProfile in updateSettings**

Add the new columns to the INSERT statement (around line 298-368):

```typescript
const upsertProfile = getDb().prepare(
  `INSERT INTO provider_profiles (
    id,
    name,
    api_base_url,
    api_key_encrypted,
    model,
    api_mode,
    system_prompt,
    temperature,
    max_output_tokens,
    reasoning_effort,
    reasoning_summary_enabled,
    model_context_limit,
    compaction_threshold,
    fresh_tail_count,
    tokenizer_model,
    safety_margin_tokens,
    leaf_source_token_limit,
    leaf_min_message_count,
    merged_min_node_count,
    merged_target_tokens,
    vision_mode,
    vision_mcp_server_id,
    created_at,
    updated_at
  ) VALUES (
    @id,
    @name,
    @apiBaseUrl,
    @apiKeyEncrypted,
    @model,
    @apiMode,
    @systemPrompt,
    @temperature,
    @maxOutputTokens,
    @reasoningEffort,
    @reasoningSummaryEnabled,
    @modelContextLimit,
    @compactionThreshold,
    @freshTailCount,
    @tokenizerModel,
    @safetyMarginTokens,
    @leafSourceTokenLimit,
    @leafMinMessageCount,
    @mergedMinNodeCount,
    @mergedTargetTokens,
    @visionMode,
    @visionMcpServerId,
    @createdAt,
    @updatedAt
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    api_base_url = excluded.api_base_url,
    api_key_encrypted = excluded.api_key_encrypted,
    model = excluded.model,
    api_mode = excluded.api_mode,
    system_prompt = excluded.system_prompt,
    temperature = excluded.temperature,
    max_output_tokens = excluded.max_output_tokens,
    reasoning_effort = excluded.reasoning_effort,
    reasoning_summary_enabled = excluded.reasoning_summary_enabled,
    model_context_limit = excluded.model_context_limit,
    compaction_threshold = excluded.compaction_threshold,
    fresh_tail_count = excluded.fresh_tail_count,
    tokenizer_model = excluded.tokenizer_model,
    safety_margin_tokens = excluded.safety_margin_tokens,
    leaf_source_token_limit = excluded.leaf_source_token_limit,
    leaf_min_message_count = excluded.leaf_min_message_count,
    merged_min_node_count = excluded.merged_min_node_count,
    merged_target_tokens = excluded.merged_target_tokens,
    vision_mode = excluded.vision_mode,
    vision_mcp_server_id = excluded.vision_mcp_server_id,
    updated_at = excluded.updated_at`
);
```

- [ ] **Step 8: Update upsertProfile.run call**

Update the parameters in the `upsertProfile.run()` call (around line 370-398):

```typescript
upsertProfile.run({
  id: profile.id,
  name: profile.name,
  apiBaseUrl: profile.apiBaseUrl,
  apiKeyEncrypted: apiKey ? encryptValue(apiKey) : "",
  model: profile.model,
  apiMode: profile.apiMode,
  systemPrompt: profile.systemPrompt,
  temperature: profile.temperature,
  maxOutputTokens: profile.maxOutputTokens,
  reasoningEffort: profile.reasoningEffort,
  reasoningSummaryEnabled: profile.reasoningSummaryEnabled ? 1 : 0,
  modelContextLimit: profile.modelContextLimit,
  compactionThreshold: profile.compactionThreshold,
  freshTailCount: profile.freshTailCount,
  tokenizerModel: profile.tokenizerModel,
  safetyMarginTokens: profile.safetyMarginTokens,
  leafSourceTokenLimit: profile.leafSourceTokenLimit,
  leafMinMessageCount: profile.leafMinMessageCount,
  mergedMinNodeCount: profile.mergedMinNodeCount,
  mergedTargetTokens: profile.mergedTargetTokens,
  visionMode: profile.visionMode ?? "native",
  visionMcpServerId: profile.visionMcpServerId ?? null,
  createdAt: current?.createdAt ?? timestamp,
  updatedAt: timestamp
});
```

- [ ] **Step 9: Commit settings changes**

```bash
git add lib/settings.ts
git commit -m "feat: update settings schema for vision mode fields"
```

---

## Task 5: Update Constants

**Files:**
- Modify: `lib/constants.ts`

- [ ] **Step 1: Add vision defaults to DEFAULT_PROVIDER_SETTINGS**

Add the vision fields to `DEFAULT_PROVIDER_SETTINGS`:

```typescript
export const DEFAULT_PROVIDER_SETTINGS = {
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiMode: "responses",
  systemPrompt:
    "You are a precise, practical assistant. Answer clearly and directly.",
  temperature: 0.7,
  maxOutputTokens: 1200,
  reasoningEffort: "medium",
  reasoningSummaryEnabled: true,
  modelContextLimit: 128000,
  compactionThreshold: 0.78,
  freshTailCount: 28,
  tokenizerModel: "gpt-tokenizer" as const,
  safetyMarginTokens: 1200,
  leafSourceTokenLimit: 12000,
  leafMinMessageCount: 6,
  mergedMinNodeCount: 4,
  mergedTargetTokens: 1600,
  visionMode: "native" as const,
  visionMcpServerId: null
} as const;
```

- [ ] **Step 2: Commit constants**

```bash
git add lib/constants.ts
git commit -m "feat: add vision defaults to provider settings"
```

---

## Task 6: Add Vision System Directive to Assistant Runtime

**Files:**
- Modify: `lib/assistant-runtime.ts`

- [ ] **Step 1: Add function to build vision MCP directive**

Add this function after `buildCapabilitiesSystemMessage` (around line 216):

```typescript
function buildVisionMcpDirective(
  mcpServer: McpServer,
  attachments: Array<{ id: string; filename: string }>
): string {
  const attachmentList = attachments
    .map((a) => `- ${a.filename} (attachment ID: ${a.id})`)
    .join("\n");

  return [
    "This model cannot process images directly. When the user provides images, use the MCP server to analyze them.",
    "",
    `Vision MCP server: ${mcpServer.name} (id: ${mcpServer.id})`,
    "",
    "User attachments in this conversation:",
    attachmentList
  ].join("\n");
}
```

- [ ] **Step 2: Add function to extract image attachments from messages**

Add this function after `buildVisionMcpDirective`:

```typescript
function extractImageAttachments(promptMessages: PromptMessage[]): Array<{ id: string; filename: string }> {
  const attachments: Array<{ id: string; filename: string }> = [];

  for (const message of promptMessages) {
    if (typeof message.content === "string") continue;

    for (const part of message.content) {
      if (part.type === "image") {
        attachments.push({
          id: part.attachmentId,
          filename: part.filename
        });
      }
    }
  }

  return attachments;
}
```

- [ ] **Step 3: Add function to strip images from prompt messages**

Add this function after `extractImageAttachments`:

```typescript
function stripImagesFromMessages(promptMessages: PromptMessage[]): PromptMessage[] {
  return promptMessages.map((message) => {
    if (typeof message.content === "string") return message;

    const textParts = message.content.filter((part) => part.type === "text");

    if (textParts.length === 0) {
      return { ...message, content: "" };
    }

    if (textParts.length === message.content.length) {
      return message;
    }

    return { ...message, content: textParts };
  });
}
```

- [ ] **Step 4: Update resolveAssistantTurn to handle vision MCP mode**

Update the `resolveAssistantTurn` function signature to accept `visionMcpServer`:

```typescript
export async function resolveAssistantTurn(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers?: McpServer[];
  mcpToolSets: ToolSet[];
  visionMcpServer?: McpServer | null;
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
  onActionError?: (
    handle: string | undefined,
    patch: { detail?: string; resultSummary?: string }
  ) => Promise<void> | void;
}) {
```

- [ ] **Step 5: Apply vision MCP transformation at start of resolveAssistantTurn**

Add after the `mcpServers` line (around line 608-621):

```typescript
const mcpServers = input.mcpServers ?? input.mcpToolSets.map((e) => e.server);

// Handle vision MCP mode - strip images and inject directive
let promptMessages = input.promptMessages;
if (input.settings.visionMode === "mcp" && input.visionMcpServer) {
  const imageAttachments = extractImageAttachments(input.promptMessages);
  if (imageAttachments.length > 0) {
    promptMessages = stripImagesFromMessages(input.promptMessages);
    const visionDirective = buildVisionMcpDirective(input.visionMcpServer, imageAttachments);
    promptMessages = mergeSystemMessage(promptMessages, visionDirective);
  }
}

const turnSkills = filterSkillsForTurn(input.skills, promptMessages);
```

- [ ] **Step 6: Remove duplicate promptMessages declaration**

Find the line `let promptMessages = turnSkills.length || mcpServers.length || input.mcpToolSets.length` and remove it, since we now declare `promptMessages` above. The remaining code should use our `promptMessages` variable.

- [ ] **Step 7: Commit assistant-runtime changes**

```bash
git add lib/assistant-runtime.ts
git commit -m "feat: add vision MCP directive injection in assistant runtime"
```

---

## Task 7: Update Provider Settings UI

**Files:**
- Modify: `components/settings/sections/providers-section.tsx`

- [ ] **Step 1: Add imports for MCP servers and vision helper**

Add imports at the top:

```typescript
import { getDefaultVisionMode } from "@/lib/model-capabilities";
import { listMcpServers } from "@/lib/mcp-servers";
import type { McpServer } from "@/lib/types";
import type { VisionMode } from "@/lib/types";
```

- [ ] **Step 2: Add MCP servers state**

Add state inside `ProvidersSection` function (after existing useState hooks):

```typescript
const [mcpServers, setMcpServers] = useState<McpServer[]>([]);

// Fetch MCP servers on mount
useEffect(() => {
  listMcpServers().then(setMcpServers).catch(() => setMcpServers([]));
}, []);
```

- [ ] **Step 3: Update ProviderProfileDraft type**

Update the `ProviderProfileDraft` type to include vision fields:

```typescript
type ProviderProfileDraft = SettingsPayload["providerProfiles"][number] & {
  apiKey: string;
  visionMode: VisionMode;
  visionMcpServerId: string | null;
};
```

- [ ] **Step 4: Update SettingsPayload type**

Add vision fields to `SettingsPayload`:

```typescript
type SettingsPayload = {
  defaultProviderProfileId: string;
  skillsEnabled: boolean;
  providerProfiles: Array<{
    id: string;
    name: string;
    apiBaseUrl: string;
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
    createdAt: string;
    updatedAt: string;
    hasApiKey: boolean;
  }>;
  updatedAt: string;
};
```

- [ ] **Step 5: Add vision fields to initial profile state**

In `addProviderProfile` function, update the template:

```typescript
const nextProfile: ProviderProfileDraft = {
  ...(template ?? {
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    apiMode: "responses" as ApiMode,
    systemPrompt: "You are a precise, practical assistant. Answer clearly and directly.",
    temperature: 0.7,
    maxOutputTokens: 1200,
    reasoningEffort: "medium" as ReasoningEffort,
    reasoningSummaryEnabled: true,
    modelContextLimit: 128000,
    compactionThreshold: 0.78,
    freshTailCount: 28,
    tokenizerModel: "gpt-tokenizer" as const,
    safetyMarginTokens: 1200,
    leafSourceTokenLimit: 12000,
    leafMinMessageCount: 6,
    mergedMinNodeCount: 4,
    mergedTargetTokens: 1600,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    hasApiKey: false,
    apiKey: "",
    visionMode: "native" as VisionMode,
    visionMcpServerId: null
  }),
  // ... rest remains same
};
```

- [ ] **Step 6: Add vision fields to form submit payload**

Update the payload in `handleSettings`:

```typescript
const payload = {
  defaultProviderProfileId,
  skillsEnabled,
  providerProfiles: providerProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    apiBaseUrl: profile.apiBaseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    apiMode: profile.apiMode,
    systemPrompt: profile.systemPrompt,
    temperature: profile.temperature,
    maxOutputTokens: profile.maxOutputTokens,
    reasoningEffort: profile.reasoningEffort,
    reasoningSummaryEnabled: profile.reasoningSummaryEnabled,
    modelContextLimit: profile.modelContextLimit,
    compactionThreshold: profile.compactionThreshold,
    freshTailCount: profile.freshTailCount,
    tokenizerModel: profile.tokenizerModel,
    safetyMarginTokens: profile.safetyMarginTokens,
    leafSourceTokenLimit: profile.leafSourceTokenLimit,
    leafMinMessageCount: profile.leafMinMessageCount,
    mergedMinNodeCount: profile.mergedMinNodeCount,
    mergedTargetTokens: profile.mergedTargetTokens,
    visionMode: profile.visionMode ?? "native",
    visionMcpServerId: profile.visionMcpServerId ?? null
  }))
};
```

- [ ] **Step 7: Add Vision Mode dropdown UI**

Add in the Advanced Settings section (after the "API mode" dropdown, around line 519):

```tsx
<div>
  <label className={labelClass}>Vision mode</label>
  <select
    value={activeProviderProfile.visionMode ?? "native"}
    onChange={(event) =>
      updateActiveProviderProfile({ visionMode: event.target.value as VisionMode })
    }
    className={selectClass}
  >
    <option value="native">native</option>
    <option value="none">none</option>
    <option value="mcp">mcp</option>
  </select>
</div>
```

- [ ] **Step 8: Add Vision MCP Server dropdown UI (conditional)**

Add after the Vision Mode dropdown:

```tsx
{activeProviderProfile.visionMode === "mcp" && (
  <div>
    <label className={labelClass}>Vision MCP server</label>
    <select
      value={activeProviderProfile.visionMcpServerId ?? ""}
      onChange={(event) =>
        updateActiveProviderProfile({ visionMcpServerId: event.target.value || null })
      }
      className={selectClass}
    >
      <option value="">Select a server...</option>
      {mcpServers
        .filter((server) => server.enabled)
        .map((server) => (
          <option key={server.id} value={server.id}>
            {server.name}
          </option>
        ))}
    </select>
    {activeProviderProfile.visionMcpServerId === null && (
      <p className="mt-1 text-xs text-amber-400">
        Select an MCP server for image analysis
      </p>
    )}
  </div>
)}
```

- [ ] **Step 9: Commit UI changes**

```bash
git add components/settings/sections/providers-section.tsx
git commit -m "feat: add vision mode and MCP server UI to provider settings"
```

---

## Task 8: Integrate Vision MCP in Chat Flow

**Files:**
- Modify: `lib/chat-turn.ts`

- [ ] **Step 1: Add getMcpServer import**

Add `getMcpServer` to the imports from `@/lib/mcp-servers`:

```typescript
import { listEnabledMcpServers, getMcpServer } from "@/lib/mcp-servers";
```

- [ ] **Step 2: Resolve vision MCP server before calling resolveAssistantTurn**

Add after the `mcpToolSets` assignment (around line 120), before the variable declarations:

```typescript
    // Resolve vision MCP server if configured
    let visionMcpServer: (typeof mcpServers)[number] | null = null;
    if (settings.visionMode === "mcp" && settings.visionMcpServerId) {
      const server = getMcpServer(settings.visionMcpServerId);
      if (server && server.enabled) {
        visionMcpServer = server;
      }
    }
```

- [ ] **Step 3: Pass visionMcpServer to resolveAssistantTurn**

Update the `resolveAssistantTurn` call to include `visionMcpServer`:

```typescript
    const providerResult = await resolveAssistantTurn({
      settings,
      promptMessages,
      skills,
      mcpServers,
      mcpToolSets,
      visionMcpServer,
      onEvent(event: ChatStreamEvent) {
```

- [ ] **Step 4: Commit chat-turn changes**

```bash
git add lib/chat-turn.ts
git commit -m "feat: pass vision MCP server to assistant runtime"
```

---

## Task 9: Update Default Profile Helper

**Files:**
- Modify: `lib/settings.ts`

- [ ] **Step 1: Update getSettingsDefaults function**

Update `getSettingsDefaults` to include vision fields:

```typescript
export function getSettingsDefaults() {
  return {
    name: DEFAULT_PROVIDER_PROFILE_NAME,
    visionMode: "native" as const,
    visionMcpServerId: null,
    ...DEFAULT_PROVIDER_SETTINGS
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/settings.ts
git commit -m "fix: include vision defaults in settings defaults"
```

---

## Task 10: Test and Verify

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: No TypeScript errors

- [ ] **Step 2: Run existing tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 3: Start dev server and test UI**

```bash
npm run dev
```

Then use `agent-browser` skill to:
1. Navigate to Settings > Providers
2. Create a new provider profile
3. Verify Vision Mode dropdown shows: native, none, mcp
4. Select "mcp" and verify Vision MCP Server dropdown appears
5. Verify the server list populates from enabled MCP servers

- [ ] **Step 4: Commit final changes**

```bash
git add -A
git commit -m "feat: complete vision MCP support implementation"
```

---

## Files Modified Summary

1. `lib/types.ts` - Added VisionMode type and fields to ProviderProfile
2. `lib/db.ts` - Added database migration for new columns
3. `lib/model-capabilities.ts` - Added getDefaultVisionMode helper
4. `lib/settings.ts` - Updated schema, validation, and database operations
5. `lib/constants.ts` - Added vision defaults
6. `lib/assistant-runtime.ts` - Added vision MCP directive injection
7. `components/settings/sections/providers-section.tsx` - Added UI controls
8. `lib/chat-turn.ts` - Pass visionMcpServer to runtime (pending review)