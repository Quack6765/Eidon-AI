# Autocompaction Hardening Design

## Overview

Eidon already has a working long-context compaction path, but the current implementation still carries several risks that matter for a long-running chatbot agent app:

- the `autoCompaction` setting exists but is not honored by the main chat path
- `thinkingContent` is currently included in compaction input
- retrieval depends on an extra LLM scoring call on the hot path
- the progressive-fill budget logic is weak and can over-select memory nodes
- fallback can permanently drop old memory nodes from the active set
- compaction works on raw message slices instead of completed work turns
- `compaction_events` is queried for debug stats but is not populated by the compaction flow

This design hardens autocompaction around three principles:

1. Always-on compaction for now, with no user-facing toggle.
2. Stable high-signal summaries focused on outcomes, constraints, and open work.
3. Deterministic retrieval and fallback, without per-turn LLM relevance scoring.

The result should behave like a durable working-memory system for long-running agent conversations: keep recent work verbatim, keep older work compressed, and bring back only the summaries that are predictably useful.

## Goals

- Keep long conversations usable past the model context limit without visible "amnesia".
- Preserve what matters for future work: goals, decisions, outcomes, constraints, open tasks, and artifact references.
- Exclude noisy or unsafe carry-forward content: visible reasoning, raw tool logs, and bulky attachment text.
- Make prompt construction deterministic and easier to debug.
- Keep the runtime budget honest and avoid silent overfilling.
- Avoid destructive fallback that silently discards long-term conversation memory.
- Make compaction state observable in debug stats.

## Non-Goals

- Building a cross-conversation vector memory system.
- Changing the existing user memory feature in `lib/memories.ts`.
- Reworking provider streaming or tool execution architecture.
- Full schema cleanup of every historical field if a safer compatibility path exists.

## External Guidance

This design is informed by current primary sources and adapted to Eidon's architecture:

- OpenAI cookbook, "Context Engineering - Short-Term Memory Management with Sessions from OpenAI Agents SDK":
  - recommends trimming and compression together rather than carrying forward uncurated history
  - highlights summaries as "clean rooms" that prevent context poisoning and improve reproducibility
  - emphasizes preserving recent work verbatim while compressing older context
  - https://developers.openai.com/cookbook/examples/agents_sdk/session_memory
- OpenAI cookbook, "Context Engineering for Personalization - State Management with Long-Term Memory Notes using OpenAI Agents SDK":
  - recommends injecting only relevant state into context
  - separates session-scoped notes from durable long-term memory
  - treats consolidation as a sensitive stage requiring deduplication, conflict resolution, and forgetting
  - https://cookbook.openai.com/examples/agents_sdk/context_personalization
- MemGPT:
  - frames long-context support as tiered memory management between fast and slow memory
  - strongly supports the split between prompt-resident working memory and external stored memory
  - https://arxiv.org/abs/2310.08560
- LongMemEval:
  - breaks long-term chat memory into indexing, retrieval, and reading stages
  - shows that memory quality depends on explicit retrieval design, not just bigger context
  - https://arxiv.org/abs/2410.10813
- Anthropic, "Managing context on the Claude Developer Platform":
  - recommends clearing stale tool calls and results while preserving critical information separately
  - reinforces the split between context editing and memory
  - https://www.anthropic.com/news/context-management

Inference from these sources: Eidon should not treat all prior transcript content as equally valuable. Old tool payloads and reasoning should be edited out of active context, while high-signal state should be compressed into retrievable summaries.

## Current-State Assessment

### What is already good

- Eidon already compacts before provider execution.
- It already maintains a fresh raw tail plus compacted memory nodes.
- It already supports hierarchical summary nodes.
- It already has transient compaction UI instead of a persistent transcript artifact.

### What is currently risky

### 1. Runtime ignores the auto-compaction product toggle

`AppSettings.autoCompaction` exists in settings and UI, but the chat entrypoints call `ensureCompactedContext(...)` unconditionally.

Impact:
- product behavior does not match the settings surface
- users can believe compaction is disabled when it is not

