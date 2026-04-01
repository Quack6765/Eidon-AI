# Native Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace text-based control markers with native OpenAI function calling for reliable, multi-step tool use.

**Architecture:** The provider accepts `tools` parameter and returns structured `tool_calls`. The runtime loop executes tool calls and feeds results back as `tool` role messages. No text parsing or guarded emitter.

**Tech Stack:** TypeScript, Next.js, OpenAI SDK (Responses API + Chat Completions), Vitest

---

### Task 1: Add new types to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts:256-272`
- Test: `tests/unit/assistant-runtime.test.ts` (will be rewritten later)

- [ ] **Step 1: Add `ToolDefinition` and `ProviderToolCall` types, remove `answer_commit` event**

In `lib/types.ts`, add these new types after the existing `PromptMessage` type (around line 305):

```typescript
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters?: {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type ProviderToolCall = {
  id: string;
  name: string;
  arguments: string;
};
```

Then extend `PromptMessage` to support the `"tool"` role and `toolCalls` on assistant messages. The current type is:

```typescript
export type PromptMessage = {
  role: "system" | "user" | "assistant";
  content: string | PromptContentPart[];
};
```

Change it to:

```typescript
export type PromptMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | PromptContentPart[];
  toolCallId?: string;
  toolCalls?: ProviderToolCall[];
};
```

The `toolCallId` field is required on `role: "tool"` messages (it links the result to the request). The `toolCalls` field is set on `role: "assistant"` messages that include function calls. Both are optional so existing code that creates system/user/assistant messages doesn't need changes.

Then modify `ChatStreamEvent` to remove `answer_commit`. Delete the line:

```typescript
// REMOVE this line:
// | { type: "answer_commit"; text: string }
```

The `ChatStreamEvent` type already has `action_start`, `action_complete`, `action_error` — those stay.

- [ ] **Step 2: Run typecheck to verify no compile errors yet**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in files that reference `answer_commit` — this is expected. We'll fix them in later tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add ToolDefinition and ProviderToolCall types, remove answer_commit event"
```

---

### Task 2: Update `lib/provider.ts` to accept and stream tool calls

**Files:**
- Modify: `lib/provider.ts:224-374`

This is the core provider change. We add a `tools` parameter to `streamProviderResponse`, handle tool call streaming events, and include `toolCalls` in the return value.

- [ ] **Step 1: Add `tools` parameter to the function signature**

In `lib/provider.ts`, change the `streamProviderResponse` function signature (line 224) to accept tools:

```typescript
export async function* streamProviderResponse(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  tools?: ToolDefinition[];
}): AsyncGenerator<
  ChatStreamEvent,
  { answer: string; thinking: string; toolCalls?: ProviderToolCall[]; usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } },
  void
>
```

Add the import at top of file:

```typescript
import type { ToolDefinition, ProviderToolCall } from "@/lib/types";
```

- [ ] **Step 2: Update `buildResponsesInput` to handle tool role messages**

The current `buildResponsesInput` maps messages to `input_text`/`input_image` content parts. Tool messages and assistant messages with `toolCalls` need special handling.

For the **Responses API**, tool results need to be provided as function call outputs. The Responses API doesn't use a `tool` role message directly. Instead, you provide the function call result via a different mechanism. Update `buildResponsesInput` to handle `role: "tool"` and `toolCalls`:

```typescript
function buildResponsesInput(messages: PromptMessage[]) {
  const input: unknown[] = [];

  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      });
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          call_id: toolCall.id
        });
      }
      // Also include any text content
      if (typeof message.content === "string" && message.content.trim()) {
        input.push({ role: "assistant", content: toResponseContentParts(message.content) });
      }
      continue;
    }

    input.push({
      role: message.role,
      content: toResponseContentParts(message.content)
    });
  }

  return input;
}
```

For **Chat Completions API**, the `tool` role and `tool_calls` on assistant messages are part of the standard format. Update `buildChatCompletionMessages`:

```typescript
function buildChatCompletionMessages(messages: PromptMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: message.toolCallId,
        content: typeof message.content === "string" ? message.content : message.content.map(p => "text" in p ? p.text : "").join("")
      };
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: typeof message.content === "string" && message.content.trim() ? message.content : null,
        tool_calls: message.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments }
        }))
      };
    }

    return {
      role: message.role,
      content: toChatCompletionContentParts(message.content)
    };
  });
}
```

- [ ] **Step 3: Pass tools to both API modes**

For the **Responses API** path (line ~247), add `tools` to the `client.responses.create` call:

```typescript
const createOptions: Record<string, unknown> = {
  model: settings.model,
  input: buildResponsesInput(promptMessages),
  stream: true,
  temperature: settings.temperature,
  max_output_tokens: settings.maxOutputTokens,
  reasoning
};

if (input.tools?.length) {
  createOptions.tools = input.tools.map((tool) => ({
    type: "function" as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters
  }));
}

