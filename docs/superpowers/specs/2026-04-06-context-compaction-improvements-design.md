# Context Compaction Improvements Design

## Overview

The Eidon chat compaction system manages LLM context windows by summarizing older messages and injecting them as structured memory alongside fresh conversation tail. This design improves compaction quality, prevents failures, adds configurability, and uses smarter memory retrieval.

Implementation is structured in 3 independent stages, each shipable separately.

## Architecture

```
User message → ensureCompactedContext() → buildPromptMessages() → LLM
                    ↓
  Stage 1: Better summaries + configurable limits + per-model tokenizer + system cleanup
  Stage 2: Incremental summarization + graceful fallback
  Stage 3: LLM-based memory scoring for selective injection
```

## Stage 1: Natural Language Summaries + Configurable Constants + Tokenizer + System Cleanup

### 1.1 Natural Language Summary Format

**Current:** Summaries are stored as JSON (`SummaryPayload`) and injected raw via `JSON.stringify()`.

**Change:** Compaction prompts instruct the LLM to return natural language paragraphs instead of structured JSON.

**Prompt format:** Instead of the JSON schema prompt, use:
```
You are compacting older conversation turns into a concise summary.

Write your response as numbered bullet points, grouped by category:
- Facts & commitments the assistant needs to remember
- User preferences and constraints
- Unresolved questions or open tasks
- Important technical references or files
- Chronology of key events

Be specific and concise. Use short sentences. Do not invent details you don't see in the text.
```

**Backwards compatibility:** Existing JSON memory nodes are rendered on-the-fly. In `buildPromptMessages`, detect if `node.content` starts with `{`, parse the JSON, and format it as readable text. No DB migration needed.

**New type:** Replace `SummaryPayload` with `CompactionSummary` — just `{ content: string; sourceSpan: SourceSpan }`. The LLM returns plain text now.

**Files:** `lib/compaction.ts` (summary prompt, `summarizeBlocks`), `lib/types.ts`

### 1.2 Configurable Compaction Constants

**Current:** `SAFETY_MARGIN_TOKENS`, `LEAF_SOURCE_TOKEN_LIMIT`, `LEAF_MIN_MESSAGE_COUNT`, `MERGED_MIN_NODE_COUNT`, `MERGED_TARGET_TOKENS` are hardcoded in `constants.ts`. Only `compactionThreshold` and `freshTailCount` are user-configurable per provider.

**Change:** Move all compaction constants into provider profile settings. Keep `constants.ts` as defaults, read actual values from `ProviderProfile`.

New fields in provider profile schema:
- `safetyMarginTokens` (default: 1200)
- `leafSourceTokenLimit` (default: 12000)
- `leafMinMessageCount` (default: 6)
- `mergedMinNodeCount` (default: 4)
- `mergedTargetTokens` (default: 1600)

**Files:** `lib/settings.ts` (schema), `lib/constants.ts` (defaults), `lib/compaction.ts` (usage), settings UI (`components/settings/sections/providers-section.tsx`)

### 1.3 Per-Model Tokenizer Adapter

**Current:** `gpt-tokenizer` is used for all models via `encode()` in `lib/tokenization.ts`.

**Change:** Create `lib/token-estimator.ts` that dispatches based on provider settings.

```
lib/token-estimator.ts:
- `createTokenizer(engine: ProviderProfile['tokenizerModel'])`
  - 'gpt-tokenizer' → use `gpt-tokenizer` (current behavior, default)
  - 'off' → character count / 4 approximation (no dependency)
```

Additional model-specific engines can be added later. The priority is providing an 'off' escape hatch rather than maintaining multiple tokenizer dependencies. The `gpt-tokenizer` approximation is accurate enough for most purposes.

Add `tokenizerModel` field to provider profile (default: `gpt-tokenizer` to maintain current behavior).

**Files:** New `lib/token-estimator.ts`, update `lib/tokenization.ts`, `lib/settings.ts`, UI

### 1.4 System Message Deduplication

**Current:** `buildPromptMessages` creates multiple `system` role messages: the system prompt, then a "Compacted conversation memory" message, then any visible system messages from the DB.

**Change:** Merge all system content into a single `system` message at the top:
```
{systemPrompt}

## Compacted Memory
{node1}
{node2}

## Visible System Messages
{visible system message content}
```

This keeps one system message instead of N, which some providers handle better and reduces overhead tokens.

**Files:** `lib/compaction.ts` (`buildPromptMessages`)

## Stage 2: Incremental Summarization + Graceful Fallback

