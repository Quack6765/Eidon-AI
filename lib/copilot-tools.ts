import type { Tool } from "@github/copilot-sdk";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { getMemory, getMemoryCount } from "@/lib/memories";
import {
  buildCreateMemoryProposal,
  buildDeleteMemoryProposal,
  buildUpdateMemoryProposal,
  normalizeMemoryCategory
} from "@/lib/memory-proposals";
import { getSettings } from "@/lib/settings";
import { executeLocalShellCommand, getShellCommandLabel, summarizeShellResult } from "@/lib/local-shell";
import { searchSearxng } from "@/lib/searxng";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { coerceEnumValues } from "@/lib/tool-schema-helpers";
import { getWebSearchActionLabel } from "@/lib/web-search";
import { throwIfChatTurnAborted as throwIfAborted } from "@/lib/chat-turn-control";
import { MAX_RUNTIME_TOOL_RESULT_CHARS, truncateText } from "@/lib/bounded-text";
import {
  prepareScreenshotArtifact,
  registerScreenshotArtifact,
  revokeScreenshotArtifact
} from "@/lib/screenshot-artifact-capabilities";
import type {
  McpServer,
  McpTool,
  Skill,
  MessageActionKind,
  MessageActionStatus,
  MemoryProposalPayload,
  MemoryProposalState,
  VisionMode
} from "@/lib/types";

type ToolSet = {
  server: McpServer;
  tools: McpTool[];
};

type RuntimeAction = {
  kind: MessageActionKind;
  status?: MessageActionStatus;
  label: string;
  detail?: string;
  serverId?: string | null;
  skillId?: string | null;
  toolName?: string | null;
  arguments?: Record<string, unknown> | null;
  proposalState?: MemoryProposalState | null;
  proposalPayload?: MemoryProposalPayload | null;
};

