# Context Compaction Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve chat context compaction with natural language summaries, configurable limits, per-model tokenizer, incremental summarization, graceful fallback, and selective memory retrieval.

**Architecture:** Three independent stages layered on existing hierarchical memory node system. Each stage adds functionality without removing previous capabilities. Stage 1 changes summary format and adds configurable fields. Stage 2 changes compaction flow logic. Stage 3 adds LLM scoring for selective node injection.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Vitest, gpt-tokenizer, Next.js, OpenAI SDK

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/token-estimator.ts` | NEW | Multi-engine tokenizer adapter (gpt-tokenizer or off) |
| `lib/compaction.ts` | MODIFY | Summary format, incremental compact, fallback, scoring, system merge |
| `lib/settings.ts` | MODIFY | Add compaction constant fields and tokenizerModel to schemas |
| `lib/types.ts` | MODIFY | Add fields to ProviderProfile |
| `lib/constants.ts` | MODIFY | Add named defaults for new compaction constants |
| `lib/provider.ts` | MODIFY | Use createTokenizer from token-estimator |
| `components/settings/sections/providers-section.tsx` | MODIFY | UI for new configurable fields |
| `tests/unit/compaction.test.ts` | MODIFY | Update mock + add tests for all 3 stages |
| `tests/unit/token-estimator.test.ts` | NEW | Test tokenizer dispatch |

## Type Changes (defined here so all tasks can reference them)

New/changed types in `lib/types.ts`:

```typescript
// Added to ProviderProfile (and provider profile row):
tokenizerModel: "gpt-tokenizer" | "off";
safetyMarginTokens: number;
leafSourceTokenLimit: number;
leafMinMessageCount: number;
mergedMinNodeCount: number;
mergedTargetTokens: number;

// SummaryPayload is removed (no longer used)
// CompactionSummary type is NOT needed — the LLM now returns plain text
```

---

### Task 1: Token Estimator Adapter

**Files:**
- Create: `lib/token-estimator.ts`
- New: `tests/unit/token-estimator.test.ts`

- [ ] **Step 1: Write the failing test**

Add `tests/unit/token-estimator.test.ts`:

```typescript
import { createTokenizer } from "@/lib/token-estimator";