### 2.1 Incremental Summarization

**Current summary creation:** Compact fresh messages into a completely new summary. When merging, summarize existing summaries (summary-of-summary), losing detail over time.

**Change:** Pass existing summary context to the compaction LLM:

```
You are updating this existing conversation summary.

EXISTING SUMMARY (for reference only):
{previous_summary}

NEW MESSAGES:
{new_messages}

Produce an updated summary that incorporates the new messages into the existing context.
Write your response as numbered bullet points...
```

For merged summaries, pass all child summaries as the "existing context" along with the merge instruction. This way each generation inherits prior detail rather than summarizing it away.

**Implementation:**
- `compactLeafMessages` finds the most recent active memory node, passes its content to the prompt
- `condenseMemoryNodes` passes the merged child summaries as context
- No new tables needed — same schema

### 2.2 Graceful Fallback

**Current:** When `compactLeafMessages` returns null and context is still over limit, throws.

**Change:** In `ensureCompactedContext`, after leaf compaction and node condensing loop, if still over limit:
1. Get all active memory nodes, sorted by depth descending, then oldest first
2. Drop the oldest/deepest node (mark for removal)
3. Recalculate prompt tokens
4. Repeat until under limit or no nodes remain
5. If still over after dropping everything, keep only system prompt + last user message

**File:** `lib/compaction.ts` (`ensureCompactedContext` main loop)

## Stage 3: LLM-Based Memory Scoring

### 3.1 Selective Memory Injection

**Current:** All active memory nodes are injected into every prompt regardless of relevance.

**Change:** Score each memory node for relevance to the current user message, then inject only top-scoring nodes.

**Scoring flow:**
```
ensureCompactedContext():
  ...after compaction...
  
  relevantNodes = scoreMemoryNodes({
    userInput: latestUserMessage,
    activeNodes: activeMemoryNodes,
    settings
  })
  
  buildPromptMessages({ ..., activeMemoryNodes: relevantNodes, ... })
```

**Scoring prompt:**
```
The user just asked: {userMessage}

Which of these context summaries are relevant?
Return only a JSON object: { relevantNodes: ["nodeId1", "nodeId2"] }

Context summaries:
[node: abc123] Summary text...
[node: def456] Summary text...
```

**Optimizations:**
- Use `callProviderText` with a small `maxOutputTokens` (256) for scoring — it's just returning IDs
- If scoring fails (error), fall back to injecting all nodes (current behavior) — don't break the conversation
- Cache the last scoring result and only re-score when the user message topic changes significantly

**New function:** `scoreMemoryNodes` in `lib/compaction.ts`

### 3.2 Progressive Fill After Scoring

After scoring, inject the relevant nodes first. If the remaining token budget allows, progressively fill from oldest/deepest nodes (the context most likely forgotten) until the budget is consumed. This is a "relevance first, then depth" strategy rather than "all or nothing."

Scoring adds one extra LLM call per turn. Keep this call small (`maxOutputTokens: 256`) and accept the latency trade-off.

## Files Changed

| File | Stage | Change |
|------|-------|--------|
| `lib/compaction.ts` | 1, 2, 3 | Summary format, system merge, incremental compact, fallback, scoring |
| `lib/types.ts` | 1 | Replace `SummaryPayload` with `CompactionSummary`, add `tokenizerModel` |
| `lib/tokenization.ts` | 1 | Use `createTokenizer()` for dispatch |
| `lib/token-estimator.ts` | 1 (new) | Multi-backend tokenizer adapter |
| `lib/settings.ts` | 1 | Add compaction constants + tokenizer to schema |
| `lib/provider.ts` | 1 | Use new tokenizer |
| `lib/constants.ts` | 1 | Keep as defaults, mark for override |
| `components/settings/sections/providers-section.tsx` | 1 | UI for new configurable fields |

## Error Handling

| Error | Handling |
|-------|----------|
| LLM returns non-text summary | Retry once, then use "Summary unavailable" placeholder |
| Scoring fails / empty | Fall back to all nodes |
| Compaction hits limit with no eligible messages | Drop oldest memory nodes, then fallback to system + last message |
| Unknown tokenizer | Fall back to gpt-tokenizer with console warning |

## Testing

- Unit: Summary format (NL vs JSON), tokenizer dispatch, system message merge, scoring prompt construction, fallback logic
- Integration: Full `ensureCompactedContext` flow with staged compaction
- Edge: Empty conversations, single message, massive attachments that exceed limits before any compaction