const stream = await client.responses.create(createOptions, {
  signal: abortController.signal
});
```

For the **Chat Completions API** path (line ~319), add `tools` to the `client.chat.completions.create` call:

```typescript
const createOptions: Record<string, unknown> = {
  model: settings.model,
  messages: buildChatCompletionMessages(promptMessages),
  stream: true,
  temperature: settings.temperature,
  max_completion_tokens: settings.maxOutputTokens,
  ...buildChatCompletionsOptions(settings)
};

if (input.tools?.length) {
  createOptions.tools = input.tools;
}

const stream = await client.chat.completions.create(createOptions, {
  signal: abortController.signal
});
```

- [ ] **Step 3: Handle tool call streaming events**

For **Responses API**, inside the `for await (const event of stream)` loop, add handling for function call events:

```typescript
if (event.type === "response.function_call_arguments.delta") {
  const deltaEvent = event as { delta?: string; item_id?: string };
  // Accumulate - we'll process when the function call item is done
}
```

Add a `toolCalls` accumulator at the top of the Responses API block:

```typescript
const pendingToolCalls = new Map<string, { name: string; arguments: string }>();
```

Then handle `response.output_item.done` for function calls:

```typescript
if (event.type === "response.output_item.done") {
  const item = event.item as {
    type?: string;
    name?: string;
    arguments?: string;
    call_id?: string;
    summary?: Array<{ text?: string }>;
  };

  if (item.type === "function_call" && item.call_id) {
    pendingToolCalls.set(item.call_id, {
      name: item.name ?? "",
      arguments: item.arguments ?? ""
    });
  }

  // Keep existing reasoning summary handling...
}
```

For **Chat Completions API**, inside the `for await (const chunk of stream)` loop, add tool call handling:

```typescript
const toolCallChunks = new Map<string, { name: string; arguments: string }>();

// Inside the loop:
if (rawDelta.tool_calls) {
  for (const toolCallChunk of rawDelta.tool_calls) {
    const existing = toolCallChunks.get(toolCallChunk.index);
    if (!existing) {
      toolCallChunks.set(toolCallChunk.index, {
        name: toolCallChunk.function?.name ?? "",
        arguments: toolCallChunk.function?.arguments ?? ""
      });
    } else {
      if (toolCallChunk.function?.name) {
        existing.name = toolCallChunk.function.name;
      }
      if (toolCallChunk.function?.arguments) {
        existing.arguments += toolCallChunk.function.arguments;
      }
    }
  }
}
```

- [ ] **Step 4: Include toolCalls in the return value**

Both API paths need to include tool calls in their return. After the stream ends, before yielding usage:

For **Responses API**, before the final `return`:

```typescript
const toolCalls: ProviderToolCall[] = [];
for (const [id, call] of pendingToolCalls) {
  toolCalls.push({ id, name: call.name, arguments: call.arguments });
}
```

For **Chat Completions API**, before the final `return`:

```typescript
const toolCalls: ProviderToolCall[] = [];
for (const [, call] of toolCallChunks) {
  toolCalls.push({ id: `call_${toolCalls.length}`, name: call.name, arguments: call.arguments });
}
```

Both return blocks change from `{ answer, thinking, usage }` to `{ answer, thinking, toolCalls: toolCalls.length ? toolCalls : undefined, usage }`.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in `assistant-runtime.ts` because the return type shape changed. This is expected.

- [ ] **Step 6: Commit**

```bash
git add lib/provider.ts
git commit -m "feat: provider accepts tools parameter and returns structured tool calls"
```

---

### Task 3: Rewrite `lib/assistant-runtime.ts` agentic loop

**Files:**
- Modify: `lib/assistant-runtime.ts` (full rewrite)

This is the largest change. The file goes from ~1000 lines of text-marker parsing to ~400 lines of clean function-calling logic.

- [ ] **Step 1: Write the new `buildToolDefinitions` function**

This creates OpenAI tool definitions from MCP tools, skills, and shell capabilities:

```typescript
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { executeLocalShellCommand, summarizeShellResult, type ShellCallPayload } from "@/lib/local-shell";
import { callMcpTool, summarizeToolResult } from "@/lib/mcp-client";
import { streamProviderResponse } from "@/lib/provider";
import { MAX_ASSISTANT_CONTROL_STEPS } from "@/lib/constants";
import type {
  ChatStreamEvent,
  McpServer,
  McpTool,
  MessageActionKind,
  ProviderProfileWithApiKey,
  ProviderToolCall,
  PromptMessage,
  Skill,
  ToolDefinition
} from "@/lib/types";

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
};

type ToolSet = {
  server: McpServer;
  tools: McpTool[];
};

type RuntimeAction = {
  kind: MessageActionKind;
  label: string;
  detail?: string;
  serverId?: string | null;
  skillId?: string | null;
  toolName?: string | null;
  arguments?: Record<string, unknown> | null;
};

function sanitizeForFunctionName(value: string) {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function mcpToolFunctionName(serverId: string, toolName: string) {
  return `mcp_${sanitizeForFunctionName(serverId)}_${toolName}`;
}

function getSkillResolvedName(skill: Skill) {
  return parseSkillContentMetadata(skill.content).name?.trim() || skill.name;
}

function getSkillResolvedDescription(skill: Skill) {
  return parseSkillContentMetadata(skill.content).description?.trim() || skill.description;
}

function getSkillAllowedCommandPrefixes(skill: Skill) {
  return parseSkillContentMetadata(skill.content).shellCommandPrefixes;
}

function getToolLabel(tool: McpTool) {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}

function addUsage(total: Usage, next: Usage) {
  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    reasoningTokens: (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0)
  };
}