### 2. Visible reasoning is summarized into memory

`compactLeafMessages(...)` currently includes assistant `thinkingContent` when building compaction blocks.

Impact:
- lower-quality memory due to noisy or speculative reasoning traces
- higher token use during compaction
- worse carry-forward behavior for future turns

### 3. Retrieval is LLM-scored on the hot path

`scoreMemoryNodes(...)` adds another model call in the normal prompt path.

Impact:
- extra latency on every turn
- non-deterministic memory selection
- harder debugging and reproducibility
- possible silent misses if the scorer returns incomplete or malformed selections

### 4. Progressive fill is not budget-safe

The current "remaining budget" logic calculates a single remainder and then compares each unscored node to the same value without decrementing it after selection.

Impact:
- prompt assembly can exceed the intended memory budget even after "selection"

### 5. Compaction is message-slice based instead of turn based

Compaction eligibility is based on raw un-compacted messages minus a fresh tail count. This is weaker for agent chats where meaningful state spans:

- a user request
- assistant reply
- tool/action rows
- artifacts referenced during the work

Impact:
- summaries can split related work across compaction boundaries
- memory quality drifts downward as the conversation becomes more tool-heavy

### 6. Last-resort fallback is destructive

`dropOldestMemoryNode(...)` supersedes old active nodes when the prompt is still too large.

Impact:
- a temporary token-pressure problem can permanently reduce the long-term memory set
- difficult to reason about why a conversation later "forgot" older work

### 7. Compaction debug events are dead

`getConversationDebugStats(...)` reads `compaction_events`, but the current compaction path never inserts records there.

Impact:
- `latestCompactionAt` is misleading or always null
- observability around compaction is incomplete

## Recommended Architecture

### Three-layer model

The conversation context model should be:

1. Fresh working set
2. Stored conversation memory
3. Deterministic retrieval

### 1. Fresh working set

Keep a bounded verbatim recent tail in prompt. The fresh tail should preserve completed work turns, not arbitrary raw messages.

Design clarification:

- `freshTailCount` should represent a count of completed recent turns, not a count of raw messages.

A work turn is:

- one user message
- the assistant answer associated with that user message
- message actions and tool outcomes associated with that assistant message
- artifact references associated with that turn

Explicitly excluded from work-turn compaction content:

- assistant `thinkingContent`
- raw command output beyond a short outcome summary
- raw MCP or tool payload bodies
- full extracted attachment text beyond compact references

### 2. Stored conversation memory

Older completed work turns are compacted into memory nodes that preserve high-signal state:

- user goals
- constraints and preferences stated within the conversation
- decisions or commitments made by the assistant
- work completed
- unresolved work
- files, commands, URLs, IDs, and other artifact references
- chronology at the level needed to keep the conversation coherent

### 3. Deterministic retrieval

At prompt-build time, do not run a separate LLM scoring pass.

Instead, select memory nodes using deterministic rules:

- include summaries with unresolved work
- include summaries whose artifact references are explicitly mentioned again in the latest user turn
- include summaries linked to the current workstream when the latest user turn reuses artifact references already associated with those summaries
- include a small recency backfill after the high-priority nodes
- stop when the summary budget is exhausted

This keeps retrieval stable, explainable, and fast.

## Memory Node Content Model

Eidon currently stores `memory_nodes.content` as free text. That can remain true for compatibility, but the generated summary should follow a stricter internal schema so it can be parsed or rendered predictably later.

### Summary shape

Each compacted work-turn summary should capture:

- `goal`
- `constraints`
- `actions_taken`
- `outcomes`
- `open_tasks`
- `artifact_refs`
- `time_span`

The provider prompt should still ask for concise natural-language bullets, but the categories must be stable and mapped to the fields above.

Example rendered summary:

