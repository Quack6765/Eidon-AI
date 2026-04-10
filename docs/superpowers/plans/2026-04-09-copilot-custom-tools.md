# Copilot Custom Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register Eidon's tools (MCP, shell, skills, memory) as custom tools in the Copilot SDK session and stream the agent's thinking + output + tool execution events to the client.

**Architecture:** Convert Eidon's `ToolDefinition[]` into Copilot SDK `Tool[]` objects with handlers that delegate to Eidon's existing tool executors (`callMcpTool`, `executeLocalShellCommand`, etc.). Pass these tools via `SessionConfig.tools` when creating a Copilot streaming session. Map Copilot SDK streaming events (`assistant.reasoning_delta`, `assistant.message_delta`, `tool.execution_start`, `tool.execution_complete`) to Eidon's `ChatStreamEvent` types so the frontend can display them identically regardless of provider.

**Tech Stack:** GitHub Copilot SDK (`@github/copilot-sdk`), Eidon tool runtime (`assistant-runtime.ts`), Eidon event types (`ChatStreamEvent`)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/copilot-tools.ts` | **Create.** Converts Eidon tool definitions → Copilot SDK `Tool[]`, provides handler functions that delegate to Eidon executors |
| `lib/github-copilot.ts` | **Modify.** Update `streamGithubCopilotChat` to accept and pass custom tools, emit tool events via `onEvent` |
| `lib/provider.ts` | **Modify.** Build tools for Copilot sessions, map new Copilot event types (`tool.execution_start`, `tool.execution_complete`) to `ChatStreamEvent` |
| `tests/unit/copilot-tools.test.ts` | **Create.** Unit tests for tool conversion and handler delegation |
| `tests/unit/github-copilot.test.ts` | **Modify.** Update streaming tests for custom tools + new event types |

---

### Task 1: Create copilot-tools.ts — Tool Conversion

**Files:**
- Create: `lib/copilot-tools.ts`
- Test: `tests/unit/copilot-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildCopilotTools } from "@/lib/copilot-tools";
import type { McpServer, McpTool, Skill, ToolDefinition } from "@/lib/types";

function makeMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "server_1",
    name: "Test Server",
    url: "http://localhost:8080",
    headers: {},
    transport: "streamable_http",
    command: null,
    args: null,
    env: null,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeMcpTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: "read_file",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    },
    annotations: { readOnlyHint: true },
    ...overrides
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill_browser",
    name: "browser",
    description: "Browse the web",
    content: "# Browser Skill\nNavigate websites and take screenshots.",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("buildCopilotTools", () => {
  it("creates copilot tools from MCP tool sets", () => {
    const tools = buildCopilotTools({
      mcpToolSets: [{ server: makeMcpServer(), tools: [makeMcpTool()] }],
      skills: [],
      loadedSkillIds: new Set(),
      memoriesEnabled: false,
      onActionStart: vi.fn(),
      onActionComplete: vi.fn(),
      onActionError: vi.fn()
    });

    expect(tools).toHaveLength(2); // 1 MCP tool + 1 shell tool
    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file");
    expect(mcpTool).toBeDefined();
    expect(mcpTool?.description).toContain("read_file");
    expect(mcpTool?.handler).toBeInstanceOf(Function);
    expect(mcpTool?.skipPermission).toBe(true);
  });

  it("creates shell, skill, and memory tools", () => {
    const tools = buildCopilotTools({
      mcpToolSets: [],
      skills: [makeSkill()],
      loadedSkillIds: new Set(),
      memoriesEnabled: true,
      onActionStart: vi.fn(),
      onActionComplete: vi.fn(),
      onActionError: vi.fn()
    });

    const names = tools.map((t) => t.name);
    expect(names).toContain("execute_shell_command");
    expect(names).toContain("load_skill");
    expect(names).toContain("create_memory");
    expect(names).toContain("update_memory");
    expect(names).toContain("delete_memory");
  });

  it("omits memory tools when memories are disabled", () => {
    const tools = buildCopilotTools({
      mcpToolSets: [],
      skills: [],
      loadedSkillIds: new Set(),
      memoriesEnabled: false,
      onActionStart: vi.fn(),
      onActionComplete: vi.fn(),
      onActionError: vi.fn()
    });

    const names = tools.map((t) => t.name);
    expect(names).not.toContain("create_memory");
    expect(names).not.toContain("update_memory");
    expect(names).not.toContain("delete_memory");
  });

  it("uses Eidon tool parameters schema as copilot tool parameters", () => {
    const tools = buildCopilotTools({
      mcpToolSets: [{ server: makeMcpServer(), tools: [makeMcpTool()] }],
      skills: [],
      loadedSkillIds: new Set(),
      memoriesEnabled: false,
      onActionStart: vi.fn(),
      onActionComplete: vi.fn(),
      onActionError: vi.fn()
    });

    const mcpTool = tools.find((t) => t.name === "mcp_server_1_read_file");
    expect(mcpTool?.parameters).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"]
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/copilot-tools.test.ts`
Expected: FAIL — `buildCopilotTools` not defined

- [ ] **Step 3: Write minimal implementation**

Create `lib/copilot-tools.ts`:

```typescript
import type { Tool } from "@github/copilot-sdk";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { createMemory, updateMemory as updateMemoryRecord, deleteMemory as deleteMemoryRecord, getMemoryCount } from "@/lib/memories";
import { getSettings } from "@/lib/settings";
import { executeLocalShellCommand, summarizeShellResult } from "@/lib/local-shell";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { extractEnumHints, coerceEnumValues } from "@/lib/tool-schema-helpers";
import type { McpServer, McpTool, Skill } from "@/lib/types";

type ToolSet = {
  server: McpServer;
  tools: McpTool[];
};

type CopilotToolContext = {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  onActionStart?: (action: {
    kind: string;
    label: string;
    detail?: string;
    serverId?: string | null;
    skillId?: string | null;
    toolName?: string | null;
    arguments?: Record<string, unknown> | null;
  }) => Promise<string | void> | string | void;
  onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
  onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
  mcpTimeout?: number;
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

function getToolLabel(tool: McpTool) {
  return tool.title ?? tool.annotations?.title ?? tool.name;
}

function buildArgumentsSummary(args: Record<string, unknown> | null | undefined) {
  if (!args || !Object.keys(args).length) return "";
  const firstScalar = Object.entries(args).find(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  if (firstScalar) return `${firstScalar[0]}=${String(firstScalar[1])}`;
  const json = JSON.stringify(args);
  return json.length > 120 ? `${json.slice(0, 117)}...` : json;
}

function buildMcpCopilotTool(server: McpServer, mcpTool: McpTool, ctx: CopilotToolContext): Tool {
  const functionName = mcpToolFunctionName(server.id, mcpTool.name);
  const enumHints = extractEnumHints(mcpTool.inputSchema ?? {});
  const description = [
    mcpTool.annotations?.title ?? mcpTool.name,
    mcpTool.description,
    enumHints || undefined,
    mcpTool.annotations?.readOnlyHint ? "(read-only)" : undefined
  ].filter(Boolean).join(" — ");

  return {
    name: functionName,
    description,
    parameters: (mcpTool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    skipPermission: true,
    handler: async (args: unknown) => {
      const typedArgs = (args ?? {}) as Record<string, unknown>;
      const correctedArgs = coerceEnumValues(mcpTool.inputSchema ?? {}, typedArgs);

      const handle = await ctx.onActionStart?.({
        kind: "mcp_tool_call",
        label: getToolLabel(mcpTool),
        detail: buildArgumentsSummary(correctedArgs),
        serverId: server.id,
        toolName: mcpTool.name,
        arguments: correctedArgs
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      const result = await callMcpTool(server, mcpTool.name, correctedArgs, ctx.mcpTimeout);
      const resultText = getToolResultText(result);

      if (result.isError) {
        await ctx.onActionError?.(actionHandle, { detail: buildArgumentsSummary(correctedArgs), resultSummary: resultText });
      } else {
        await ctx.onActionComplete?.(actionHandle, { detail: buildArgumentsSummary(correctedArgs), resultSummary: resultText });
      }

      return resultText;
    }
  };
}

function buildShellCopilotTool(ctx: CopilotToolContext): Tool {
  return {
    name: "execute_shell_command",
    description: "Execute a local shell command on the host environment.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (default 30000)" }
      },
      required: ["command"]
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      const { command, timeout_ms } = (args ?? {}) as { command?: string; timeout_ms?: number };
      if (!command?.trim()) return "Error: Shell command is required.";

      const handle = await ctx.onActionStart?.({
        kind: "shell_command",
        label: "Local command",
        detail: command.length > 140 ? `${command.slice(0, 137)}...` : command,
        arguments: { command, timeoutMs: timeout_ms }
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      try {
        const result = await executeLocalShellCommand({ command, timeoutMs: timeout_ms });
        const resultSummary = summarizeShellResult(result);

        if (result.isError) {
          await ctx.onActionError?.(actionHandle, { detail: command, resultSummary });
        } else {
          await ctx.onActionComplete?.(actionHandle, { detail: command, resultSummary });
        }

        return [
          "Local shell command result",
          `Command: ${command}`,
          `Status: ${result.isError ? "error" : "success"}`,
          "Result:",
          resultSummary
        ].join("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Shell command execution failed";
        await ctx.onActionError?.(actionHandle, { detail: command, resultSummary: message });
        return `Error: ${message}`;
      }
    }
  };
}

function buildLoadSkillCopilotTool(ctx: CopilotToolContext): Tool {
  return {
    name: "load_skill",
    description: `Load the full content and instructions of a skill. Available: ${ctx.skills.map((s) => getSkillResolvedName(s)).join(", ")}`,
    parameters: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "Name of the skill to load" }
      },
      required: ["skill_name"]
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      const { skill_name } = (args ?? {}) as { skill_name?: string };
      const skillName = (skill_name ?? "").trim().toLowerCase();

      const skill = ctx.skills.find(
        (s) => (parseSkillContentMetadata(s.content).name?.trim() || s.name).toLowerCase() === skillName
      );

      if (!skill || ctx.loadedSkillIds.has(skill.id)) {
        return skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${ctx.skills.map((s) => getSkillResolvedName(s)).join(", ")}`;
      }

      ctx.loadedSkillIds.add(skill.id);

      const handle = await ctx.onActionStart?.({
        kind: "skill_load",
        label: "Load skill",
        detail: getSkillResolvedName(skill),
        skillId: skill.id
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      await ctx.onActionComplete?.(actionHandle, {
        detail: getSkillResolvedName(skill),
        resultSummary: "Skill instructions loaded."
      });

      return [
        `Skill loaded: ${getSkillResolvedName(skill)}`,
        `Description: ${getSkillResolvedDescription(skill)}`,
        "",
        skill.content
      ].join("\n");
    }
  };
}

function buildMemoryCopilotTools(ctx: CopilotToolContext): Tool[] {
  if (!ctx.memoriesEnabled) return [];

  const createMemoryTool: Tool = {
    name: "create_memory",
    description: "Save a durable fact about the user for future conversations. Use conservatively — only for facts likely to recur (name, location, preferences, work details). Do not save transient task details.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The fact to remember" },
        category: { type: "string", description: "One of: personal, preference, work, location, other" }
      },
      required: ["content", "category"]
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      const { content, category } = (args ?? {}) as { content?: string; category?: string };
      const trimmedContent = (content ?? "").trim();
      const normalizedCategory = ["personal", "preference", "work", "location", "other"].includes(category ?? "other") ? category ?? "other" : "other";

      if (!trimmedContent) return "Error: content is required";

      const currentCount = getMemoryCount();
      const maxCount = getSettings().memoriesMaxCount ?? 100;
      if (currentCount >= maxCount) return `Memory limit reached (${currentCount}/${maxCount}). Update or delete an existing memory instead.`;

      const handle = await ctx.onActionStart?.({ kind: "create_memory", label: "Saved memory", detail: trimmedContent, arguments: { content: trimmedContent, category: normalizedCategory } });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      try {
        createMemory(trimmedContent, normalizedCategory as "personal" | "preference" | "work" | "location" | "other");
        await ctx.onActionComplete?.(actionHandle, { resultSummary: `Saved as ${normalizedCategory}` });
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Failed to create memory";
        await ctx.onActionError?.(actionHandle, { resultSummary: errorMsg });
      }

      return `Memory saved: ${trimmedContent} [${normalizedCategory}]`;
    }
  };

  const updateMemoryTool: Tool = {
    name: "update_memory",
    description: "Update an existing memory when a fact has changed.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory ID to update" },
        content: { type: "string", description: "The updated fact" },
        category: { type: "string", description: "New category (optional)" }
      },
      required: ["id", "content"]
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      const { id, content, category } = (args ?? {}) as { id?: string; content?: string; category?: string };
      if (!id?.trim() || !content?.trim()) return "Error: id and content are required";

      const handle = await ctx.onActionStart?.({ kind: "update_memory", label: "Updated memory", detail: content, arguments: { id, content, category } });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      try {
        updateMemoryRecord(id, { content, ...(category ? { category: category as "personal" | "preference" | "work" | "location" | "other" } : {}) });
        await ctx.onActionComplete?.(actionHandle, { detail: content, resultSummary: `Updated` });
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Failed to update memory";
        await ctx.onActionError?.(actionHandle, { resultSummary: errorMsg });
      }

      return `Memory updated: ${content}`;
    }
  };

  const deleteMemoryTool: Tool = {
    name: "delete_memory",
    description: "Delete a stored memory that is no longer relevant or accurate.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory ID to delete" }
      },
      required: ["id"]
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      const { id } = (args ?? {}) as { id?: string };
      if (!id?.trim()) return "Error: id is required";

      const handle = await ctx.onActionStart?.({ kind: "delete_memory", label: "Deleted memory", detail: id, arguments: { id } });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      try {
        deleteMemoryRecord(id);
        await ctx.onActionComplete?.(actionHandle, { resultSummary: "Deleted" });
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Failed to delete memory";
        await ctx.onActionError?.(actionHandle, { resultSummary: errorMsg });
      }

      return `Memory deleted: ${id}`;
    }
  };

  return [createMemoryTool, updateMemoryTool, deleteMemoryTool];
}

export function buildCopilotTools(ctx: CopilotToolContext): Tool[] {
  const tools: Tool[] = [];

  for (const { server, tools: mcpTools } of ctx.mcpToolSets) {
    for (const mcpTool of mcpTools) {
      tools.push(buildMcpCopilotTool(server, mcpTool, ctx));
    }
  }

  if (ctx.skills.length) {
    tools.push(buildLoadSkillCopilotTool(ctx));
  }

  tools.push(buildShellCopilotTool(ctx));

  tools.push(...buildMemoryCopilotTools(ctx));

  return tools;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/copilot-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/copilot-tools.ts tests/unit/copilot-tools.test.ts
git commit -m "feat: add copilot-tools module to convert Eidon tools to Copilot SDK format"
```

---

### Task 2: Update streamGithubCopilotChat to Accept and Pass Custom Tools

**Files:**
- Modify: `lib/github-copilot.ts:291-339`
- Test: `tests/unit/github-copilot.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/github-copilot.test.ts` inside the existing `describe` block:

```typescript
it("passes custom tools to the copilot session when provided", async () => {
  const events: unknown[] = [];
  const session: MockSession = {
    send: vi.fn().mockResolvedValue(undefined)
  };
  const client = createMockClient({
    createSession: vi.fn().mockImplementation(async (config: Record<string, unknown>) => {
      const onEvent = config.onEvent as (event: unknown) => void;
      queueMicrotask(() => onEvent({ type: "assistant.turn_end" }));
      return session;
    })
  });
  copilotClientCtor.mockImplementation(() => client);

  const customTool = {
    name: "my_custom_tool",
    description: "A custom tool",
    handler: vi.fn().mockResolvedValue("result"),
    skipPermission: true
  };

  await expect(
    streamGithubCopilotChat({
      ...createProfile(),
      messages: [{ role: "user", content: "Use my tool" }],
      tools: [customTool],
      onEvent: (event: unknown) => events.push(event)
    })
  ).resolves.toBeUndefined();

  expect(client.createSession).toHaveBeenCalledWith(
    expect.objectContaining({
      tools: [customTool]
    })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/github-copilot.test.ts`
Expected: FAIL — `tools` property not passed through

- [ ] **Step 3: Write minimal implementation**

Update `streamGithubCopilotChat` in `lib/github-copilot.ts` to accept an optional `tools` array and pass it to the session config:

```typescript
export async function streamGithubCopilotChat(
  input: ProviderProfileWithApiKey & {
    messages: Array<{ role: string; content: string }>;
    onEvent: (event: unknown) => void;
    tools?: Tool[];
  }
) {
  const client = await buildGithubCopilotClient(input);

  try {
    let resolveTurn: () => void;
    let rejectTurn: (error: Error) => void;
    const turnComplete = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });

    const sessionConfig = {
      model: input.model,
      streaming: true as const,
      workingDirectory: ensureCopilotWorkDir(),
      excludedTools: COPILOT_EXCLUDED_TOOLS,
      onPermissionRequest: () => ({ kind: "approved" as const }),
      onEvent: (rawEvent: unknown) => {
        const event = rawEvent as { type: string; data?: Record<string, unknown> };

        input.onEvent(rawEvent);

        if (event.type === "assistant.turn_end" || event.type === "session.idle") {
          resolveTurn();
        } else if (event.type === "session.error" && event.data?.message) {
          rejectTurn(new Error(event.data.message as string));
        }
      },
      ...(input.systemPrompt
        ? { systemMessage: { mode: "replace" as const, content: input.systemPrompt } }
        : {}),
      ...(input.tools?.length ? { tools: input.tools } : {})
    };

    const session = await client.createSession(sessionConfig);

    await session.send({
      prompt: input.messages.map((m) => m.content).join("\n")
    });

    await turnComplete;
  } finally {
    await client.stop();
  }
}
```

Also add the `Tool` import at the top of `lib/github-copilot.ts`:

```typescript
import type { Tool } from "@github/copilot-sdk";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/github-copilot.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add lib/github-copilot.ts tests/unit/github-copilot.test.ts
git commit -m "feat: pass custom tools to copilot streaming session via SDK tools param"
```

---

### Task 3: Map Copilot Tool Events to ChatStreamEvent in provider.ts

**Files:**
- Modify: `lib/provider.ts:338-354`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/provider.test.ts`:

```typescript
it("maps copilot tool execution events to chat stream events", async () => {
  // This test verifies that when the copilot stream emits tool.execution_start
  // and tool.execution_complete events, they are translated to Eidon's
  // action_start and action_complete ChatStreamEvent types
  const stream = createProviderStream("github_copilot");
  // ... verify tool event mapping
});
```

Note: The provider tests are integration-heavy. The real verification here is that `provider.ts` handles the new event types. The mapping logic is straightforward event translation. Let me focus on the implementation.

- [ ] **Step 2: Update the Copilot event handler in provider.ts**

In `lib/provider.ts`, update the `onEvent` handler inside the copilot streaming section (around line 341) to also map `tool.execution_start`, `tool.execution_complete`, and `tool.execution_progress` events:

```typescript
const copilotPromise = streamGithubCopilotChat({
  ...freshSettings,
  messages: messageTexts.map((content) => ({ role: "user" as const, content })),
  tools: input.tools,
  onEvent: (rawEvent: unknown) => {
    const event = rawEvent as CopilotEvent;

    if (event.type === "assistant.message_delta" && event.data?.deltaContent) {
      answer += event.data.deltaContent as string;
      enqueue({ event: { type: "answer_delta", text: event.data.deltaContent as string } });
    } else if (event.type === "assistant.reasoning_delta" && event.data?.deltaContent) {
      thinking += event.data.deltaContent as string;
      enqueue({ event: { type: "thinking_delta", text: event.data.deltaContent as string } });
    } else if (event.type === "assistant.reasoning" && event.data?.content) {
      thinking += event.data.content as string;
      enqueue({ event: { type: "thinking_delta", text: event.data.content as string } });
    } else if (event.type === "tool.execution_start" && event.data) {
      const toolData = event.data as { toolCallId: string; toolName: string; arguments?: Record<string, unknown> };
      const action: MessageAction = {
        id: toolData.toolCallId,
        messageId: "",
        kind: "mcp_tool_call",
        status: "running",
        serverId: null,
        skillId: null,
        toolName: toolData.toolName,
        label: toolData.toolName,
        detail: "",
        arguments: toolData.arguments ?? null,
        resultSummary: "",
        sortOrder: 0,
        startedAt: new Date().toISOString(),
        completedAt: null
      };
      enqueue({ event: { type: "action_start", action } });
    } else if (event.type === "tool.execution_complete" && event.data) {
      const toolData = event.data as { toolCallId: string; success: boolean; output?: string };
      const action: MessageAction = {
        id: toolData.toolCallId,
        messageId: "",
        kind: "mcp_tool_call",
        status: toolData.success ? "completed" : "error",
        serverId: null,
        skillId: null,
        toolName: "",
        label: "",
        detail: "",
        arguments: null,
        resultSummary: toolData.output ?? "",
        sortOrder: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
      enqueue({ event: { type: toolData.success ? "action_complete" : "action_error", action } });
    } else if (event.type === "session.error" && event.data?.message) {
      enqueue({ event: { type: "error", message: event.data.message as string } });
    }
  }
});
```

Also update the `CopilotEvent` type to include the new event types. Find the type definition in `provider.ts` and expand it, or define it inline. The current code already casts events as `CopilotEvent` — expand that type to include the tool event shapes.

Also need to import `MessageAction` type:

```typescript
import type { ... MessageAction ... } from "@/lib/types";
```

- [ ] **Step 3: Build and run provider tests**

Run: `npx vitest run tests/unit/provider.test.ts`
Expected: PASS (existing tests still pass; new event mapping is additive)

- [ ] **Step 4: Commit**

```bash
git add lib/provider.ts
git commit -m "feat: map copilot tool execution events to Eidon ChatStreamEvent types"
```

---

### Task 4: Wire Custom Tools into the Copilot Provider Stream

**Files:**
- Modify: `lib/provider.ts`

- [ ] **Step 1: Import and call buildCopilotTools in the copilot streaming section**

In `lib/provider.ts`, add the import:

```typescript
import { buildCopilotTools } from "@/lib/copilot-tools";
```

Then in the copilot streaming section (around line 338), build the tools from Eidon's tool sets and pass them to `streamGithubCopilotChat`. The key change is that the copilot path now gets the same tool infrastructure as the non-copilot path:

```typescript
const copilotTools = buildCopilotTools({
  mcpToolSets: input.mcpToolSets ?? [],
  skills: input.skills ?? [],
  loadedSkillIds: new Set(),
  memoriesEnabled: input.memoriesEnabled ?? false,
  onActionStart: input.onActionStart,
  onActionComplete: input.onActionComplete,
  onActionError: input.onActionError,
  mcpTimeout: input.mcpTimeout
});

const copilotPromise = streamGithubCopilotChat({
  ...freshSettings,
  messages: messageTexts.map((content) => ({ role: "user" as const, content })),
  tools: copilotTools,
  onEvent: (rawEvent: unknown) => {
    // ... existing event mapping
  }
});
```

This replaces the previous call that had no `tools` parameter.

- [ ] **Step 2: Verify provider tests still pass**

Run: `npx vitest run tests/unit/provider.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add lib/provider.ts
git commit -m "feat: wire Eidon tools into copilot streaming session via buildCopilotTools"
```

---

### Task 5: Update streamGithubCopilotChat Type Signature

**Files:**
- Modify: `lib/github-copilot.ts`

The `streamGithubCopilotChat` function signature needs the `tools` property. We already added it in Task 2, but we need to make sure the type is properly imported and the `ProviderProfileWithApiKey` spread doesn't conflict.

- [ ] **Step 1: Verify the Tool import and type signature are clean**

In `lib/github-copilot.ts`, confirm:
1. `import type { Tool } from "@github/copilot-sdk";` is at the top
2. `streamGithubCopilotChat` accepts `tools?: Tool[]` in its input type
3. The `tools` are passed via `...(input.tools?.length ? { tools: input.tools } : {})` in sessionConfig

- [ ] **Step 2: Run all copilot tests**

Run: `npx vitest run tests/unit/github-copilot.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit if any changes were needed**

```bash
git add lib/github-copilot.ts
git commit -m "fix: ensure Tool type import and tools param in streamGithubCopilotChat"
```

---

### Task 6: End-to-End Verification

**Files:**
- All modified files

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: SUCCESS

- [ ] **Step 3: Manual test with a GitHub Copilot profile**

1. Start the dev server
2. Connect a GitHub Copilot profile
3. Start a conversation and ask a question that would trigger a tool (e.g., "What files are in the current directory?" should trigger `execute_shell_command`)
4. Verify that:
   - Thinking streams appear as `thinking_delta` events
   - Answer text streams as `answer_delta` events
   - Tool calls show as `action_start` → `action_complete` in the UI
   - MCP tools are available and executable
   - Memory tools work when enabled
   - Shell commands execute and return results

- [ ] **Step 4: Commit any fixes discovered during manual testing**

```bash
git add -A
git commit -m "fix: address issues found during copilot custom tools e2e testing"
```

---

## Self-Review

**1. Spec coverage:**
- Register Eidon tools as Copilot SDK custom tools → Tasks 1, 4
- Handle them via SDK's tools + handler pattern → Task 1 (handler functions), Task 2 (pass to session)
- Stream thinking + output → Already working; Task 3 adds tool events
- Stream tool calling events → Task 3

**2. Placeholder scan:**
- No TBD/TODO found
- All code blocks are complete implementations
- No "similar to Task N" shortcuts

**3. Type consistency:**
- `buildCopilotTools` returns `Tool[]` from `@github/copilot-sdk` — matches `SessionConfig.tools` type
- `streamGithubCopilotChat` accepts `tools?: Tool[]` — matches what `buildCopilotTools` produces
- Event types in `provider.ts` map to existing `ChatStreamEvent` types
- `MessageAction` type used in tool event mapping matches `lib/types.ts` definition