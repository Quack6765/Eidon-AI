import type { Tool } from "@github/copilot-sdk";
import { callMcpTool, getToolResultText } from "@/lib/mcp-client";
import { createMemory, updateMemory as updateMemoryRecord, deleteMemory as deleteMemoryRecord, getMemoryCount } from "@/lib/memories";
import { getSettings } from "@/lib/settings";
import { executeLocalShellCommand, summarizeShellResult } from "@/lib/local-shell";
import { parseSkillContentMetadata } from "@/lib/skill-metadata";
import { coerceEnumValues } from "@/lib/tool-schema-helpers";
import type { McpServer, McpTool, Skill, MessageActionKind } from "@/lib/types";

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

export type CopilotToolContext = {
  mcpToolSets: ToolSet[];
  skills: Skill[];
  loadedSkillIds: Set<string>;
  memoriesEnabled: boolean;
  onActionStart?: (action: RuntimeAction) => Promise<string | void> | string | void;
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
    overridesBuiltInTool: true,
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
    overridesBuiltInTool: true,
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
      const normalizedCategory = ["personal", "preference", "work", "location", "other"].includes(category ?? "other") ? (category ?? "other") : "other";

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
        await ctx.onActionComplete?.(actionHandle, { detail: content, resultSummary: "Updated" });
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