export type CopilotToolContext = {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  effectiveVisionMode: VisionMode;
  searxngBaseUrl?: string | null;
  memoryUserId?: string;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
  onActionComplete?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
  onActionError?: (handle: string | undefined, patch: { detail?: string; resultSummary?: string }) => Promise<void> | void;
  mcpTimeout?: number;
  abortSignal?: AbortSignal;
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
  const description = [
    mcpTool.annotations?.title ?? mcpTool.name,
    mcpTool.description,
    mcpTool.annotations?.readOnlyHint ? "(read-only)" : undefined
  ].filter(Boolean).join(" — ");

  return {
    name: functionName,
    description,
    parameters: (mcpTool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    skipPermission: true,
    handler: async (args: unknown) => {
      throwIfAborted(ctx.abortSignal);
      const typedArgs = (args ?? {}) as Record<string, unknown>;
      const correctedArgs = coerceEnumValues(mcpTool.inputSchema ?? {}, typedArgs);

      const handle = await ctx.onActionStart?.({
        kind: "mcp_tool_call",
        label: getWebSearchActionLabel(server.id, getToolLabel(mcpTool)),
        detail: buildArgumentsSummary(correctedArgs),
        serverId: server.id,
        toolName: mcpTool.name,
        arguments: correctedArgs
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      const result = ctx.abortSignal
        ? await callMcpTool(server, mcpTool.name, correctedArgs, ctx.mcpTimeout, ctx.abortSignal)
        : await callMcpTool(server, mcpTool.name, correctedArgs, ctx.mcpTimeout);
      throwIfAborted(ctx.abortSignal);
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
    overridesBuiltInTool: true,
    skipPermission: true,
    handler: async (args: unknown) => {
      throwIfAborted(ctx.abortSignal);
      const { command, timeout_ms } = (args ?? {}) as { command?: string; timeout_ms?: number };
      if (!command?.trim()) return "Error: Shell command is required.";

      const handle = await ctx.onActionStart?.({
        kind: "shell_command",
        label: getShellCommandLabel(command),
        detail: command.length > 140 ? `${command.slice(0, 137)}...` : command,
        arguments: { command, timeoutMs: timeout_ms }
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;
      const screenshotCandidate = prepareScreenshotArtifact(command);

      try {
        const result = await executeLocalShellCommand({
          command,
          timeoutMs: timeout_ms,
          abortSignal: ctx.abortSignal
        });
        throwIfAborted(ctx.abortSignal);
        const resultSummary = summarizeShellResult(result);
        const executionSucceeded = !result.isError && !result.timedOut && result.exitCode === 0;

        if (!executionSucceeded) {
          await ctx.onActionError?.(actionHandle, { detail: command, resultSummary });
        } else {
          registerScreenshotArtifact(actionHandle, screenshotCandidate);
          try {
            await ctx.onActionComplete?.(actionHandle, { detail: command, resultSummary });
          } finally {
            revokeScreenshotArtifact(actionHandle);
          }
        }

        return [
          "Local shell command result",
          `Command: ${command}`,
          `Status: ${executionSucceeded ? "success" : "error"}`,
          "Result:",
          resultSummary
        ].join("\n");
      } catch (error) {
        throwIfAborted(ctx.abortSignal);
        const message = error instanceof Error ? error.message : "Shell command execution failed";
        await ctx.onActionError?.(actionHandle, { detail: command, resultSummary: message });
        return `Error: ${message}`;
      }
    }
  };
}

function buildSearxngCopilotTool(ctx: CopilotToolContext): Tool | null {
  if (!ctx.searxngBaseUrl) {
    return null;
  }
  const baseUrl = ctx.searxngBaseUrl;

  return {
    name: "web_search",
    description: "Search the web using the configured SearXNG instance.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Maximum number of results to return (default 5, max 10)" }
      },
      required: ["query"]
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      throwIfAborted(ctx.abortSignal);
      const { query, max_results } = (args ?? {}) as { query?: string; max_results?: number };
      const trimmedQuery = (query ?? "").trim();
      const maxResults =
        typeof max_results === "number" && Number.isFinite(max_results)
          ? Math.max(1, Math.min(10, Math.round(max_results)))
          : undefined;

      if (!trimmedQuery) {
        return "Error: query is required";
      }

      const handle = await ctx.onActionStart?.({
        kind: "mcp_tool_call",
        label: getWebSearchActionLabel("builtin_web_search_searxng", "Web search"),
        detail: trimmedQuery,
        serverId: "builtin_web_search_searxng",
        toolName: "web_search",
        arguments: {
          query: trimmedQuery,
          ...(maxResults !== undefined ? { max_results: maxResults } : {})
        }
      });
      const actionHandle = typeof handle === "string" ? handle : undefined;

      try {
        const resultSummary = await searchSearxng({
          baseUrl,
          query: trimmedQuery,
          maxResults,
          abortSignal: ctx.abortSignal
        });
        throwIfAborted(ctx.abortSignal);
        await ctx.onActionComplete?.(actionHandle, { detail: trimmedQuery, resultSummary });
        return resultSummary;
      } catch (error) {
        throwIfAborted(ctx.abortSignal);
        const message = error instanceof Error ? error.message : "SearXNG search failed";
        await ctx.onActionError?.(actionHandle, { detail: trimmedQuery, resultSummary: message });
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
    overridesBuiltInTool: true,
    skipPermission: true,
    handler: async (args: unknown) => {
      throwIfAborted(ctx.abortSignal);
      const { skill_name } = (args ?? {}) as { skill_name?: string };
      const skillName = (skill_name ?? "").trim().toLowerCase();

      const skill = ctx.skills.find(
        (s) => (parseSkillContentMetadata(s.content).name?.trim() || s.name).toLowerCase() === skillName
      );

      if (!skill || ctx.loadedSkillIds.has(skill.id)) {
        return skill ? "This skill is already loaded." : `Skill "${skillName}" not found. Available: ${ctx.skills.map((s) => getSkillResolvedName(s)).join(", ")}`;
      }

      throwIfAborted(ctx.abortSignal);
      const handle = await ctx.onActionStart?.({
        kind: "skill_load",
        label: "Load skill",
        detail: getSkillResolvedName(skill),
        skillId: skill.id
      });
      throwIfAborted(ctx.abortSignal);
      const actionHandle = typeof handle === "string" ? handle : undefined;

      ctx.loadedSkillIds.add(skill.id);
      try {
        await ctx.onActionComplete?.(actionHandle, {
          detail: getSkillResolvedName(skill),
          resultSummary: "Skill instructions loaded."
        });
        throwIfAborted(ctx.abortSignal);
      } catch (error) {
        ctx.loadedSkillIds.delete(skill.id);
        throw error;
      }

      return truncateText([
        `Skill loaded: ${getSkillResolvedName(skill)}`,
        `Description: ${getSkillResolvedDescription(skill)}`,
        "",
        skill.content
      ].join("\n"), MAX_RUNTIME_TOOL_RESULT_CHARS);
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
      throwIfAborted(ctx.abortSignal);
      const { content, category } = (args ?? {}) as { content?: string; category?: string };
      const trimmedContent = (content ?? "").trim();
      const normalizedCategory = normalizeMemoryCategory(category);

      if (!trimmedContent) return "Error: content is required";

      const currentCount = getMemoryCount(ctx.memoryUserId);
      const maxCount = getSettings().memoriesMaxCount ?? 100;
      throwIfAborted(ctx.abortSignal);
      if (currentCount >= maxCount) return `Memory limit reached (${currentCount}/${maxCount}). Update or delete an existing memory instead.`;

      const proposalPayload = buildCreateMemoryProposal({
        content: trimmedContent,
        category: normalizedCategory
      });

      throwIfAborted(ctx.abortSignal);
      await ctx.onActionStart?.({
        kind: "create_memory",
        status: "pending",
        label: "Create memory proposal",
        detail: trimmedContent,
        arguments: { content: trimmedContent, category: normalizedCategory },
        proposalState: "pending",
        proposalPayload
      });
      throwIfAborted(ctx.abortSignal);

      return `Memory change proposed for approval: create [${normalizedCategory}] ${trimmedContent}`;
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
      throwIfAborted(ctx.abortSignal);
      const { id, content, category } = (args ?? {}) as { id?: string; content?: string; category?: string };
      if (!id?.trim() || !content?.trim()) return "Error: id and content are required";

      const existing = getMemory(id, ctx.memoryUserId);
      throwIfAborted(ctx.abortSignal);
      if (!existing) return `Error: Memory ${id} not found`;

      const proposalPayload = buildUpdateMemoryProposal({
        memory: existing,
        content,
        category
      });

      throwIfAborted(ctx.abortSignal);
      await ctx.onActionStart?.({
        kind: "update_memory",
        status: "pending",
        label: "Update memory proposal",
        detail: content,
        arguments: {
          id,
          content: content.trim(),
          ...(proposalPayload.proposedMemory ? { category: proposalPayload.proposedMemory.category } : {})
        },
        proposalState: "pending",
        proposalPayload
      });
      throwIfAborted(ctx.abortSignal);

      return `Memory change proposed for approval: update ${id} -> ${content.trim()} [${proposalPayload.proposedMemory?.category ?? existing.category}]`;
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
      throwIfAborted(ctx.abortSignal);
      const { id } = (args ?? {}) as { id?: string };
      if (!id?.trim()) return "Error: id is required";

      const existing = getMemory(id, ctx.memoryUserId);
      throwIfAborted(ctx.abortSignal);
      if (!existing) return `Error: Memory ${id} not found`;

      throwIfAborted(ctx.abortSignal);
      await ctx.onActionStart?.({
        kind: "delete_memory",
        status: "pending",
        label: "Delete memory proposal",
        detail: existing.content,
        arguments: { id },
        proposalState: "pending",
        proposalPayload: buildDeleteMemoryProposal(existing)
      });
      throwIfAborted(ctx.abortSignal);

      return `Memory change proposed for approval: delete ${id}`;
    }
  };

  return [createMemoryTool, updateMemoryTool, deleteMemoryTool];
}

export function buildCopilotTools(ctx: CopilotToolContext): Tool[] {
  const tools: Tool[] = [];

  for (const { server, tools: mcpTools } of ctx.mcpToolSets) {
    if (server.isVisionMcp && ctx.effectiveVisionMode !== "mcp") {
      continue;
    }
    for (const mcpTool of mcpTools) {
      tools.push(buildMcpCopilotTool(server, mcpTool, ctx));
    }
  }

  if (ctx.skills.length) {
    tools.push(buildLoadSkillCopilotTool(ctx));
  }

  const searxngTool = buildSearxngCopilotTool(ctx);
  if (searxngTool) {
    tools.push(searxngTool);
  }

  tools.push(buildShellCopilotTool(ctx));

  tools.push(...buildMemoryCopilotTools(ctx));

  return tools;
}