```text
Goal:
- Diagnose the broken deploy pipeline and restore green CI.

Constraints:
- Do not change production environment variables.
- Keep the current GitHub Actions workflow structure.

Actions Taken:
- Reviewed failing workflow logs.
- Patched the test bootstrap to restore missing env setup.

Outcomes:
- Unit tests pass locally.
- CI workflow still needs rerun confirmation.

Open Tasks:
- Confirm the remote Actions run succeeds.

Artifact References:
- .github/workflows/ci.yml
- tests/setup.ts
- run id 123456789
```

This is intentionally outcome-heavy rather than transcript-heavy.

## Compaction Algorithm

### Compaction trigger

Keep the existing overall trigger model:

- compute prompt budget from model context limit, output limit, and safety margin
- compact when current prompt usage exceeds `compactionThreshold`

Change the product default:

- default threshold becomes `80%`
- stored runtime value becomes `0.8`
- frontend displays and edits it as a percentage

### Compaction unit

Replace message-slice compaction with completed work-turn compaction.

Implementation rule:

- build compaction candidates from the oldest completed user-originated turns
- never split a user request from the assistant answer that resolved it
- include action summaries from that turn
- exclude raw `thinkingContent`

### Compaction prompt rules

The summarizer should be explicitly told to:

- preserve decisions, constraints, completed work, unresolved work, and artifact references
- omit chain-of-thought and speculative reasoning
- collapse raw tool logs into outcome statements
- mention files, commands, URLs, IDs, and entities only when they matter later
- avoid quoting large blobs

### Hierarchical merging

Keep hierarchical memory nodes, but merged summaries should preserve the same stable categories above. Merged summaries are not freeform "summary of summary" prose; they should still be rendered in the same compact category layout.

## Retrieval Rules

### Remove per-turn LLM scoring

Delete the hot-path `scoreMemoryNodes(...)` retrieval call from normal prompt assembly.

Reason:

- deterministic retrieval is more stable for a production agent app
- it removes an entire model call from every turn
- it avoids retrieval drift and malformed JSON cases

### Deterministic priority order

Memory node selection should use this priority order:

1. Nodes with non-empty `open_tasks`
2. Nodes whose `artifact_refs` match explicit signals in the latest user turn
3. Nodes from the most recent relevant workspan
4. Recency backfill, newest first, until budget is exhausted

Relevant signals for step 2 and the workstream linkage rule should be deterministic and cheap:

- exact file path mentions
- command names
- URLs or domains
- issue or run IDs
- conversation-local artifact IDs

If no deterministic linkage signal exists, skip the workstream step rather than guessing.

### Budget accounting

Selection must decrement the remaining summary budget after each chosen node.

This fixes the current over-selection weakness.

### Rendering into prompt

Prompt assembly order should be:

1. system prompt
2. persona content
3. persistent cross-conversation memories from `lib/memories`
4. selected conversation memory summaries
5. fresh recent completed work turns
6. current user input

## Fallback Strategy

Fallback should be non-destructive.

### New fallback order

If the prompt is still over budget after compaction:

1. reduce low-priority recency backfill summaries
2. reduce fresh-tail size down to a minimum safe floor
3. trim oversized attachment text aggressively
4. if absolutely required, return a minimal prompt with:
   - system prompt
   - persona
   - persistent memories
   - highest-priority unresolved summaries
   - latest completed user turn
   - current user input

Do not permanently supersede or drop memory nodes solely because the current prompt is too large.

### Remove destructive node dropping

`dropOldestMemoryNode(...)` should be removed from the compaction pressure path.

If long-term pruning is ever needed later, it should be a separate retention policy with explicit criteria, not an emergency prompt-budget reaction.

## Settings And Product Surface

### Always-on compaction

For now, autocompaction is always on.

Design decision:

- remove the `autoCompaction` setting from the frontend
- remove it from sanitized settings returned to the client
- remove runtime branching around it
- treat compaction as part of the core chat architecture, not an optional feature

Compatibility approach:

- existing SQLite `auto_compaction` column may remain temporarily to avoid a destructive migration
- the application should stop depending on it
- a later cleanup migration can remove the dead column once compatibility is no longer needed

### Compaction threshold UI

The frontend should display the threshold as a percentage.

