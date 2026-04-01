# Native Tool Calling Design

Date: 2026-04-01
Status: Approved

## Problem

The AI agent uses text-based control markers (`TOOL_CALL:`, `SKILL_REQUEST:`, `SHELL_CALL:`) embedded in the model's output. The model frequently describes intent to use a tool in natural language ("I will use the web search tool") but fails to emit the structured marker. The guarded emitter and text-parsing infrastructure is fragile and complex. Additionally, timeline items (text and actions) are not interleaved correctly in persisted messages.

## Solution

Replace text-based markers with native OpenAI function calling. The model receives structured `tools` parameter and returns `tool_calls` objects. No text parsing. No guard emitter. The model decides autonomously when to call tools.

## Architecture

### Tool Definitions

Each capability becomes a function definition passed in the `tools` parameter:

| Tool | When Available | Purpose |
|------|---------------|---------|
| `mcp_{serverId}_{toolName}` | Each MCP tool from each server | Direct pass-through of MCP tool schema |
| `load_skill` | When skills are enabled | Takes `skill_name`, returns full skill content |
| `execute_shell_command` | When a loaded skill enables shell prefixes | Takes `command`, `timeout_ms` |

Skill metadata (name + description) remains in the system prompt as lightweight text. The model calls `load_skill` only when it decides a skill is relevant (metadata-first pattern preserved).

### Agentic Loop

```
1. Build prompt messages (system + history) and tool definitions
2. Call provider with tools parameter (streaming)
3. Model responds with:
   a. Text content -> stream to UI
   b. Tool calls -> execute each, feed results back
   c. Both text AND tool calls -> text streams first, then tool calls execute
4. If model made tool calls -> add tool results to messages, goto 2
5. If model has only text -> done, save message
```

The model can interleave text and tool calls in a single response. No control markers. No guarded emitter.

### Provider Changes (`provider.ts`)

`streamProviderResponse` accepts a new `tools` parameter:

```typescript
export async function* streamProviderResponse(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
}): AsyncGenerator<ChatStreamEvent, ProviderResult, void>
```

Both Responses API and Chat Completions API receive the `tools` parameter.

New streaming events from provider:

| Event | When | Payload |
|-------|-------|---------|
| `tool_call_start` | Function call begins | `toolCallId`, `name` |
| `tool_call_delta` | Arguments stream in | `toolCallId`, `argumentsDelta` |

Return type includes `toolCalls`:

```typescript
type ProviderResult = {
  answer: string;
  thinking: string;
  toolCalls?: ProviderToolCall[];
  usage: Usage;
};

type ProviderToolCall = {
  id: string;
  name: string;
  arguments: string;
};
```

### Runtime Changes (`assistant-runtime.ts`)

**New function:** `buildToolDefinitions` creates tool definitions from MCP tools, skills, and shell command prefixes.

**Revised `resolveAssistantTurn`:**

1. Build tool definitions
2. Call provider with tools
3. If response has tool calls:
   - Execute each tool call based on name prefix
   - Add assistant message with tool_calls + tool result message to conversation
   - Continue loop
4. If no tool calls, return final answer

**Tool execution handlers:**
- `handleMcpToolCall` — parse `mcp_{sanitizedServerId}_{toolName}`, call MCP client (server IDs sanitized to alphanumeric + underscores for valid function names)
- `handleLoadSkill` — resolve skill name, load content, enable shell prefixes
- `handleShellCommand` — validate prefix, execute locally

**Removed functions:**
- `extractToolCall`, `extractShellCall`, `extractSkillRequest`
- `planAutomaticToolCall`, `planAutomaticFollowUpToolCall`
- `shouldUseWebSearch`, `shouldUseCodeSearch`, `shouldDeepDiveWebsite`
- `planAutomaticSkillLoad`, `tokenizeForSkillMatching`
- `isCapabilityInventoryQuestion`, `buildCapabilityInventoryAnswer`
- `getSkillAlias`, `slugifyCapabilityName`
- `shouldStopProviderPass` early termination logic

**System prompt simplified to:**
```
Available skills (metadata only):
- skill_name: skill description
Call load_skill to get full instructions for a skill.

Configured MCP servers:
- server_name (serverId)

Use available tools proactively when they would improve your answer.
```

### Interleaving / Timeline

**SSE events simplified:**

Removed `answer_commit` event. Text accumulates naturally across the entire turn via `answer_delta`. Actions are emitted in chronological order between text segments.

```
Event sequence during a multi-step turn:
1. message_start        -> UI creates streaming bubble
2. thinking_delta       -> thinking animation
3. answer_delta         -> text streams in
4. action_start         -> "Searching web..." card appears inline
5. action_complete      -> card updates with result
6. answer_delta         -> model continues with more text
7. action_start         -> "Loading skill: X" card appears
8. action_complete      -> card updates
9. answer_delta         -> model uses skill content to answer
10. done                -> streaming ends
```

**Persisted timeline:** Always persist `timeline` field on the message by combining text segments and actions sorted by `sortOrder`. The `MessageBubble` already renders `message.timeline` when it exists. Remove the fallback that puts all actions before all text.

**Chat view simplification:** Remove `answer_commit` handling. Remove `localAnswer` reset on commit. `streamTimeline` tracks actions only. Streaming answer text is the final timeline item.

### Error Handling

**Provider doesn't support tools:** Detect via model/provider capabilities. Fall back to text-only mode (no tool calling). Tools are unavailable.

**Tool execution errors:** Return error as tool result message (`role: "tool"`, `content: "Error: ..."`). Model sees the error and can retry or explain. Loop continues.

**Context window overflow:** Truncate large tool results to ~4000 tokens before adding to prompt. Existing step limit (16 steps) still applies.

**Empty response:** Inject system message asking model to respond directly. Retry once.

**No database migration needed.** Old messages without `timeline` use existing fallback. New messages get `timeline` persisted.

### Files Changed

| File | Change |
|------|--------|
| `lib/provider.ts` | Add `tools` parameter, handle tool_call streaming |
| `lib/assistant-runtime.ts` | Full rewrite of agentic loop |
| `lib/control-output.ts` | Remove |
| `lib/types.ts` | Add `ToolDefinition`, `ProviderToolCall` types; remove `answer_commit` event |
| `components/chat-view.tsx` | Simplify SSE handling, Remove `answer_commit` logic |
| `components/message-bubble.tsx` | Remove streaming content item appended at end |
| `app/api/conversations/[conversationId]/chat/route.ts` | Update to build tool definitions and handle new event flow |
| `tests/unit/assistant-runtime.test.ts` | Rewrite tests for new function-calling approach |
| `tests/unit/message-bubble.test.ts` | Update timeline rendering tests |

### What Stays the Same

- Skill metadata parsing (`skill-metadata.ts`)
- MCP client tool calling (`mcp-client.ts`)
- Local shell execution (`local-shell.ts`)
- Database schema (no migration)
- MessageBubble timeline rendering logic
- SSE transport mechanism
- Compaction system
- Token estimation