function buildArgumentsSummary(args: Record<string, unknown> | null | undefined) {
  if (!args || !Object.keys(args).length) return "";
  const firstScalar = Object.entries(args).find(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  if (firstScalar) return `${firstScalar[0]}=${String(firstScalar[1])}`;
  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

function buildShellDetail(command: string) {
  return command.length > 140 ? `${command.slice(0, 137)}...` : command;
}
```

- [ ] **Step 2: Write `buildToolDefinitions`**

```typescript
function buildToolDefinitions(input: {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  shellCommandPrefixes: string[];
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const { server, tools: mcpTools } of input.mcpToolSets) {
    for (const tool of mcpTools) {
      tools.push({
        type: "function",
        function: {
          name: mcpToolFunctionName(server.id, tool.name),
          description: [
            tool.annotations?.title ?? tool.name,
            tool.description,
            tool.annotations?.readOnlyHint ? "(read-only)" : undefined
          ].filter(Boolean).join(" — "),
          parameters: (tool.inputSchema as ToolDefinition["function"]["parameters"]) ?? { type: "object", properties: {} }
        }
      });
    }
  }

  if (input.skills.length) {
    tools.push({
      type: "function",
      function: {
        name: "load_skill",
        description: `Load the full content and instructions of a skill. Available: ${input.skills.map((s) => getSkillResolvedName(s)).join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            skill_name: { type: "string", description: "Name of the skill to load" }
          },
          required: ["skill_name"]
        }
      }
    });
  }

  if (input.shellCommandPrefixes.length) {
    tools.push({
      type: "function",
      function: {
        name: "execute_shell_command",
        description: `Execute a local shell command. Allowed prefixes: ${input.shellCommandPrefixes.join(", ")}`,
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The command to execute" },
            timeout_ms: { type: "number", description: "Timeout in milliseconds (default 30000)" }
          },
          required: ["command"]
        }
      }
    });
  }

  return tools;
}
```

- [ ] **Step 3: Write `buildCapabilitiesSystemMessage`**

Replaces the old `buildCapabilitiesMessage`:

```typescript
function buildCapabilitiesSystemMessage(skills: Skill[], mcpServers: McpServer[]) {
  const lines: string[] = [];

  if (skills.length) {
    lines.push("Available skills (metadata only — call load_skill to get full instructions):");
    for (const skill of skills) {
      lines.push(`- ${getSkillResolvedName(skill)}: ${getSkillResolvedDescription(skill)}`);
    }
  }

  if (mcpServers.length) {
    lines.push("", "Configured MCP servers:");
    for (const server of mcpServers) {
      lines.push(`- ${server.name} (${server.id})`);
    }
  }

  lines.push("", "Use available tools proactively when they would improve your answer.");

  return lines.join("\n");
}
```

- [ ] **Step 4: Write `mergeSystemMessage` helper**

```typescript
function mergeSystemMessage(promptMessages: PromptMessage[], content: string): PromptMessage[] {
  const systemIndex = promptMessages.findIndex((m) => m.role === "system");
  if (systemIndex === -1) return [{ role: "system", content }, ...promptMessages];
  return promptMessages.map((m, i) => i === systemIndex ? { ...m, content: `${m.content}\n\n${content}` } : m);
}
```

- [ ] **Step 5: Write the tool execution handlers**

```typescript
function buildToolResultMessage(toolCallId: string, content: string) {
  return {
    role: "tool" as const,
    toolCallId,
    content
  };
}

function buildMcpToolResultForPrompt(input: {
  server: McpServer;
  tool: McpTool;
  args: Record<string, unknown>;
  resultSummary: string;
  isError: boolean;
}) {
  return [
    `MCP tool result`,
    `Server: ${input.server.name} (${input.server.id})`,
    `Tool: ${input.tool.name}`,
    `Arguments: ${JSON.stringify(input.args)}`,
    `Status: ${input.isError ? "error" : "success"}`,
    "Result:",
    input.resultSummary
  ].join("\n");
}

function buildShellResultForPrompt(input: { command: string; resultSummary: string; isError: boolean }) {
  return [
    "Local shell command result",
    `Command: ${input.command}`,
    `Status: ${input.isError ? "error" : "success"}`,
    "Result:",
    input.resultSummary
  ].join("\n");
}
```

- [ ] **Step 6: Write the main `resolveAssistantTurn` function**

```typescript
export async function resolveAssistantTurn(input: {
  settings: ProviderProfileWithApiKey;
  promptMessages: PromptMessage[];
  skills: Skill[];
  mcpServers?: McpServer[];
  mcpToolSets: ToolSet[];
  onEvent?: (event: ChatStreamEvent) => void;
  onAnswerSegment?: (segment: string) => Promise<void> | void;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
  onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
}) {
  const mcpServers = input.mcpServers ?? input.mcpToolSets.map((e) => e.server);
  const loadedSkillIds = new Set<string>();
  const allShellPrefixes: string[] = [];
  let totalUsage: Usage = {};

  let promptMessages = input.skills.length || mcpServers.length || input.mcpToolSets.length
    ? mergeSystemMessage(input.promptMessages, buildCapabilitiesSystemMessage(input.skills, mcpServers))
    : input.promptMessages;

  let timelineSortOrder = 0;

  const commitAnswerSegment = async (segment: string) => {
    if (!segment) return;
    if (input.onAnswerSegment) {
      await input.onAnswerSegment(segment);
    }
  };

  for (let step = 0; step < MAX_ASSISTANT_CONTROL_STEPS; step += 1) {
    const tools = buildToolDefinitions({
      mcpToolSets: input.mcpToolSets,
      skills: input.skills,
      loadedSkillIds,
      shellCommandPrefixes: allShellPrefixes
    });

    const providerStream = streamProviderResponse({
      settings: input.settings,
      promptMessages,
      tools: tools.length ? tools : undefined
    });

    let answer = "";
    let thinking = "";
    let usage: Usage = {};
    let toolCalls: ProviderToolCall[] = [];

    while (true) {
      const next = await providerStream.next();
      if (next.done) {
        answer = next.value.answer;
        thinking = next.value.thinking;
        usage = next.value.usage;
        toolCalls = next.value.toolCalls ?? [];
        totalUsage = addUsage(totalUsage, usage);
        break;
      }
      input.onEvent?.(next.value);
    }

    if (!toolCalls.length) {
      if (!answer.trim() && step > 0) {
        promptMessages = mergeSystemMessage(promptMessages, "Your previous response was empty after using tools. Answer the user directly. Do not emit an empty response.");
        continue;
      }
      await commitAnswerSegment(answer);
      return { answer, thinking, usage: totalUsage };
    }

    if (answer) {
      await commitAnswerSegment(answer);
    }

    for (const toolCall of toolCalls) {
      const result = await executeToolCall(toolCall, {
        input,
        mcpServers,
        loadedSkillIds,
        allShellPrefixes,
        timelineSortOrder,
        promptMessages
      });

      timelineSortOrder = result.nextSortOrder;
      promptMessages = result.promptMessages;
    }
  }

  throw new Error("Assistant exceeded the maximum number of tool steps");
}
```

- [ ] **Step 7: Write `executeToolCall` dispatcher**

```typescript
async function executeToolCall(
  toolCall: ProviderToolCall,
  context: {
    input: Parameters<typeof resolveAssistantTurn>[0];
    mcpServers: McpServer[];
    loadedSkillIds: Set<string>;
    allShellPrefixes: string[];
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  const { toolCallId, name, arguments: argsJson } = toolCall;
  const args = JSON.parse(argsJson) as Record<string, unknown>;

  if (name === "load_skill") {
    return executeLoadSkill(toolCallId, args, context);
  }

  if (name === "execute_shell_command") {
    return executeShellCommand(toolCallId, args, context);
  }

  if (name.startsWith("mcp_")) {
    return executeMcpToolCall(toolCallId, name, args, context);
  }

  const resultMsg = buildToolResultMessage(toolCallId, `Unknown tool: ${name}`);
  return {
    nextSortOrder: context.timelineSortOrder,
    promptMessages: [...context.promptMessages, resultMsg]
  };
}
```

- [ ] **Step 8: Write `executeMcpToolCall`**

```typescript
async function executeMcpToolCall(
  toolCallId: string,
  functionName: string,
  args: Record<string, unknown>,
  context: {
    input: Parameters<typeof resolveAssistantTurn>[0];
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  let sortOrder = context.timelineSortOrder;

  // Parse server ID and tool name from function name: mcp_{serverId}_{toolName}
  const withoutPrefix = functionName.slice(4);
  const toolSets = context.input.mcpToolSets;
  let resolvedServer: McpServer | null = null;
  let resolvedTool: McpTool | null = null;

  for (const { server, tools } of toolSets) {
    const candidateName = mcpToolFunctionName(server.id, tools[0]?.name ?? "");
    if (withoutPrefix.startsWith(sanitizeForFunctionName(server.id) + "_")) {
      const toolName = withoutPrefix.slice(sanitizeForFunctionName(server.id).length + 1);
      const tool = tools.find((t) => t.name === toolName);
      if (tool) {
        resolvedServer = server;
        resolvedTool = tool;
        break;
      }
    }
  }

  if (!resolvedServer || !resolvedTool) {
    const resultMsg = buildToolResultMessage(toolCallId, "The requested MCP tool is unavailable in the current tool mode or does not exist.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "mcp_tool_call",
    label: getToolLabel(resolvedTool),
    detail: buildArgumentsSummary(args),
    serverId: resolvedServer.id,
    toolName: resolvedTool.name,
    arguments: args
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  const result = await callMcpTool(resolvedServer, resolvedTool.name, args);
  const resultSummary = summarizeToolResult(result);

  sortOrder += 1;

  if (result.isError) {
    await context.input.onActionError?.(actionHandle, { detail: buildArgumentsSummary(args), resultSummary });
  } else {
    await context.input.onActionComplete?.(actionHandle, { detail: buildArgumentsSummary(args), resultSummary });
  }

  const resultText = buildMcpToolResultForPrompt({
    server: resolvedServer,
    tool: resolvedTool,
    args,
    resultSummary,
    isError: Boolean(result.isError)
  });

  const resultMsg = buildToolResultMessage(toolCallId, resultText);
  return {
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, resultMsg]
  };
}
```

- [ ] **Step 9: Write `executeLoadSkill`**

```typescript
async function executeLoadSkill(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: Parameters<typeof resolveAssistantTurn>[0];
    loadedSkillIds: Set<string>;
    allShellPrefixes: string[];
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  let sortOrder = context.timelineSortOrder;
  const skillName = String(args.skill_name ?? "").trim().toLowerCase();

  const skill = context.input.skills.find(
    (s) => (parseSkillContentMetadata(s.content).name?.trim() || s.name).toLowerCase() === skillName
  );

  if (!skill || context.loadedSkillIds.has(skill.id)) {
    const resultMsg = buildToolResultMessage(
      toolCallId,
      skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${context.input.skills.map((s) => getSkillResolvedName(s)).join(", ")}`
    );
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  context.loadedSkillIds.add(skill.id);

  const shellPrefixes = getSkillAllowedCommandPrefixes(skill);
  if (shellPrefixes.length) {
    context.allShellPrefixes.push(...shellPrefixes);
  }

  const handle = await context.input.onActionStart?.({
    kind: "skill_load",
    label: "Load skill",
    detail: getSkillResolvedName(skill),
    skillId: skill.id
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  await context.input.onActionComplete?.(actionHandle, {
    detail: getSkillResolvedName(skill),
    resultSummary: "Skill instructions loaded."
  });

  sortOrder += 1;

  let skillContent = [
    `Skill loaded: ${getSkillResolvedName(skill)}`,
    `Description: ${getSkillResolvedDescription(skill)}`,
    "",
    skill.content
  ].join("\n");

  if (shellPrefixes.length) {
    skillContent += `\n\nLocal host command execution enabled. Allowed prefixes: ${shellPrefixes.join(", ")}`;
  }

  const resultMsg = buildToolResultMessage(toolCallId, skillContent);
  return {
    nextSortOrder: sortOrder,
    promptMessages: [...context.promptMessages, resultMsg]
  };
}
```

- [ ] **Step 10: Write `executeShellCommand`**

```typescript
async function executeShellCommand(
  toolCallId: string,
  args: Record<string, unknown>,
  context: {
    input: Parameters<typeof resolveAssistantTurn>[0];
    allShellPrefixes: string[];
    timelineSortOrder: number;
    promptMessages: PromptMessage[];
  }
) {
  let sortOrder = context.timelineSortOrder;
  const command = String(args.command ?? "").trim();
  const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : undefined;

  if (!command) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: Shell command is required.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  if (!context.allShellPrefixes.length) {
    const resultMsg = buildToolResultMessage(toolCallId, "Error: No loaded skill currently permits local shell commands.");
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }

  const handle = await context.input.onActionStart?.({
    kind: "shell_command",
    label: "Local command",
    detail: buildShellDetail(command),
    arguments: { command, timeoutMs }
  });
  const actionHandle = typeof handle === "string" ? handle : undefined;

  try {
    const result = await executeLocalShellCommand({
      command,
      allowedPrefixes: context.allShellPrefixes,
      timeoutMs
    });
    const resultSummary = summarizeShellResult(result);

    sortOrder += 1;

    if (result.isError) {
      await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary });
    } else {
      await context.input.onActionComplete?.(actionHandle, { detail: buildShellDetail(command), resultSummary });
    }

    const resultText = buildShellResultForPrompt({ command, resultSummary, isError: result.isError });
    const resultMsg = buildToolResultMessage(toolCallId, resultText);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shell command execution failed";
    await context.input.onActionError?.(actionHandle, { detail: buildShellDetail(command), resultSummary: message });
    const resultMsg = buildToolResultMessage(toolCallId, `Error: ${message}`);
    return { nextSortOrder: sortOrder, promptMessages: [...context.promptMessages, resultMsg] };
  }
}
```

- [ ] **Step 11: Delete `lib/control-output.ts`**

```bash
rm lib/control-output.ts
```

- [ ] **Step 12: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in `chat-view.tsx` (references `answer_commit`) and `skill-runtime.ts` (references `control-output`). We'll fix those next.

- [ ] **Step 13: Commit**

```bash
git add lib/assistant-runtime.ts && git rm lib/control-output.ts
git commit -m "feat: rewrite agentic loop with native function calling"
```

---

### Task 4: Update `lib/skill-runtime.ts` to remove guarded emitter dependency

**Files:**
- Modify: `lib/skill-runtime.ts`

`skill-runtime.ts` currently imports `createGuardedAnswerEmitter` from `control-output.ts` (which we deleted). It also uses the old text-marker approach for skill loading. Since the runtime now uses native function calling, this file needs to be simplified.

- [ ] **Step 1: Remove guarded emitter usage from `resolveAssistantWithSkills`**

The function `resolveAssistantWithSkills` in `skill-runtime.ts` uses `createGuardedAnswerEmitter` and text-based `SKILL_REQUEST` markers. This function is only used for the standalone skill resolution path (without tool calling). We need to either:

a) Remove this function entirely if it's not called elsewhere, or
b) Simplify it to work without the guarded emitter.

Check if `resolveAssistantWithSkills` is used anywhere:

Run: `grep -r "resolveAssistantWithSkills" --include="*.ts" --include="*.tsx" lib/ components/ app/`

If it's unused (likely, since `assistant-runtime.ts` has the main `resolveAssistantTurn`), remove it and the guarded emitter import.

If it IS used, simplify it to not use the guarded emitter — just pass through events directly.

Also remove the `buildSkillsMetadataMessage` and `buildLoadedSkillsMessage` functions since the system prompt is now built by `buildCapabilitiesSystemMessage` in `assistant-runtime.ts`.

**Keep only** the functions still referenced elsewhere: `getSkillResolvedName`, `getSkillResolvedDescription`, `getSkillAllowedCommandPrefixes`, `extractSkillRequest`, `normalizeSkillName`, and `buildLoadedSkillsMessage`. Check each with grep before removing.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Fewer errors than before. Remaining errors should be in `chat-view.tsx`.

- [ ] **Step 3: Commit**

```bash
git add lib/skill-runtime.ts
git commit -m "refactor: remove guarded emitter from skill-runtime"
```

---

### Task 5: Update `components/chat-view.tsx` to remove `answer_commit` handling

**Files:**
- Modify: `components/chat-view.tsx:590-656`

- [ ] **Step 1: Remove `answer_commit` event handling**

In the `parsed.events.forEach` callback (around line 610), remove the `answer_commit` block:

```typescript
// REMOVE this entire block:
if (event.type === "answer_commit") {
  localAnswer = "";
  setStreamTimeline((current) => [
    ...current,
    {
      id: `stream_text_${crypto.randomUUID()}`,
      timelineKind: "text",
      sortOrder: current.length,
      createdAt: new Date().toISOString(),
      content: event.text
    }
  ]);
  setStreamAnswerTarget("");
  setStreamAnswerDisplay("");
}
```

The text now accumulates via `answer_delta` across the entire turn without commits. The streaming answer is always the last timeline item.

- [ ] **Step 2: Simplify `answer_delta` handling**

The current `answer_delta` handler (around line 600) is fine as-is — it accumulates `localAnswer` and sets `streamAnswerTarget`. No changes needed there.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No more type errors from `answer_commit` removal.

- [ ] **Step 4: Commit**

```bash
git add components/chat-view.tsx
git commit -m "refactor: remove answer_commit handling from chat view"
```

---

### Task 6: Update `components/message-bubble.tsx` to simplify streaming content rendering

**Files:**
- Modify: `components/message-bubble.tsx:253-273`

- [ ] **Step 1: Remove the streaming content item that appends at end of timeline**

In `MessageBubble`, around lines 255-267, there's code that appends a streaming content item at the end of the timeline when both `message.timeline` exists and `streamingAnswer` is present:

```typescript
// REMOVE this block:
...(message.role === "assistant" && message.timeline && streamingAnswer !== undefined && rawContent
  ? [
      {
        id: `stream_content_${message.id}`,
        timelineKind: "text" as const,
        sortOrder: baseTimeline.length,
        createdAt: message.createdAt,
        content: rawContent
      }
    ]
  : [])
```

Since text now accumulates across the entire turn without commits, the streaming answer is always the final display. The `StreamingPlaceholder` already passes the answer text via `streamingAnswer`, and the `rawContent` calculation (`streamingAnswer ?? message.content`) handles it. The timeline in the streaming case is actions-only, and the text appears after the timeline.

Instead, after the timeline items, render the streaming answer text (if any) as a separate bubble:

The existing rendering logic at line 509 already handles `timeline.length` — if timeline has items, it renders them. The streaming answer text is passed separately via `streamingAnswer` which becomes `rawContent`. When there ARE timeline items AND streaming text, we need to show both.

The simplest approach: keep the current structure but change the streaming content append logic. When streaming, the answer text is NOT in the timeline — it's the `rawContent`. The timeline only has actions. So the rendering should show: timeline items (actions) + final text bubble.

This is already what the code does for the non-streaming case (fallback puts actions then text). For the streaming case, just make sure the text bubble appears after the action cards. No special logic needed — the existing rendering handles it.

- [ ] **Step 2: Verify rendering with existing tests**

Run: `npx vitest run tests/unit/message-bubble.test.ts`
Expected: All existing tests pass (they test persisted messages with timeline and actions, not the removed streaming content append).

- [ ] **Step 3: Commit**

```bash
git add components/message-bubble.tsx
git commit -m "refactor: simplify streaming content rendering in message bubble"
```

---

### Task 7: Update the chat API route

**Files:**
- Modify: `app/api/conversations/[conversationId]/chat/route.ts:134-206`

- [ ] **Step 1: Remove `answer_commit` event emission**

The `onAnswerSegment` callback (line 141) currently emits an `answer_commit` SSE event. Change it to just persist the text segment without emitting a commit event:

```typescript
onAnswerSegment(segment) {
  createMessageTextSegment({
    messageId: assistantMessage.id,
    content: segment,
    sortOrder: timelineSortOrder++
  });
},
```

The event emission for `answer_commit` is removed. Text segments are still persisted for the saved message's timeline.

- [ ] **Step 2: Verify the route still compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/conversations
git commit -m "refactor: remove answer_commit emission from chat route"
```

---

### Task 8: Rewrite `tests/unit/assistant-runtime.test.ts`

**Files:**
- Modify: `tests/unit/assistant-runtime.test.ts` (full rewrite)

The existing tests use text-based markers (`SKILL_REQUEST:`, `TOOL_CALL:`, `SHELL_CALL:`) and the guarded emitter pattern. They need to be rewritten for native function calling.

- [ ] **Step 1: Update test helper `createProviderStream` to include `toolCalls`**

Change the return type to support tool calls:

```typescript
function createProviderStream(
  events: ChatStreamEvent[],
  result: {
    answer: string;
    thinking: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    usage: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  }
) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
    return {
      answer: result.answer,
      thinking: result.thinking,
      toolCalls: result.toolCalls,
      usage: result.usage
    };
  })();
}
```

- [ ] **Step 2: Rewrite the skill loading test**

Replace the `SKILL_REQUEST` marker with a native `load_skill` tool call:

```typescript
it("loads skills via native function calling before returning the final answer", async () => {
  streamProviderResponse
    .mockReturnValueOnce(
      createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{ id: "call_1", name: "load_skill", arguments: JSON.stringify({ skill_name: "Release Notes" }) }],
        usage: { inputTokens: 10 }
      })
    )
    .mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Done" }], {
        answer: "Done",
        thinking: "",
        usage: { inputTokens: 20, outputTokens: 1 }
      })
    );

  const started: Array<{ kind: string; label: string; detail?: string }> = [];
  const completed: Array<{ handle?: string; resultSummary?: string }> = [];
  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

  const result = await resolveAssistantTurn({
    settings: createSettings(),
    promptMessages: [{ role: "user", content: "Write release notes" }],
    skills: [createSkill()],
    mcpToolSets: [],
    onEvent: () => {},
    onActionStart: (action) => { started.push(action); return "act_skill"; },
    onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
  });

  expect(streamProviderResponse).toHaveBeenCalledTimes(2);
  expect(started).toEqual([expect.objectContaining({ kind: "skill_load", label: "Load skill", detail: "Release Notes" })]);
  expect(completed).toEqual([{ handle: "act_skill", resultSummary: "Skill instructions loaded." }]);
  expect(result.answer).toBe("Done");
});
```

- [ ] **Step 3: Rewrite the MCP tool call test**

Replace `TOOL_CALL:` marker with native tool call:

```typescript
it("executes MCP tool calls via native function calling", async () => {
  streamProviderResponse
    .mockReturnValueOnce(
      createProviderStream([], {
        answer: "",
        thinking: "",
        toolCalls: [{ id: "call_1", name: "mcp_mcp_docs_search_docs", arguments: JSON.stringify({ query: "MCP" }) }],
        usage: { inputTokens: 9 }
      })
    )
    .mockReturnValueOnce(
      createProviderStream([{ type: "answer_delta", text: "Final answer" }], {
        answer: "Final answer",
        thinking: "",
        usage: { inputTokens: 11, outputTokens: 3 }
      })
    );
  callMcpTool.mockResolvedValue({ content: [{ type: "text", text: "Found MCP docs" }] });

  const started: Array<{ label: string; detail?: string; serverId?: string | null }> = [];
  const completed: Array<{ handle?: string; resultSummary?: string }> = [];
  const { resolveAssistantTurn } = await import("@/lib/assistant-runtime");

  const result = await resolveAssistantTurn({
    settings: createSettings(),
    promptMessages: [{ role: "user", content: "Find MCP docs" }],
    skills: [],
    mcpToolSets: [{
      server: { id: "mcp_docs", name: "Docs", url: "https://mcp.example.com", headers: {}, transport: "streamable_http", command: null, args: null, env: null, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      tools: [{ name: "search_docs", title: "Search docs", description: "Search docs", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }]
    }],
    onEvent: () => {},
    onActionStart: (action) => { started.push(action); return "act_tool"; },
    onActionComplete: (handle, patch) => { completed.push({ handle, resultSummary: patch.resultSummary }); }
  });

  expect(callMcpTool).toHaveBeenCalledWith(expect.objectContaining({ id: "mcp_docs" }), "search_docs", { query: "MCP" });
  expect(started).toEqual([expect.objectContaining({ label: "Search docs", serverId: "mcp_docs" })]);
  expect(completed).toEqual([{ handle: "act_tool", resultSummary: "Found MCP docs" }]);
  expect(result.answer).toBe("Final answer");
});
```

- [ ] **Step 4: Rewrite remaining tests**

Adapt the same pattern for:
- Shell command test (tool call `execute_shell_command`)
- Skill load + shell command combo test
- Tool error test (returns error as tool result message)
- Empty response retry test
- Unknown tool test
- Max steps overflow test
- Streaming thinking/answer test (no tool calls, just text)
- "Answer between tool calls" test — verify the model's text (`answer`) gets committed before tool execution

Remove tests that tested the text-marker parsing/guarded emitter behavior:
- "does not leak trailing tool-call control text after visible prose" — no longer applicable
- "does not leak trailing shell-call control text after visible prose" — no longer applicable
- "does not leak tool-call control text while the first pass is still unresolved" — no longer applicable
- "injects a unified capability inventory" — remove automatic response, let model answer
- "uses Exa automatically" — remove automatic keyword-triggered tool calls
- "uses Exa automatically for availability" — remove automatic follow-up tool calls
- "auto-loads the most relevant skill" — remove automatic skill loading

These automatic behaviors are replaced by the model deciding via function calling.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/assistant-runtime.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/assistant-runtime.test.ts
git commit -m "test: rewrite assistant-runtime tests for native function calling"
```

---

### Task 9: Update `tests/unit/message-bubble.test.ts`

**Files:**
- Modify: `tests/unit/message-bubble.test.ts`

- [ ] **Step 1: Remove `answer_commit`-related test expectations**

Scan the test file for any assertions about `answer_commit`. There shouldn't be any direct ones, but verify the timeline rendering tests still work correctly with the changes from Task 6.

Run: `npx vitest run tests/unit/message-bubble.test.ts`
Expected: All tests pass.

- [ ] **Step 2: Add a test for streaming with interleaved actions**

Add a new test that verifies the `StreamingPlaceholder` renders action cards and text correctly:

```typescript
it("renders streaming actions before the streaming answer text", () => {
  const { container } = render(
    React.createElement(StreamingPlaceholder, {
      createdAt: new Date().toISOString(),
      thinking: "",
      answer: "Here are the results.",
      awaitingFirstToken: false,
      thinkingInProgress: false,
      timeline: [
        {
          id: "act_done",
          messageId: "msg_streaming",
          timelineKind: "action",
          kind: "mcp_tool_call",
          status: "completed",
          serverId: "mcp_exa",
          skillId: null,
          toolName: "web_search_exa",
          label: "Web search",
          detail: "query=test",
          arguments: { query: "test" },
          resultSummary: "Found results",
          sortOrder: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString()
        }
      ]
    })
  );

  expect(screen.getByText("Web search")).toBeInTheDocument();
  expect(screen.getByText("Here are the results.")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/unit/message-bubble.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/message-bubble.test.ts
git commit -m "test: update message-bubble tests for new streaming model"
```

---

### Task 10: Full typecheck and test run

**Files:**
- All modified files

- [ ] **Step 1: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run linting**

Run: `npx eslint lib/assistant-runtime.ts lib/provider.ts components/chat-view.tsx components/message-bubble.tsx lib/skill-runtime.ts lib/types.ts`
Expected: No errors.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: fix lint issues from native tool calling migration"
```

---

### Task 11: Clean up dead exports

**Files:**
- `lib/skill-runtime.ts`
- `lib/mcp-client.ts`

- [ ] **Step 1: Check for unused exports**

Run:
```bash
grep -r "buildMcpToolsDescription" --include="*.ts" --include="*.tsx" lib/ components/ app/
grep -r "buildSkillsMetadataMessage" --include="*.ts" --include="*.tsx" lib/ components/ app/
grep -r "buildLoadedSkillsMessage" --include="*.ts" --include="*.tsx" lib/ components/ app/
grep -r "extractSkillRequest" --include="*.ts" --include="*.tsx" lib/ components/ app/
grep -r "normalizeSkillName" --include="*.ts" --include="*.tsx" lib/ components/ app/
```

Remove any functions that are no longer imported anywhere. These were used by the old text-marker approach.

- [ ] **Step 2: Run tests again**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove unused exports from skill-runtime and mcp-client"
```

---

### Task 12: Manual smoke test

**Files:**
- None (manual verification)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test a simple conversation**

Open the app. Send "Hello". Verify the assistant responds with text.

- [ ] **Step 3: Test MCP tool calling**

Send "Search the web for the latest news about AI". Verify:
- The assistant uses the web search tool via function calling
- An action card appears showing "Web search" with running → completed states
- The assistant's answer follows the action card

- [ ] **Step 4: Test skill loading**

Send "I need help inspecting a website". Verify:
- The assistant calls `load_skill` to load the Agent Browser skill
- A "Load skill: Agent Browser" action card appears
- The assistant can then use the skill

- [ ] **Step 5: Test multi-step tool calling**

Send a complex request that should require multiple tool calls. Verify:
- The agent continues through multiple steps
- Text and action cards are interleaved correctly
- The conversation does NOT reload/refresh until the agent is done

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup after native tool calling migration"
```