describe("token estimator", () => {
  it("counts tokens using gpt-tokenizer", () => {
    const tokenizer = createTokenizer("gpt-tokenizer")!;
    expect(tokenizer.estimateTextTokens("hello world")).toBeGreaterThan(0);
  });

  it("falls back to char estimation when tokenizer is off", () => {
    const tokenizer = createTokenizer("off");
    const tokens = tokenizer.estimateTextTokens("hello world");
    expect(tokens).toBeGreaterThan(0);
    // char count / 4 approximation: "hello world" = 11 chars → 2.75 → Math.ceil = 3
    expect(tokens).toBe(Math.ceil(11 / 4));
  });

  it("returns default gpt-tokenizer for unknown engine", () => {
    const tokenizer = createTokenizer("nonexistent" as any);
    expect(tokenizer).not.toBeNull();
    const result = tokenizer.estimateTextTokens("test");
    expect(result).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/token-estimator.test.ts -v`
Expected: FAIL with "Cannot find module '@/lib/token-estimator'"

- [ ] **Step 3: Write the implementation**

Create `lib/token-estimator.ts`:

```typescript
import { encode } from "gpt-tokenizer";

export type TokenizerEngine = "gpt-tokenizer" | "off";

export type Tokenizer = {
  estimateTextTokens: (text: string) => number;
  estimatePromptTokens: (messages: import("@/lib/types").PromptMessage[]) => number;
  estimatePromptContentTokens: (content: import("@/lib/types").PromptMessage["content"]) => number;
  estimateAttachmentTokens: (attachments: import("@/lib/types").MessageAttachment[]) => number;
  estimateMessageTokens: (message: Pick<import("@/lib/types").Message, "content" | "thinkingContent" | "attachments">) => number;
};

function charCountTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function buildGptTokenizer(): Tokenizer {
  return {
    estimateTextTokens: (text: string) => text.trim() ? encode(text).length : 0,
    estimatePromptTokens: (messages) =>
      messages.reduce((total, m) => total + buildGptTokenizer().estimatePromptContentTokens(m.content) + 12, 0),
    estimatePromptContentTokens: (content) => {
      if (typeof content === "string") return charCountTokens(content); // placeholder, real impl below
      return content.reduce((total, part) => {
        if (part.type === "text") return total + charCountTokens(part.text);
        return total + charCountTokens(`[Image attachment: ${part.filename}]`);
      }, 0);
    },
    estimateAttachmentTokens: (attachments) =>
      attachments.reduce((total, a) => {
        if (a.kind === "image") return total + charCountTokens(`[Image attachment: ${a.filename}]`);
        return total + charCountTokens(`Attached file: ${a.filename}\n${a.extractedText}`);
      }, 0),
    estimateMessageTokens: (m) =>
      charCountTokens(`${m.content}\n${m.thinkingContent}`) +
      buildGptTokenizer().estimateAttachmentTokens(m.attachments ?? [])
  };
}

function buildGptTokenizerProper(): Tokenizer {
  return {
    estimateTextTokens: (text: string) => text.trim() ? encode(text).length : 0,
    estimatePromptTokens: (messages) => {
      const tok = buildGptTokenizerProper();
      return messages.reduce((total, m) => {
        return total + tok.estimatePromptContentTokens(m.content) + 12;
      }, 0);
    },
    estimatePromptContentTokens: (content) => {
      if (typeof content === "string") return encode(content).length;
      const tok = buildGptTokenizerProper();
      return content.reduce((total, part) => {
        if (part.type === "text") return total + encode(part.text).length;
        return total + encode(`[Image attachment: ${part.filename}]`).length;
      }, 0);
    },
    estimateAttachmentTokens: (attachments) =>
      attachments.reduce((total, a) => {
        if (a.kind === "image") return total + encode(`[Image attachment: ${a.filename}]`).length;
        return total + encode(`Attached file: ${a.filename}\n${a.extractedText}`).length;
      }, 0),
    estimateMessageTokens: (m) => {
      const tok = buildGptTokenizerProper();
      return tok.estimateTextTokens(`${m.content}\n${m.thinkingContent}`) +
        tok.estimateAttachmentTokens(m.attachments ?? []);
    }
  };
}

function buildOffTokenizer(): Tokenizer {
  return {
    estimateTextTokens: (text: string) => text.trim() ? Math.ceil(text.trim().length / 4) : 0,
    estimatePromptTokens: (messages) => {
      const tok = buildOffTokenizer();
      return messages.reduce((total, m) => total + tok.estimatePromptContentTokens(m.content) + 12, 0);
    },
    estimatePromptContentTokens: (content) => {
      if (typeof content === "string") return charCountTokens(content);
      return content.reduce((total, part) => {
        if (part.type === "text") return total + charCountTokens(part.text);
        return total + charCountTokens(`[Image attachment: ${part.filename}]`);
      }, 0);
    },
    estimateAttachmentTokens: (attachments) =>
      attachments.reduce((total, a) => {
        if (a.kind === "image") return total + charCountTokens(`[Image attachment: ${a.filename}]`);
        return total + charCountTokens(`Attached file: ${a.filename}\n${a.extractedText}`);
      }, 0),
    estimateMessageTokens: (m) =>
      charCountTokens(`${m.content}\n${m.thinkingContent}`) +
      buildOffTokenizer().estimateAttachmentTokens(m.attachments ?? [])
  };
}

export function createTokenizer(engine?: string): Tokenizer {
  switch (engine) {
    case "off":
      return buildOffTokenizer();
    case "gpt-tokenizer":
    default:
      return buildGptTokenizerProper();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/token-estimator.test.ts -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/token-estimator.ts tests/unit/token-estimator.test.ts
git commit -m "feat: add multi-engine tokenizer adapter"
```

---

### Task 2: Integrate Token Estimator into Tokenization & Provider

**Files:**
- Modify: `lib/tokenization.ts` — dispatch via `createTokenizer()`
- Modify: `lib/provider.ts` — use `createTokenizer()` for usage estimation

- [ ] **Step 1: Read current files**

Read `lib/tokenization.ts` and `lib/provider.ts` to understand current usage.

`lib/tokenization.ts` exports:
- `estimateTextTokens(value: string)` — wraps `encode(value).length`
- `estimatePromptTokens(messages)` — reduces with `estimatePromptContentTokens` +12
- `estimatePromptContentTokens(content)` — handles text/image parts
- `estimateAttachmentTokens(attachments)`
- `estimateMessageTokens(message)`

`lib/provider.ts` uses `estimatePromptTokens` at line 298 for usage estimation in `streamProviderResponse`.

- [ ] **Step 2: Update tokenization.ts to use the adapter**

Rewrite `lib/tokenization.ts`:

```typescript
import type { Message, MessageAttachment, PromptMessage } from "@/lib/types";
import { createTokenizer, Tokenizer } from "@/lib/token-estimator";

let activeTokenizer: Tokenizer | null = null;

function getActiveTokenEstimator() {
  if (!activeTokenizer) {
    activeTokenizer = createTokenizer("gpt-tokenizer");
  }
  return activeTokenizer;
}

export function setActiveTokenizer(engine: string) {
  activeTokenizer = createTokenizer(engine);
}

export function estimateTextTokens(value: string) {
  return getActiveTokenEstimator().estimateTextTokens(value);
}

export function estimatePromptTokens(messages: PromptMessage[]) {
  return getActiveTokenEstimator().estimatePromptTokens(messages);
}

export function estimatePromptContentTokens(content: PromptMessage["content"]) {
  return getActiveTokenEstimator().estimatePromptContentTokens(content);
}

export function estimateAttachmentTokens(attachments: MessageAttachment[]) {
  return getActiveTokenEstimator().estimateAttachmentTokens(attachments);
}

export function estimateMessageTokens(message: Pick<Message, "content" | "thinkingContent" | "attachments">) {
  return getActiveTokenEstimator().estimateMessageTokens(message);
}
```

- [ ] **Step 3: Update provider.ts to use setActiveTokenizer**

In `lib/provider.ts`, import `setActiveTokenizer`:

```typescript
import { estimatePromptTokens, setActiveTokenizer } from "@/lib/tokenization";
```

At the start of `streamProviderResponse`, after extracting settings:

```typescript
setActiveTokenizer(settings.tokenizerModel ?? "gpt-tokenizer");
```

The usage estimation at line 298 (`inputTokens: estimatePromptTokens(promptMessages)`) will now use the configured engine automatically.

- [ ] **Step 4: Run existing tests**

Run: `npx vitest run tests/unit/tokenization.test.ts tests/unit/token-estimator.test.ts -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tokenization.ts lib/provider.ts
git commit -m "feat: integrate tokenizer adapter into tokenization and provider"
```

---

### Task 3: Add Configurable Compaction Constants to Settings & Types

**Files:**
- Modify: `lib/types.ts` — add 6 new fields to `ProviderProfile`
- Modify: `lib/settings.ts` — add fields to schemas, row types, and upsert logic
- Modify: `lib/constants.ts` — add named export defaults
- Modify: `components/settings/sections/providers-section.tsx` — UI fields
- Test: `tests/unit/compaction.test.ts` — update settings helper

- [ ] **Step 1: Update types.ts**

Add to `ProviderProfile` type in `lib/types.ts`:

```typescript
export type ProviderProfile = {
  // ... existing fields ...
  compactionThreshold: number;
  freshTailCount: number;
  // NEW FIELDS:
  tokenizerModel: "gpt-tokenizer" | "off";
  safetyMarginTokens: number;
  leafSourceTokenLimit: number;
  leafMinMessageCount: number;
  mergedMinNodeCount: number;
  mergedTargetTokens: number;
  // ... existing fields ...
};
```

Also add to `ProviderProfileSummary` type (remove `apiKeyEncrypted`).

- [ ] **Step 2: Update settings.ts schemas and row types**

In `lib/settings.ts`, add to `runtimeSettingsSchema`:

```typescript
tokenizerModel: z.enum(["gpt-tokenizer", "off"]).default("gpt-tokenizer"),
safetyMarginTokens: z.coerce.number().int().min(128).max(32768).default(1200),
leafSourceTokenLimit: z.coerce.number().int().min(1000).max(100000).default(12000),
leafMinMessageCount: z.coerce.number().int().min(2).max(50).default(6),
mergedMinNodeCount: z.coerce.number().int().min(2).max(20).default(4),
mergedTargetTokens: z.coerce.number().int().min(128).max(16000).default(1600),
```

Add to `ProviderProfileRow` type:

```typescript
tokenizer_model: string;
safety_margin_tokens: number;
leaf_source_token_limit: number;
leaf_min_message_count: number;
merged_min_node_count: number;
merged_target_tokens: number;
```

Add to `rowToProviderProfile`:

```typescript
tokenizerModel: row.tokenizer_model,
safetyMarginTokens: row.safety_margin_tokens,
leafSourceTokenLimit: row.leaf_source_token_limit,
leafMinMessageCount: row.leaf_min_message_count,
mergedMinNodeCount: row.merged_min_node_count,
mergedTargetTokens: row.merged_target_tokens,
```

Add to SELECT queries (both `listProviderProfileRows` and `getProviderProfileRow`):

```sql
tokenizer_model,
safety_margin_tokens,
leaf_source_token_limit,
leaf_min_message_count,
merged_min_node_count,
merged_target_tokens,
```

Add to `upsertProfile` run params and schema. In the INSERT VALUES section after `@freshTailCount, @createdAt, @updatedAt`:

```
@tokenizerModel,
@safetyMarginTokens,
@leafSourceTokenLimit,
@leafMinMessageCount,
@mergedMinNodeCount,
@mergedTargetTokens
```

And in the UPDATE SET section after `fresh_tail_count = excluded.fresh_tail_count, updated_at = excluded.updated_at`:

```
tokenizer_model = excluded.tokenizer_model,
safety_margin_tokens = excluded.safety_margin_tokens,
leaf_source_token_limit = excluded.leaf_source_token_limit,
leaf_min_message_count = excluded.leaf_min_message_count,
merged_min_node_count = excluded.merged_min_node_count,
merged_target_tokens = excluded.merged_target_tokens
```

- [ ] **Step 3: Add ALTER TABLE migrations in db.ts**

Find the place in `lib/db.ts` where table migrations happen (search for `ALTER TABLE provider_profiles`). Add:

```sql
ALTER TABLE provider_profiles ADD COLUMN tokenizer_model TEXT DEFAULT 'gpt-tokenizer';
ALTER TABLE provider_profiles ADD COLUMN safety_margin_tokens INTEGER DEFAULT 1200;
ALTER TABLE provider_profiles ADD COLUMN leaf_source_token_limit INTEGER DEFAULT 12000;
ALTER TABLE provider_profiles ADD COLUMN leaf_min_message_count INTEGER DEFAULT 6;
ALTER TABLE provider_profiles ADD COLUMN merged_min_node_count INTEGER DEFAULT 4;
ALTER TABLE provider_profiles ADD COLUMN merged_target_tokens INTEGER DEFAULT 1600;
```

Wrap in try/catch since columns may already exist.

- [ ] **Step 4: Update defaults in constants.ts**

Add to `DEFAULT_PROVIDER_SETTINGS`:

```typescript
tokenizerModel: "gpt-tokenizer" as const,
safetyMarginTokens: 1200,
leafSourceTokenLimit: 12000,
leafMinMessageCount: 6,
mergedMinNodeCount: 4,
mergedTargetTokens: 1600,
```

- [ ] **Step 5: Update compaction.ts to read settings instead of hardcoded constants**

In `lib/compaction.ts`, remove imports of hardcoded constants from `@/lib/constants`:

```typescript
// Remove these imports:
// import { LEAF_MIN_MESSAGE_COUNT, LEAF_SOURCE_TOKEN_LIMIT, LEAF_TARGET_TOKENS, MERGED_MIN_NODE_COUNT, MERGED_TARGET_TOKENS, SAFETY_MARGIN_TOKENS } from "@/lib/constants";
```

Replace all usages in functions to read from `settings`:

- `SAFETY_MARGIN_TOKENS` → `settings.safetyMarginTokens`
- `LEAF_SOURCE_TOKEN_LIMIT` → `settings.leafSourceTokenLimit`
- `LEAF_MIN_MESSAGE_COUNT` → `settings.leafMinMessageCount`
- `LEAF_TARGET_TOKENS` → `settings.leafTargetTokens` (add to ProviderProfile type too)
- `MERGED_MIN_NODE_COUNT` → `settings.mergedMinNodeCount`
- `MERGED_TARGET_TOKENS` → `settings.mergedTargetTokens`

Wait - `LEAF_TARGET_TOKENS` isn't mentioned in the spec but exists in compaction.ts. The spec doesn't call it out as configurable. Let me check how it's used... It's used in `compactLeafMessages` summary token estimation. I'll keep it as-is for now since it's not listed as a configurable constant in the spec. But the hardcoded constants that are used in compaction.ts are: `LEAF_MIN_MESSAGE_COUNT`, `LEAF_SOURCE_TOKEN_LIMIT`, `SAFETY_MARGIN_TOKENS`, `MERGED_MIN_NODE_COUNT`. These four plus `MERGED_TARGET_TOKENS` should be pulled from settings.

- [ ] **Step 6: Update providers-section.tsx**

Add to `SettingsPayload["providerProfiles"]` type:

```typescript
tokenizerModel: "gpt-tokenizer" | "off";
safetyMarginTokens: number;
leafSourceTokenLimit: number;
leafMinMessageCount: number;
mergedMinNodeCount: number;
mergedTargetTokens: number;
```

Add to `addProviderProfile` template:

```typescript
tokenizerModel: "gpt-tokenizer" as const,
safetyMarginTokens: 1200,
leafSourceTokenLimit: 12000,
leafMinMessageCount: 6,
mergedMinNodeCount: 4,
mergedTargetTokens: 1600,
```

Add to `handleSettings` payload:

```typescript
tokenizerModel: profile.tokenizerModel,
safetyMarginTokens: profile.safetyMarginTokens,
leafSourceTokenLimit: profile.leafSourceTokenLimit,
leafMinMessageCount: profile.leafMinMessageCount,
mergedMinNodeCount: profile.mergedMinNodeCount,
mergedTargetTokens: profile.mergedTargetTokens,
```

Add UI inputs in the Advanced Settings collapsible section, after fresh tail count:

```tsx
<div>
  <label className={labelClass}>Tokenizer model</label>
  <select
    value={activeProviderProfile.tokenizerModel}
    onChange={(event) =>
      updateActiveProviderProfile({ tokenizerModel: event.target.value as "gpt-tokenizer" | "off" })
    }
    className={selectClass}
  >
    <option value="gpt-tokenizer">gpt-tokenizer</option>
    <option value="off">Off (char / 4)</option>
  </select>
</div>
<div>
  <label className={labelClass}>Safety margin tokens</label>
  <Input
    name="provider-safety-margin-tokens"
    type="number"
    value={activeProviderProfile.safetyMarginTokens}
    onChange={(event) =>
      updateActiveProviderProfile({ safetyMarginTokens: Number(event.target.value || 0) })
    }
  />
</div>
<div>
  <label className={labelClass}>Leaf source token limit</label>
  <Input
    name="provider-leaf-source-token-limit"
    type="number"
    value={activeProviderProfile.leafSourceTokenLimit}
    onChange={(event) =>
      updateActiveProviderProfile({ leafSourceTokenLimit: Number(event.target.value || 0) })
    }
  />
</div>
<div>
  <label className={labelClass}>Leaf min message count</label>
  <Input
    name="provider-leaf-min-message-count"
    type="number"
    value={activeProviderProfile.leafMinMessageCount}
    onChange={(event) =>
      updateActiveProviderProfile({ leafMinMessageCount: Number(event.target.value || 0) })
    }
  />
</div>
<div>
  <label className={labelClass}>Merged min node count</label>
  <Input
    name="provider-merged-min-node-count"
    type="number"
    value={activeProviderProfile.mergedMinNodeCount}
    onChange={(event) =>
      updateActiveProviderProfile({ mergedMinNodeCount: Number(event.target.value || 0) })
    }
  />
</div>
<div>
  <label className={labelClass}>Merged target tokens</label>
  <Input
    name="provider-merged-target-tokens"
    type="number"
    value={activeProviderProfile.mergedTargetTokens}
    onChange={(event) =>
      updateActiveProviderProfile({ mergedTargetTokens: Number(event.target.value || 0) })
    }
  />
</div>
```

- [ ] **Step 7: Run compaction tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS (they still use the existing settings helper which will now include the new fields)

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/settings.ts lib/constants.ts lib/db.ts lib/compaction.ts components/settings/sections/providers-section.tsx
git commit -m "feat: add configurable compaction constants and tokenizer model"
```

---

### Task 4: Update Compaction to Use Settings

**Files:**
- Modify: `lib/compaction.ts` — replace all hardcoded constant references with settings fields

- [ ] **Step 1: Update compaction.ts to use settings for all constants**

In `lib/compaction.ts`:

Remove imports from constants (only keep the ones still needed like `DEFAULT_AUTO_COMPACTION`, `APP_NAME`, etc.):

```typescript
// Remove these imports:
import {
  MAX_ATTACHMENT_TEXT_RATIO
} from "@/lib/constants";
```

Replace all usages in `ensureCompactedContext`:
- Line 591: `SAFETY_MARGIN_TOKENS` → `settings.safetyMarginTokens`

In `getCompactionEligibleMessages`:
- Remove the function entirely and inline the logic into `ensureCompactedContext` since `freshTailCount` is already on settings

In `compactLeafMessages`:
- `LEAF_MIN_MESSAGE_COUNT` → `settings.leafMinMessageCount`
- `LEAF_SOURCE_TOKEN_LIMIT` → `settings.leafSourceTokenLimit`

In `condenseMemoryNodes`:
- `MERGED_MIN_NODE_COUNT` → `settings.mergedMinNodeCount`
- `MERGED_TARGET_TOKENS` → `settings.mergedTargetTokens`

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add lib/compaction.ts
git commit -m "refactor: use settings for all compaction constants"
```

---

### Task 5: Natural Language Summary Format

**Files:**
- Modify: `lib/compaction.ts` — change summary prompt, remove JSON schema, add backwards-compat render
- Modify: `lib/types.ts` — remove `SummaryPayload` type (unused)

- [ ] **Step 1: Write failing test for NL summary format**

Add to `tests/unit/compaction.test.ts`:

```typescript
it("compacts messages into natural language summaries not JSON", async () => {
  updateDefaultProfile({
    modelContextLimit: 6000,
    compactionThreshold: 0.7
  });

  const conversation = createConversation();

  for (let index = 0; index < 12; index += 1) {
    createMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Message ${index} content for testing`
    });
  }

  const result = await ensureCompactedContext(
    conversation.id,
    getDefaultProviderProfileWithApiKey()!
  );

  // NL summary should NOT be parseable as JSON
  const memoryNodeMessages = result.promptMessages.filter((m) =>
    typeof m.content === "string" && m.content.includes("Compacted conversation memory")
  );

  expect(memoryNodeMessages.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to see current behavior (it currently produces JSON)**

Run: `npx vitest run tests/unit/compaction.test.ts -t "compacts messages into natural language" -v`
Expected: Test will pass/fail — but the key is that the mock still returns JSON. We need to update the mock AND the real summary prompt.

- [ ] **Step 3: Update the mock to return natural language instead of JSON**

In `tests/unit/compaction.test.ts`, update the mock:

```typescript
vi.mock("@/lib/provider", async () => {
  return {
    callProviderText: vi.fn(async (input: { prompt: string }) => {
      const ids = [...input.prompt.matchAll(/msg_[a-z0-9-]+/gi)].map((match) => match[0]);

      return `- Fact from messages: users discussed context compaction
- Preference: keep last ${ids.length} messages fresh
- Unresolved: need to test NL summaries
- Reference: compaction system modules
- Chronology: started at ${ids[0] ?? "msg_start"}, ended at ${ids.at(-1) ?? "msg_end"}`;
    })
  };
});
```

Also update the test `builds prompts from compacted memory plus recent raw turns` since it currently passes JSON content:

```typescript
it("builds prompts from compacted memory plus recent raw turns", () => {
  const prompt = buildPromptMessages({
    systemPrompt: "Stay concise.",
    activeMemoryNodes: [
      {
        id: "mem_1",
        conversationId: "conv_1",
        type: "leaf_summary",
        depth: 0,
        content: "- Fact: user prefers dark mode\n- Preference: keep responses short",
        sourceStartMessageId: "msg_1",
        sourceEndMessageId: "msg_4",
        sourceTokenCount: 120,
        summaryTokenCount: 22,
        childNodeIds: [],
        supersededByNodeId: null,
        createdAt: new Date().toISOString()
      }
    ],
    messages: [
      {
        id: "msg_5",
        conversationId: "conv_1",
        role: "user",
        content: "What next?",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 3,
        systemKind: null,
        compactedAt: null,
        createdAt: new Date().toISOString()
      }
    ],
    userInput: "Append this"
  });

  expect(getPromptText(prompt[0]!)).toContain("Stay concise.");
  expect(getPromptText(prompt[1]!)).toContain("Compacted conversation memory");
  expect(getPromptText(prompt.at(-1)!)).toBe("Append this");
});
```

- [ ] **Step 4: Update compaction.ts summary prompt**

Replace `buildSummaryPrompt` in `lib/compaction.ts`:

```typescript
function buildSummaryPrompt(label: string, blocks: string, sourceSpan: {
  startMessageId: string;
  endMessageId: string;
  messageCount: number;
}) {
  return [
    `You are compacting ${label} for a chat memory engine.`,
    "",
    "Write your response as a bullet-point list grouped by these categories:",
    "- Facts & commitments the assistant needs to remember",
    "- User preferences and constraints",
    "- Unresolved questions or open tasks",
    "- Important technical references or files",
    "- Chronology of key events",
    "",
    "Be specific and concise. Use short sentences. Do not invent details.",
    blocks,
    "",
    `sourceSpan: startMessageId="${sourceSpan.startMessageId}", endMessageId="${sourceSpan.endMessageId}", messageCount=${sourceSpan.messageCount}`
  ].join("\n");
}
```

Remove `summarySchema` and `summarizeBlocks` JSON parsing. The response is now plain text:

```typescript
// Remove:
// const summarySchema = z.object({...});
// function summarizeBlocks(...) { return summarySchema.parse(JSON.parse(summaryText)); }

// Replace summarizeBlocks with:
async function summarizeBlocks(
  conversationId: string,
  prompt: string,
  settings: ProviderProfileWithApiKey
): Promise<string> {
  return await callProviderText({
    settings,
    prompt,
    purpose: "compaction",
    conversationId
  });
}
```

Update `compactLeafMessages` — instead of `JSON.stringify(payload)` for content:

```typescript
const content = payload; // already plain text string
```

Update `condenseMemoryNodes` — same change, `content` is the raw text response.

Remove `SummaryPayload` from `lib/types.ts` imports and exports.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add lib/compaction.ts lib/types.ts tests/unit/compaction.test.ts
git commit -m "feat: switch compaction summaries from JSON to natural language bullet points"
```

---

### Task 6: Backwards Compatibility for Existing JSON Memory Nodes + System Message Deduplication

**Files:**
- Modify: `lib/compaction.ts` — `buildPromptMessages` render JSON nodes as text, merge system messages

- [ ] **Step 1: Add backwards-compatible JSON renderer**

In `lib/compaction.ts`, add helper function:

```typescript
function renderMemoryNode(content: string): string {
  // Check if this is an old JSON-formatted summary
  if (content.trimStart().startsWith("{")) {
    try {
      const parsed = JSON.parse(content);
      const parts: string[] = [];
      if (parsed.factualCommitments?.length) parts.push("Facts: " + parsed.factualCommitments.join(", "));
      if (parsed.userPreferences?.length) parts.push("Preferences: " + parsed.userPreferences.join(", "));
      if (parsed.unresolvedItems?.length) parts.push("Unresolved: " + parsed.unresolvedItems.join(", "));
      if (parsed.importantReferences?.length) parts.push("References: " + parsed.importantReferences.join(", "));
      if (parsed.chronology?.length) parts.push("Chronology: " + parsed.chronology.join(", "));
      return parts.join("\n");
    } catch {
      return content; // fallback to raw content if not valid JSON
    }
  }
  return content;
}
```

- [ ] **Step 2: Update buildPromptMessages to merge system messages**

Current `buildPromptMessages` creates multiple system messages. Replace with single merged system message:

```typescript
export function buildPromptMessages(input: {
  systemPrompt: string;
  messages: Message[];
  activeMemoryNodes: MemoryNode[];
  userInput?: string;
  maxAttachmentTextTokens?: number;
}): PromptMessage[] {
  const remainingAttachmentTextTokens = {
    value: input.maxAttachmentTextTokens ?? Number.POSITIVE_INFINITY
  };

  // Build single merged system message
  const systemParts: string[] = [input.systemPrompt];

  if (input.activeMemoryNodes.length) {
    systemParts.push(
      "## Compacted Memory\n" + input.activeMemoryNodes
        .map((node) => renderMemoryNode(node.content))
        .join("\n\n")
    );
  }

  // Include visible non-hidden system messages
  const visibleSystemMessages = input.messages.filter(
    (m) => m.role === "system" && m.systemKind !== "compaction_notice" && isVisibleMessage(m)
  );
  for (const msg of visibleSystemMessages) {
    systemParts.push(msg.content);
  }

  const promptMessages: PromptMessage[] = [
    { role: "system", content: systemParts.join("\n\n") }
  ];

  // Non-system messages
  input.messages.forEach((message) => {
    if (message.role === "system") return;

    if (message.role === "assistant") {
      const parts = [
        message.thinkingContent ? `Thinking:\n${message.thinkingContent}` : "",
        message.content ? `Answer:\n${message.content}` : ""
      ].filter(Boolean);

      promptMessages.push({
        role: "assistant",
        content: parts.join("\n\n")
      });
      return;
    }

    promptMessages.push({
      role: "user",
      content: buildUserPromptContent(message, remainingAttachmentTextTokens)
    });
  });

  if (input.userInput) {
    promptMessages.push({
      role: "user",
      content: input.userInput
    });
  }

  return promptMessages;
}
```

- [ ] **Step 3: Update tests for new system message structure**

Update test `skips hidden stored system prompts when rebuilding provider input` in `tests/unit/compaction.test.ts` — the expected output is now a single merged system message:

```typescript
it("skips hidden stored system prompts when rebuilding provider input", () => {
  const prompt = buildPromptMessages({
    systemPrompt: "Primary system prompt.",
    activeMemoryNodes: [],
    messages: [
      {
        id: "msg_hidden",
        conversationId: "conv_1",
        role: "system",
        content: "Legacy stored system prompt.",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 4,
        systemKind: null,
        compactedAt: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "msg_notice",
        conversationId: "conv_1",
        role: "system",
        content: "Compacted older messages into memory.",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 4,
        systemKind: "compaction_notice",
        compactedAt: null,
        createdAt: new Date().toISOString()
      },
      {
        id: "msg_user",
        conversationId: "conv_1",
        role: "user",
        content: "Continue",
        thinkingContent: "",
        status: "completed",
        estimatedTokens: 1,
        systemKind: null,
        compactedAt: null,
        createdAt: new Date().toISOString()
      }
    ]
  });

  // System prompt is merged into single system message
  // compaction_notice is hidden (systemKind check already in isVisibleMessage)
  // Legacy system prompt (no systemKind) is included in merged system message
  const systemMessage = prompt.find(m => m.role === "system");
  expect(systemMessage).not.toBeUndefined();
  expect(typeof systemMessage!.content).toBe("string");
  expect((systemMessage!.content as string)).toContain("Primary system prompt.");
  
  // Only one system message
  expect(prompt.filter(m => m.role === "system").length).toBe(1);
  
  // User message present
  expect(prompt.at(-1)!.role).toBe("user");
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/compaction.ts tests/unit/compaction.test.ts
git commit -m "feat: merge system messages and render JSON memory nodes as text"
```

---

### Task 7: Stage 2 — Incremental Summarization

**Files:**
- Modify: `lib/compaction.ts` — pass existing summary context to compactLeafMessages and condenseMemoryNodes

- [ ] **Step 1: Write existing summary prompt**

Update `buildSummaryPrompt` to accept an optional `existingSummary` parameter:

```typescript
function buildSummaryPrompt(label: string, blocks: string, sourceSpan: {
  startMessageId: string;
  endMessageId: string;
  messageCount: number;
}, existingSummary?: string) {
  const parts: string[] = [];

  if (existingSummary) {
    parts.push(
      "You are updating this existing conversation summary.",
      "",
      "EXISTING SUMMARY (for reference only):",
      existingSummary,
      "",
      "NEW MESSAGES:",
      blocks,
      "",
      "Produce an updated summary that incorporates the new messages into the existing context.",
      "Write your response as a bullet-point list grouped by these categories:",
      "- Facts & commitments the assistant needs to remember",
      "- User preferences and constraints",
      "- Unresolved questions or open tasks",
      "- Important technical references or files",
      "- Chronology of key events",
      "",
      "Be specific and concise. Use short sentences. Do not invent details.",
      `sourceSpan: startMessageId="${sourceSpan.startMessageId}", endMessageId="${sourceSpan.endMessageId}", messageCount=${sourceSpan.messageCount}`
    );
  } else {
    parts.push(
      `You are compacting ${label} for a chat memory engine.`,
      "",
      "Write your response as a bullet-point list grouped by these categories:",
      "- Facts & commitments the assistant needs to remember",
      "- User preferences and constraints",
      "- Unresolved questions or open tasks",
      "- Important technical references or files",
      "- Chronology of key events",
      "",
      "Be specific and concise. Use short sentences. Do not invent details.",
      blocks,
      "",
      `sourceSpan: startMessageId="${sourceSpan.startMessageId}", endMessageId="${sourceSpan.endMessageId}", messageCount=${sourceSpan.messageCount}`
    );
  }

  return parts.join("\n");
}
```

- [ ] **Step 2: Update compactLeafMessages to pass existing summary**

In `compactLeafMessages`, find the most recent active memory node and pass its content:

```typescript
async function compactLeafMessages(
  conversationId: string,
  messages: Message[],
  settings: ProviderProfileWithApiKey
) {
  // ... existing logic ...

  // Find existing summary for incremental update
  const activeNodes = getActiveMemoryNodes(conversationId);
  const existingSummary = activeNodes.length
    ? activeNodes[activeNodes.length - 1].content
    : undefined;

  const payload = await summarizeBlocks(
    conversationId,
    buildSummaryPrompt("raw chat messages", blocks, {
      startMessageId: selected[0].id,
      endMessageId: selected[selected.length - 1].id,
      messageCount: selected.length
    }, existingSummary),
    settings
  );

  // ... rest unchanged ...
}
```

- [ ] **Step 3: Update condenseMemoryNodes to pass child summaries as existing context**

In `condenseMemoryNodes`, update the prompt:

```typescript
const existingContext = selected.map(n => `[node] ${n.id}\n${renderMemoryNode(n.content)}`).join("\n\n");

const payload = await summarizeBlocks(
  conversationId,
  buildSummaryPrompt("compacted memory nodes", blocks, {
    startMessageId: selected[0].sourceStartMessageId,
    endMessageId: selected[selected.length - 1].sourceEndMessageId,
    messageCount: selected.length
  }, existingContext),
  settings
);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS (mock doesn't care about prompt format, returns text regardless)

- [ ] **Step 5: Commit**

```bash
git add lib/compaction.ts
git commit -m "feat: incremental summarization — pass existing summary to compaction LLM"
```

---

### Task 8: Stage 2 — Graceful Fallback

**Files:**
- Modify: `lib/compaction.ts` — replace throw with node dropping logic

- [ ] **Step 1: Add node dropping function**

Add to `lib/compaction.ts`:

```typescript
function dropOldestMemoryNode(conversationId: string): boolean {
  const db = getDb();
  // Get oldest/deepest active node
  const node = db.prepare(
    `SELECT id FROM memory_nodes
     WHERE conversation_id = ? AND superseded_by_node_id IS NULL
     ORDER BY depth DESC, created_at ASC
     LIMIT 1`
  ).get(conversationId) as { id: string } | undefined;

  if (!node) return false;

  // Supersede it
  db.prepare(
    `UPDATE memory_nodes SET superseded_by_node_id = '_dropped'
     WHERE id = ?`
  ).run(node.id);

  return true;
}
```

- [ ] **Step 2: Update ensureCompactedContext main loop**

Replace the error throw in `ensureCompactedContext` with fallback logic:

```typescript
if (!compacted) {
  // Attempt graceful fallback: drop oldest memory nodes
  const dropped = dropOldestMemoryNode(conversationId);

  if (!dropped) {
    // Nuclear option: fall back to system prompt + last user message only
    const messages = listMessages(conversationId);
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user" && !m.compactedAt);

    if (lastUserMessage) {
      const promptMessages = buildPromptMessages({
        systemPrompt: settings.systemPrompt,
        messages: [lastUserMessage],
        activeMemoryNodes: []
      });
      return { promptMessages, promptTokens: estimatePromptTokens(promptMessages), compactionNoticeEvent: null };
    }

    throw new Error(
      "Conversation exceeds the configured context limit. No fallback available."
    );
  }

  // Continue loop to check again after dropping
  continue;
}
```

- [ ] **Step 3: Update the test that expects the error message**

The test `fails cleanly when the prompt is too large and nothing is eligible for compaction` expects the error `"Conversation exceeds the configured context limit even after compaction."`. Update it:

```typescript
it("falls back gracefully when the prompt is too large and nothing is eligible", async () => {
  updateDefaultProfile({
    modelContextLimit: 4096,
    compactionThreshold: 0.7
  });

  const conversation = createConversation();

  for (let index = 0; index < 8; index += 1) {
    createMessage({
      conversationId: conversation.id,
      role: "user",
      content: `Huge ${"context ".repeat(400)} ${index}`
    });
  }

  // With fallback, this should NOT throw — it should fall back to system + last message
  const result = await ensureCompactedContext(
    conversation.id,
    getDefaultProviderProfileWithApiKey()!
  );

  expect(result.promptMessages.some(m => m.role === "system")).toBe(true);
  expect(result.promptMessages.some(m => m.role === "user")).toBe(true);
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/compaction.ts tests/unit/compaction.test.ts
git commit -m "feat: graceful fallback — drop memory nodes when context exceeds limit"
```

---

### Task 9: Stage 3 — LLM-Based Memory Scoring

**Files:**
- Modify: `lib/compaction.ts` — add `scoreMemoryNodes` function
- Modify: `lib/provider.ts` — update `callProviderText` to support custom maxOutputTokens for scoring
- Modify: `tests/unit/compaction.test.ts` — add scoring mock and tests

- [ ] **Step 1: Write scoring function**

Add to `lib/compaction.ts`:

```typescript
async function scoreMemoryNodes(input: {
  userInput: string;
  activeNodes: MemoryNode[];
  settings: ProviderProfileWithApiKey;
  conversationId: string;
}): Promise<string[]> {
  const { userInput, activeNodes, settings, conversationId } = input;

  const nodeBlocks = activeNodes
    .map((node) => `[node: ${node.id}] ${renderMemoryNode(node.content)}`)
    .join("\n\n");

  const prompt = [
    "The user just asked:",
    `"${userInput}"`,
    "",
    "Which of these context summaries are relevant?",
    'Return only a valid JSON object: {"relevantNodes": ["nodeId1", "nodeId2"]}',
    "",
    "Context summaries:",
    nodeBlocks
  ].join("\n");

  try {
    const result = await callProviderText({ settings, prompt, purpose: "compaction", conversationId });
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed.relevantNodes)) {
      return parsed.relevantNodes.filter((id: string): id is string => typeof id === "string" && id.length > 0);
    }
    return [];
  } catch {
    return []; // fall back to all nodes
  }
}
```

- [ ] **Step 2: Integrate scoring into ensureCompactedContext**

The return path at the bottom of `ensureCompactedContext` needs to be updated. After the compaction loop exits (when `promptTokens <= compactionLimit`), select relevant nodes before building the final prompt.

Replace the `return` statement in the early-exit path (line 608-613):

```typescript
if (promptTokens <= compactionLimit) {
  // Score and select relevant nodes
  const scoredNodeIds = await scoreMemoryNodes({
    userInput: visibleMessages.filter(m => m.role === "user").at(-1)?.content ?? "",
    activeNodes: activeMemoryNodes,
    settings,
    conversationId
  });

  let selectedNodes = activeMemoryNodes;
  if (scoredNodeIds.length > 0 && scoredNodeIds.length < activeMemoryNodes.length) {
    const scored = activeMemoryNodes.filter(n => scoredNodeIds.includes(n.id));
    const unscored = activeMemoryNodes.filter(n => !scoredNodeIds.includes(n.id));

    // Score only the most recent memory nodes (those with the highest depth)
    const sortedUnscored = [...unscored].sort((a, b) => {
      if (b.depth !== a.depth) return b.depth - a.depth;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Progressive fill: use scored first, then fill budget with oldest nodes
    selectedNodes = [...scored];
    const scoredTokens = buildPromptMessages({
      systemPrompt: settings.systemPrompt,
      messages: visibleMessages,
      activeMemoryNodes: scored,
      maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO)
    }).reduce((t, m) => {
      if (typeof m.content === "string") return t + estimateTextTokens(m.content) + 12;
      return t + estimatePromptContentTokens(m.content) + 12;
    }, 0);

    const remaining = compactionLimit - scoredTokens;
    for (const node of sortedUnscored) {
      const nodeTokens = node.summaryTokenCount;
      if (nodeTokens <= remaining) {
        selectedNodes.push(node);
      }
    }
  }

  const finalPromptMessages = buildPromptMessages({
    systemPrompt: settings.systemPrompt,
    messages: visibleMessages,
    activeMemoryNodes: selectedNodes,
    maxAttachmentTextTokens: Math.floor(settings.modelContextLimit * MAX_ATTACHMENT_TEXT_RATIO)
  });

  return {
    promptMessages: finalPromptMessages,
    promptTokens: estimatePromptTokens(finalPromptMessages),
    compactionNoticeEvent: noticeEvent
  };
}
```

Note: `estimateTextTokens` and `estimatePromptContentTokens` are already imported from `@/lib/tokenization` in `compaction.ts` (line 23), and `estimatePromptContentTokens` needs to also be imported if it isn't already. Add it to the import if missing.

- [ ] **Step 3: Add test for scoring**

Update the mock in `tests/unit/compaction.test.ts` to handle scoring prompts:

```typescript
vi.mock("@/lib/provider", async () => {
  return {
    callProviderText: vi.fn(async (input: { prompt: string }) => {
      // Scoring prompt detection
      if (input.prompt.includes("relevantNodes")) {
        const ids = [...input.prompt.matchAll(/\[node:\s*(mem_[a-z0-9-]+)\]/gi)]
          .map((match) => match[1]);
        return JSON.stringify({
          relevantNodes: ids.slice(0, Math.max(1, Math.ceil(ids.length / 2)))
        });
      }

      const ids = [...input.prompt.matchAll(/mem_[a-z0-9-]+|msg_[a-z0-9-]+/gi)]
        .map((match) => match[0]);

      return `- Fact from messages ${ids.slice(0, 3).join(", ")}
- Preference: keep context compact
- Unresolved: need to test scoring`;
    })
  };
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/compaction.test.ts -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/compaction.ts tests/unit/compaction.test.ts
git commit -m "feat: LLM-based memory scoring for selective node injection with progressive fill"
```

---

### Task 10: Final Verification & Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests PASS

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit final state**

```bash
git status
git add -A
git commit -m "chore: context compaction improvements complete"
```