Rules:

- default UI value: `80`
- stored runtime value: `0.8`
- load path converts decimal to percentage
- save path converts percentage to decimal
- all labels and helper text use percentage language

Example helper text:

`Start compacting when prompt usage reaches 80% of the available input budget.`

## Observability And Debugging

### Populate compaction events

Every successful leaf compaction should insert a `compaction_events` row that links:

- conversation id
- created memory node id
- source start message id
- source end message id
- created timestamp

`notice_message_id` should remain null because the visible compaction notice has already been removed from the transcript model.

### Debug stats behavior

`getConversationDebugStats(...)` should then report a meaningful `latestCompactionAt`.

Optional future extension:

- include compacted turn count
- include selected summary node count for the current prompt

## File-Level Design

### `lib/compaction.ts`

Main changes:

- stop using `thinkingContent` in compaction input
- replace raw-message compaction eligibility with completed work-turn eligibility
- remove per-turn LLM node scoring
- implement deterministic retrieval
- fix remaining-budget accounting during selection
- remove destructive `dropOldestMemoryNode(...)` fallback path
- insert `compaction_events` when compaction succeeds

### `lib/conversations.ts`

May need one or both of:

- a helper that groups messages into completed work turns
- a helper that exposes compact action summaries attached to an assistant turn

### `lib/types.ts`

Changes:

- remove `autoCompaction` from the client-facing `AppSettings` type
- add or refine types used for turn compaction and retrieval metadata if needed

### `lib/settings.ts`

Changes:

- stop surfacing `autoCompaction`
- keep compaction threshold persisted as normalized decimal
- change default threshold from `0.78` to `0.8`

### `components/settings/sections/general-section.tsx`

Changes:

- remove the auto-compaction toggle from the general settings UI

### `components/settings/sections/providers-section.tsx`

Changes:

- display compaction threshold as a percentage
- set the default to `80`
- convert to and from decimal when syncing with settings state

### Chat routes and runtime entrypoints

Files:

- `app/api/conversations/[conversationId]/chat/route.ts`
- `lib/chat-turn.ts`

Change:

- keep calling compaction unconditionally
- no auto-compaction branching
- behavior remains always-on

## Testing

### Unit tests

Add or update tests covering:

- compaction excludes `thinkingContent`
- compaction works on completed work turns, not arbitrary message slices
- deterministic retrieval prefers unresolved work and explicit artifact reference matches
- retrieval respects summary budget and decrements remaining budget correctly
- fallback never supersedes stored memory nodes
- `compaction_events` are created on successful compaction
- settings no longer expose `autoCompaction`
- providers UI converts `80` percent to `0.8` decimal and back

### Integration tests

Cover:

- long tool-heavy conversation compacts without carrying raw logs forward
- follow-up turn referencing a file or command pulls in the right summary deterministically
- prompt remains under budget after retrieval selection
- latest compaction timestamp updates after compaction

### Regression checks

Explicit regressions to protect against:

- summaries including reasoning text
- summaries ballooning with command output
- older work being forgotten because a temporary over-budget turn permanently removed nodes
- UI continuing to show `0.78`-style decimal threshold input

## Rollout Notes

This should be implemented as a focused hardening pass, not a broad refactor.

Recommended order:

1. Remove dead settings surface and update threshold UI contract.
2. Harden compaction content rules to exclude reasoning and raw logs.
3. Replace retrieval scoring with deterministic retrieval.
4. Replace destructive fallback.
5. Add compaction event persistence and tests.

## Acceptance Criteria

- Autocompaction is always on and no longer appears as a toggle in settings.
- The threshold is displayed as a percentage in the frontend and defaults to `80%`.
- Reasoning text is not included in compacted memory.
- Raw tool logs are not carried forward into summaries.
- Retrieval no longer depends on a separate LLM scoring call.
- Prompt memory selection is deterministic and budget-safe.
- Over-budget fallback does not permanently drop stored conversation memory.
- Debug stats show real compaction timestamps via persisted `compaction_events`.
